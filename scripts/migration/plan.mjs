#!/usr/bin/env node
// Step 1 of the migration kit: read a Lovable Cloud database export
// (PostgreSQL custom-format .backup, zstd) and prepare a restore plan.
// Read-only: it never connects to any database.
//
//   node scripts/migration/plan.mjs --archive export.backup --out ./plan
//
// Writes (in --out, mode 0700; it holds user data and password hashes, so
// keep it off git and delete it after the cutover):
//   schema.list / data.list / migrations-schema.list  pg_restore -L lists
//   prologue.sql            create extension if not exists ...
//   schema.sql, data.sql, migrations-schema.sql  pg_restore -f output
//   manifest.json           per-table row count + sha256 (no row data)
//   report.json, report.md  what is restored, skipped and why; cron/vault inventory
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import {
  createCopyParser,
  extensionPrologue,
  parseToc,
  planFromToc,
  summariseCronCommand,
} from "./lib.mjs";

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => {
    if (a.startsWith("--"))
      acc.push([a.slice(2), all[i + 1] && !all[i + 1].startsWith("--") ? all[i + 1] : true]);
    return acc;
  }, []),
);
const archive = args.archive;
const out = args.out;
const pgRestore = process.env.PG_RESTORE || "pg_restore";
if (!archive || !out) {
  console.error("usage: plan.mjs --archive <export.backup> --out <dir>");
  process.exit(2);
}

const version = execFileSync(pgRestore, ["--version"], { encoding: "utf8" }).trim();
const major = Number(/(\d+)(?:\.\d+)?/.exec(version.replace(/^[^0-9]*/, ""))?.[1] || 0);
if (major < 16) {
  console.error(`${version}: Lovable exports are zstd-compressed and need pg_restore 16 or newer.`);
  process.exit(2);
}

fs.mkdirSync(out, { recursive: true, mode: 0o700 });
fs.chmodSync(out, 0o700);
const write = (name, body) => fs.writeFileSync(path.join(out, name), body, { mode: 0o600 });

const tocText = execFileSync(pgRestore, ["--list", archive], {
  encoding: "utf8",
  maxBuffer: 256 * 1024 * 1024,
});
const header = tocText
  .split("\n")
  .filter(
    (l) =>
      l.startsWith(";") &&
      /(Archive created|dbname|Dumped from|Dumped by|Compression|Format)/.test(l),
  )
  .map((l) => l.replace(/^;\s*/, ""));
const entries = parseToc(tocText);
const { lists, skipped, info } = planFromToc(entries);

for (const [name, lines] of Object.entries(lists)) write(`${name}.list`, lines.join("\n") + "\n");
write("prologue.sql", extensionPrologue(info.extensions));

function restoreTo(list, file, extra = []) {
  const r = spawnSync(
    pgRestore,
    ["--no-owner", "-L", path.join(out, list), "-f", path.join(out, file), ...extra, archive],
    { encoding: "utf8" },
  );
  if (r.status !== 0) {
    console.error(`pg_restore failed for ${list}: ${r.stderr.slice(0, 2000)}`);
    process.exit(1);
  }
  fs.chmodSync(path.join(out, file), 0o600);
}
restoreTo("schema.list", "schema.sql");
restoreTo("migrations-schema.list", "migrations-schema.sql");
restoreTo("data.list", "data.sql");

async function manifestOf(file) {
  const parser = createCopyParser(createHash);
  const rl = readline.createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity });
  for await (const l of rl) parser.line(l);
  return parser.result();
}
const manifest = await manifestOf(path.join(out, "data.sql"));
const sequences = [];
// Account summary (counts only): how many users have a bcrypt password hash,
// how many are OAuth-only, and identities per provider.
const auth = { users: 0, bcryptPasswords: 0, withoutPassword: 0, identitiesByProvider: {} };
// Entitlements (counts only): subscriptions by status/price, incl. lifetime.
const entitlements = { subscriptionsByStatus: {}, subscriptionsByPrice: {} };
{
  let block = null;
  let cols = [];
  for (const l of fs.readFileSync(path.join(out, "data.sql"), "utf8").split("\n")) {
    const m = /^SELECT pg_catalog\.setval\('([^']+)', (\d+), (true|false)\);$/.exec(l);
    if (m) sequences.push({ sequence: m[1], value: Number(m[2]), isCalled: m[3] === "true" });
    const c =
      /^COPY (auth\.users|auth\.identities|public\.subscriptions) \((.*)\) FROM stdin;$/.exec(l);
    if (c) {
      block = c[1];
      cols = c[2].split(", ").map((x) => x.replace(/"/g, ""));
      continue;
    }
    if (!block) continue;
    if (l === "\\.") {
      block = null;
      continue;
    }
    const v = l.split("\t");
    if (block === "auth.users") {
      auth.users++;
      const pw = v[cols.indexOf("encrypted_password")];
      if (pw && /^\$2[aby]\$/.test(pw)) auth.bcryptPasswords++;
      else auth.withoutPassword++;
    } else if (block === "public.subscriptions") {
      const st = v[cols.indexOf("status")];
      const pr = v[cols.indexOf("price_id")];
      entitlements.subscriptionsByStatus[st] = (entitlements.subscriptionsByStatus[st] || 0) + 1;
      entitlements.subscriptionsByPrice[pr] = (entitlements.subscriptionsByPrice[pr] || 0) + 1;
    } else {
      const p = v[cols.indexOf("provider")];
      auth.identitiesByProvider[p] = (auth.identitiesByProvider[p] || 0) + 1;
    }
  }
}
const schemaSql = fs.readFileSync(path.join(out, "schema.sql"), "utf8");
const rls = {
  policies: (schemaSql.match(/^CREATE POLICY /gm) || []).length,
  tablesWithRls: [...schemaSql.matchAll(/^ALTER TABLE (\S+) ENABLE ROW LEVEL SECURITY;$/gm)]
    .map((m) => m[1])
    .sort(),
};
// Migration history versions (not user data) so verify can accept the
// repository migrations import.mjs applies on top of the archive.
const migrationHistory = [];
{
  let inHist = false;
  let vi = -1;
  for (const l of fs.readFileSync(path.join(out, "data.sql"), "utf8").split("\n")) {
    const c = /^COPY supabase_migrations\.schema_migrations \((.*)\) FROM stdin;$/.exec(l);
    if (c) {
      inHist = true;
      vi = c[1].split(", ").indexOf("version");
      continue;
    }
    if (!inHist) continue;
    if (l === "\\.") break;
    migrationHistory.push(l.split("\t")[vi]);
  }
}
write(
  "manifest.json",
  JSON.stringify(
    {
      archive: path.basename(archive),
      tables: manifest,
      sequences,
      auth,
      entitlements,
      rls,
      migrationHistory,
    },
    null,
    2,
  ) + "\n",
);

// Inventory of things the kit does not restore verbatim. Values are never
// printed: cron commands are reduced to host/path/header names, vault to names.
function extractRows(schema, table) {
  const r = spawnSync(pgRestore, ["--data-only", "-n", schema, "-t", table, "-f", "-", archive], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (r.status !== 0) return [];
  const lines = r.stdout.split("\n");
  const start = lines.findIndex((l) => l.startsWith(`COPY ${schema}.${table} (`));
  if (start === -1) return [];
  const cols = lines[start]
    .replace(/^COPY [^ ]+ \((.*)\) FROM stdin;$/, "$1")
    .split(", ")
    .map((c) => c.replace(/"/g, ""));
  const rows = [];
  for (let i = start + 1; i < lines.length && lines[i] !== "\\."; i++) {
    const vals = lines[i]
      .split("\t")
      .map((v) =>
        v === "\\N" ? null : v.replace(/\\n/g, "\n").replace(/\\t/g, "\t").replace(/\\\\/g, "\\"),
      );
    rows.push(Object.fromEntries(cols.map((c, j) => [c, vals[j]])));
  }
  return rows;
}
const cronJobs = info.cronJobs
  ? extractRows("cron", "job").map((j) => ({
      jobname: j.jobname,
      schedule: j.schedule,
      active: j.active,
      ...summariseCronCommand(j.command || ""),
    }))
  : [];
const vaultSecretNames = info.vault
  ? extractRows("vault", "secrets")
      .map((s) => s.name)
      .filter(Boolean)
  : [];

const authUsers = manifest["auth.users"]?.rows ?? 0;
const report = {
  archive: path.basename(archive),
  pgRestore: version,
  archiveHeader: header,
  restore: {
    schemaEntries: lists.schema.length,
    dataTables: Object.keys(manifest).length,
    rows: Object.values(manifest).reduce((n, t) => n + t.rows, 0),
    authUsers,
    authIdentities: manifest["auth.identities"]?.rows ?? 0,
    sequences: sequences.length,
  },
  extensions: [...new Set(info.extensions)].sort(),
  appTriggersOrPoliciesOnAuth: info.authCustom,
  pgmqQueues: info.queues.sort(),
  pgmqQueueTablesWithDiscardedMessages: info.queueData.sort(),
  storageObjectsInArchive: (manifest["storage.objects"]?.rows ?? 0) > 0,
  cronJobs,
  vaultSecretNames,
  warnings: info.warnings,
  skipped,
};
write("report.json", JSON.stringify(report, null, 2) + "\n");

const md = [
  `# Restore plan for ${report.archive}`,
  "",
  `- ${report.restore.dataTables} tables, ${report.restore.rows} rows (auth.users ${authUsers}, auth.identities ${report.restore.authIdentities}).`,
  `- Accounts: ${auth.bcryptPasswords} with bcrypt password hashes (kept), ${auth.withoutPassword} without a password (OAuth-only or invited); identities ${JSON.stringify(auth.identitiesByProvider)}.`,
  `- Subscriptions by status ${JSON.stringify(entitlements.subscriptionsByStatus)}; by price ${JSON.stringify(entitlements.subscriptionsByPrice)} (lifetime purchases included).`,
  `- ${report.restore.schemaEntries} schema entries (public schema, ${rls.policies} RLS policies on ${rls.tablesWithRls.length} tables, functions, triggers, grants).`,
  `- Extensions enabled first: ${report.extensions.join(", ") || "none"}.`,
  `- App triggers/policies on auth: ${report.appTriggersOrPoliciesOnAuth.join("; ") || "none"}.`,
  `- pgmq queues recreated empty: ${report.pgmqQueues.join(", ") || "none"}.`,
  `- Storage objects in archive: ${report.storageObjectsInArchive ? `YES (${manifest["storage.objects"].rows}) - copy the files separately (Lovable: More -> Storage)` : "none"}.`,
  `- Vault secrets to recreate (names): ${report.vaultSecretNames.join(", ") || "none"}.`,
  `- Cron jobs to recreate: ${cronJobs.map((j) => `${j.jobname} [${j.schedule}] -> ${j.target ? j.target.host + j.target.path : "sql"}`).join("; ") || "none"}.`,
  ...(report.warnings.length ? ["", "## Review", ...report.warnings.map((w) => `- ${w}`)] : []),
  "",
  "## Skipped entries",
  ...Object.entries(
    skipped.reduce((acc, s) => ((acc[s.reason] ||= []).push(s.entry), acc), {}),
  ).map(([reason, list]) => `- ${reason}: ${list.length}`),
  "",
].join("\n");
write("report.md", md);
console.log(md);
