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

let alreadyImported = false;
if (state.has_marker) {
  const prior = query(
    url,
    `select manifest_sha from migration_kit.imports order by imported_at desc limit 1`,
  )[0]?.[0];
  if (prior !== manifestSha) {
    console.error(
      "refusing: the target already holds a different import. Use a fresh project for a new export.",
    );
    process.exit(3);
  }
  // Same archive: never restore twice, but finish any repository migration
  // that did not complete last time, then verify.
  console.log("This archive was already imported into this target; resuming after the restore.");
  alreadyImported = true;
}
if (!alreadyImported && (state.auth_users > 0 || state.app_tables_present > 0)) {
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
// Which repository migrations go on top of the export. Decided from the
// manifest and the repo directory alone, BEFORE anything is restored, so a
// history gap is caught by --preflight-only and never leaves a half-done
// target behind.
const repoDir = opt("repo-migrations");
let repoChosen = [];
if (repoDir) {
  const files = fs
    .readdirSync(repoDir)
    .filter((f) => /^\d+_.*\.sql$/.test(f))
    .sort();
  const versionOf = (f) => f.split("_")[0];
  const explicit = opt("pending-migrations");
  const history = manifest.migrationHistory || [];
  if (typeof explicit === "string" && explicit.length) {
    const want = new Set(
      explicit
        .split(",")
        .map((v) => v.trim())
        .filter(Boolean),
    );
    repoChosen = files.filter((f) => want.has(versionOf(f)));
    if (repoChosen.length !== want.size) {
      console.error("refusing: some --pending-migrations versions have no file in " + repoDir);
      process.exit(6);
    }
  } else if (history.length) {
    const newest = [...history].sort().at(-1);
    repoChosen = files.filter((f) => versionOf(f) > newest);
    const gaps = files.filter((f) => versionOf(f) <= newest && !history.includes(versionOf(f)));
    if (gaps.length) {
      // A newer live migration must not hide these: refuse instead of
      // silently skipping repository migrations the export lacks.
      console.error(
        `refusing: ${gaps.length} repository migration(s) are missing from the export's history but older than its newest entry (${newest}): ${gaps.map(versionOf).join(", ")}. Check them against the live schema, then pass the versions to apply with --pending-migrations (runner: PENDING_MIGRATIONS).`,
      );
      process.exit(6);
    }
  } else {
    console.error(
      "refusing: the archive has no supabase_migrations history; pass --pending-migrations <versions> (runner: PENDING_MIGRATIONS).",
    );
    process.exit(6);
  }
  console.log(
    `preflight: repository migrations to apply after the restore: ${repoChosen.map(versionOf).join(", ") || "none"}`,
  );
}
if (opt("preflight-only")) process.exit(0);
if (!alreadyImported) restore();

// ---- restore (single transaction) -----------------------------------------
function restore() {
  // pg_restore 17 emits `SET transaction_timeout`, unknown to older servers.
  function sanitized(file) {
    if (server.v >= 170000) return P(file);
    const out = P(file.replace(/\.sql$/, ".pg-compat.sql"));
    const src = fs.readFileSync(P(file), "utf8").replace(/^SET transaction_timeout = 0;$/m, "");
    fs.writeFileSync(out, src, { mode: 0o600 });
    return out;
  }
  // pgmq >= 1.4 makes queue tables extension members, so a real export may
  // list none; fall back to the queues the app's migrations create.
  const kitDefaults = JSON.parse(fs.readFileSync(path.join(here, "cron-jobs.json"), "utf8"));
  const queues = [...new Set([...(report.pgmqQueues || []), ...kitDefaults.pgmqQueues])].sort();
  const post =
    [
      "-- recreate (empty) pgmq queues used by the app's email outbox",
      "do $$ begin if exists (select 1 from pg_extension where extname = 'pgmq') then",
      ...queues.map(
        (q) =>
          `  if to_regclass('pgmq.q_${q.replace(/'/g, "''")}') is null then perform pgmq.create('${q.replace(/'/g, "''")}'); end if;`,
      ),
      "end if; end $$;",
      "create schema if not exists migration_kit;",
      "revoke all on schema migration_kit from public;",
      "create table if not exists migration_kit.imports (archive text not null, manifest_sha text not null, imported_at timestamptz not null default now());",
      "create table if not exists migration_kit.repo_migrations (version text primary key, name text not null, applied_at timestamptz);",
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
}

// ---- repository migrations newer than the archive -------------------------
// The set to apply is fixed once (stored in migration_kit.repo_migrations)
// and each is applied in its own transaction together with its bookkeeping,
// so a failed run resumes exactly where it stopped. verify.mjs fails while
// any planned migration is unapplied.
if (repoDir) {
  const versionOf = (f) => f.split("_")[0];
  const planned = query(url, "select version from migration_kit.repo_migrations").map((r) => r[0]);
  if (!planned.length) {
    const values = repoChosen
      .map((f) => `('${versionOf(f)}', '${f.replace(/'/g, "''")}')`)
      .join(",");
    if (values)
      psql(url, [
        "-c",
        `insert into migration_kit.repo_migrations(version, name) values ${values} on conflict do nothing`,
      ]);
  }
  const todo = query(
    url,
    "select name from migration_kit.repo_migrations where applied_at is null order by version",
  ).map((r) => r[0]);
  const hasHistory = queryJson(
    url,
    "select to_regclass('supabase_migrations.schema_migrations') is not null as h",
  )[0].h;
  const hasName =
    hasHistory &&
    queryJson(
      url,
      "select count(*)::int as n from information_schema.columns where table_schema='supabase_migrations' and table_name='schema_migrations' and column_name='name'",
    )[0]?.n > 0;
  for (const f of todo) {
    const version = versionOf(f);
    const name = f
      .replace(/^\d+_/, "")
      .replace(/\.sql$/, "")
      .replace(/'/g, "''");
    const book = [
      `update migration_kit.repo_migrations set applied_at = now() where version = '${version}';`,
      hasHistory
        ? hasName
          ? `insert into supabase_migrations.schema_migrations(version, name) values ('${version}', '${name}') on conflict do nothing;`
          : `insert into supabase_migrations.schema_migrations(version) values ('${version}') on conflict do nothing;`
        : "",
    ].join("\n");
    try {
      psql(url, ["--single-transaction", "-f", path.join(repoDir, f), "-c", book]);
      console.log(`migration applied: ${f}`);
    } catch (e) {
      console.error(`migration ${f} failed and was rolled back (re-run to resume): ${e.message}`);
      process.exit(7);
    }
  }
  if (!todo.length) console.log("repository migrations: none pending");
}

process.exit(runVerify());
