#!/usr/bin/env node
// Step 2 of the migration kit: restore a plan (from plan.mjs) into a NEW,
// owner-owned Supabase project, then run verify.mjs.
//
//   TARGET_DB_URL=postgresql://postgres.<ref>:<pw>@<pooler-host>:5432/postgres \
//     node scripts/migration/import.mjs --plan ./plan --confirm-target <ref> \
//       [--repo-migrations supabase/migrations] [--pending-migrations v1,v2] [--preflight-only]
//
// Safety and idempotency:
// - Refuses the live Lovable backend and any target not named by --confirm-target.
// - Only imports into a fresh project (no auth users, none of the archive's
//   tables). Re-running after a successful import of the same archive is a
//   no-op that re-verifies. Any other non-empty state is refused; the kit
//   never drops or truncates anything.
// - Extensions, schema, data (triggers disabled via session_replication_role
//   = replica, as in Supabase's restore guide) and queue recreation run in ONE
//   transaction: on any error nothing is left behind.
// - Repository migrations newer than the archive's history are then applied,
//   each in its own transaction, and recorded in supabase_migrations.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertSafeTarget,
  columnProblems,
  redactUrl,
  splitColumns,
  splitQualified,
} from "./lib.mjs";
import { psql, query, queryJson } from "./pg.mjs";

const argv = process.argv.slice(2);
const opt = (name) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? undefined : argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : true;
};
const planDir = opt("plan");
const confirm = opt("confirm-target");
const url = process.env.TARGET_DB_URL;
try {
  assertSafeTarget(url, confirm);
} catch (e) {
  console.error(e.message);
  process.exit(2);
}
if (!planDir) {
  console.error(
    "usage: import.mjs --plan <dir> --confirm-target <ref> [--repo-migrations <dir>] [--pending-migrations a,b] [--preflight-only]",
  );
  process.exit(2);
}
const P = (f) => path.join(planDir, f);
const manifest = JSON.parse(fs.readFileSync(P("manifest.json"), "utf8"));
const report = JSON.parse(fs.readFileSync(P("report.json"), "utf8"));
const manifestSha = createHash("sha256")
  .update(fs.readFileSync(P("manifest.json")))
  .digest("hex");
const here = path.dirname(fileURLToPath(import.meta.url));
const runVerify = () =>
  spawnSync(
    process.execPath,
    [path.join(here, "verify.mjs"), "--plan", planDir, "--confirm-target", confirm],
    { stdio: "inherit", env: process.env },
  ).status;

console.log(
  `import: target ${redactUrl(url)}; archive ${manifest.archive} (${Object.keys(manifest.tables).length} tables, ${manifest.auth.users} accounts)`,
);

// ---- preflight -------------------------------------------------------------
const [server] = queryJson(
  url,
  "select current_setting('server_version_num')::int as v, current_user as who",
);
const tables = Object.keys(manifest.tables);
const reg = (t) => `to_regclass('${t.replace(/'/g, "''")}') is not null`;
const [state] = queryJson(
  url,
  `select
  (select count(*) from auth.users)::int as auth_users,
  (select count(*) from (values ${
    tables
      .filter((t) => !/^(auth|storage|supabase_migrations)\./.test(t))
      .map((t) => `(${reg(t)})`)
      .join(",") || "(false)"
  }) v(e) where e)::int as app_tables_present,
  to_regclass('migration_kit.imports') is not null as has_marker,
  to_regclass('supabase_migrations.schema_migrations') is not null as has_history`,
);
console.log(
  `preflight: server ${server.v}, role ${server.who}, auth.users ${state.auth_users}, archive tables already present ${state.app_tables_present}`,
);

if (state.has_marker) {
  const prior = query(
    url,
    `select manifest_sha from migration_kit.imports order by imported_at desc limit 1`,
  )[0]?.[0];
  if (prior === manifestSha) {
    console.log(
      "This archive was already imported into this target. Re-verifying instead of importing again.",
    );
    process.exit(runVerify());
  }
  console.error(
    "refusing: the target already holds a different import. Use a fresh project for a new export.",
  );
  process.exit(3);
}
if (state.auth_users > 0 || state.app_tables_present > 0) {
  console.error(
    "refusing: target is not a fresh project (it has users or the archive's tables). The kit never deletes data; create a new project.",
  );
  process.exit(3);
}

// Archive columns must fit the target's existing (Supabase-managed) tables.
const managed = Object.entries(manifest.tables).filter(([t]) => /^(auth|storage)\./.test(t));
let problems = [];
for (const [t, m] of managed) {
  const { schema, table } = splitQualified(t);
  const cols = queryJson(
    url,
    `select column_name as name, is_nullable = 'NO' as "notNull", column_default is not null as "hasDefault",
    (is_generated = 'ALWAYS' or identity_generation = 'ALWAYS') as generated
    from information_schema.columns where table_schema = '${schema}' and table_name = '${table}'`,
  );
  if (!cols.length) {
    problems.push(`${t}: missing on target`);
    continue;
  }
  problems = problems.concat(
    columnProblems(splitColumns(m.columns), cols).map((p) => `${t}: ${p}`),
  );
}
if (problems.length) {
  console.error(
    "refusing: archive does not fit the target's managed tables:\n- " + problems.join("\n- "),
  );
  process.exit(4);
}
const ext = query(url, "select name from pg_available_extensions").map((r) => r[0]);
const missingExt = report.extensions.filter((e) => e !== "plpgsql" && !ext.includes(e));
if (missingExt.length) {
  console.error(`refusing: target cannot enable extensions: ${missingExt.join(", ")}`);
  process.exit(4);
}
console.log("preflight: target is fresh; managed-table columns compatible; extensions available.");
if (opt("preflight-only")) process.exit(0);

// ---- restore (single transaction) -----------------------------------------
// pg_restore 17 emits `SET transaction_timeout`, unknown to older servers.
function sanitized(file) {
  if (server.v >= 170000) return P(file);
  const out = P(file.replace(/\.sql$/, ".pg-compat.sql"));
  const src = fs.readFileSync(P(file), "utf8").replace(/^SET transaction_timeout = 0;$/m, "");
  fs.writeFileSync(out, src, { mode: 0o600 });
  return out;
}
const queues = report.pgmqQueues || [];
const post =
  [
    "-- recreate (empty) pgmq queues used by the app's email outbox",
    ...queues.map(
      (q) =>
        `select pgmq.create('${q.replace(/'/g, "''")}') where not exists (select 1 from pg_tables where schemaname = 'pgmq' and tablename = 'q_${q.replace(/'/g, "''")}');`,
    ),
    "create schema if not exists migration_kit;",
    "revoke all on schema migration_kit from public;",
    "create table if not exists migration_kit.imports (archive text not null, manifest_sha text not null, imported_at timestamptz not null default now());",
    `insert into migration_kit.imports(archive, manifest_sha) values ('${manifest.archive.replace(/'/g, "''")}', '${manifestSha}');`,
  ].join("\n") + "\n";
fs.writeFileSync(P("post.sql"), post, { mode: 0o600 });

const files = ["-f", P("prologue.sql")];
if (!state.has_history && fs.existsSync(P("migrations-schema.sql")))
  files.push("-f", sanitized("migrations-schema.sql"));
files.push(
  "-f",
  sanitized("schema.sql"),
  "-c",
  "SET session_replication_role = replica",
  "-f",
  sanitized("data.sql"),
  "-c",
  "SET session_replication_role = origin",
  "-f",
  P("post.sql"),
);
const t0 = Date.now();
try {
  psql(url, ["--single-transaction", ...files]);
} catch (e) {
  console.error(`restore failed and was rolled back: ${e.message}`);
  process.exit(5);
}
console.log(`restore: committed in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

// ---- repository migrations newer than the archive -------------------------
const repoDir = opt("repo-migrations");
if (repoDir) {
  const files = fs
    .readdirSync(repoDir)
    .filter((f) => /^\d+_.*\.sql$/.test(f))
    .sort();
  let pending;
  const explicit = opt("pending-migrations");
  if (typeof explicit === "string") {
    const want = new Set(explicit.split(","));
    pending = files.filter((f) => want.has(f.split("_")[0]));
  } else if (
    queryJson(
      url,
      "select to_regclass('supabase_migrations.schema_migrations') is not null as h",
    )[0].h
  ) {
    const applied = new Set(
      query(url, "select version from supabase_migrations.schema_migrations").map((r) => r[0]),
    );
    pending = files.filter((f) => !applied.has(f.split("_")[0]));
  } else {
    console.error(
      "The archive has no supabase_migrations history; pass --pending-migrations <versions> explicitly.",
    );
    process.exit(6);
  }
  const hasName =
    queryJson(
      url,
      "select count(*)::int as n from information_schema.columns where table_schema='supabase_migrations' and table_name='schema_migrations' and column_name='name'",
    )[0]?.n > 0;
  for (const f of pending) {
    const version = f.split("_")[0];
    const name = f.replace(/^\d+_/, "").replace(/\.sql$/, "");
    const record = hasName
      ? `insert into supabase_migrations.schema_migrations(version, name) values ('${version}', '${name.replace(/'/g, "''")}') on conflict do nothing;`
      : `insert into supabase_migrations.schema_migrations(version) values ('${version}') on conflict do nothing;`;
    try {
      psql(url, [
        "--single-transaction",
        "-f",
        path.join(repoDir, f),
        "-c",
        `do $$ begin if to_regclass('supabase_migrations.schema_migrations') is not null then execute $q$${record}$q$; end if; end $$;`,
      ]);
      console.log(`migration applied: ${f}`);
    } catch (e) {
      console.error(`migration ${f} failed and was rolled back: ${e.message}`);
      process.exit(7);
    }
  }
  if (!pending.length) console.log("repository migrations: none pending");
}

process.exit(runVerify());
