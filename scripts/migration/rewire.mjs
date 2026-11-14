#!/usr/bin/env node
// Step 4 of the migration kit: recreate the database-side plumbing that a
// data restore cannot carry - Vault secrets (encrypted under the old
// project's root key) and pg_cron jobs (they call the app's host).
//
//   TARGET_DB_URL=... APP_URL=https://<host> CRON_SECRET=... SUPABASE_SERVICE_ROLE_KEY=... \
//     node scripts/migration/rewire.mjs --plan ./plan --confirm-target <ref> [--apply]
//
// Without --apply it only prints the jobs it would schedule (no secrets).
// Run --apply ONLY at cutover: once jobs are active they send real push
// notifications and emails to real users, and the Lovable backend is still
// sending them too until DNS moves.
// Secrets are read by psql's \getenv inside the database session: they are
// never on argv, never echoed and never written into cron.job.command
// (jobs read them from Vault when they fire).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertSafeTarget } from "./lib.mjs";
import { psql, queryJson } from "./pg.mjs";

const argv = process.argv.slice(2);
const opt = (name) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? undefined : argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : true;
};
const url = process.env.TARGET_DB_URL;
try {
  assertSafeTarget(url, opt("confirm-target"));
} catch (e) {
  console.error(e.message);
  process.exit(2);
}
const planDir = opt("plan");
const apply = Boolean(opt("apply"));
const appUrl = (process.env.APP_URL || "").replace(/\/+$/, "");
if (!planDir || !/^https:\/\/[a-z0-9.-]+$/i.test(appUrl)) {
  console.error(
    "usage: APP_URL=https://<host> rewire.mjs --plan <dir> --confirm-target <ref> [--apply]",
  );
  process.exit(2);
}

const here = path.dirname(fileURLToPath(import.meta.url));
const defaults = JSON.parse(fs.readFileSync(path.join(here, "cron-jobs.json"), "utf8"));
const report = JSON.parse(fs.readFileSync(path.join(planDir, "report.json"), "utf8"));
const archived = new Map(
  (report.cronJobs || []).filter((j) => j.target?.path).map((j) => [j.target.path, j]),
);

// Every app job, with the archive's live schedule when it had one.
const jobs = defaults.jobs.map((d) => {
  const live = archived.get(d.path);
  return {
    ...d,
    name: live?.jobname || d.name,
    schedule: live?.schedule || d.schedule,
    scheduleSource: live ? "archive" : "default",
  };
});
for (const [p, j] of archived) {
  if (!jobs.some((x) => x.path === p))
    console.warn(
      `review: archive job ${j.jobname} -> ${p} has no rewiring rule; recreate it by hand`,
    );
}

const lit = (s) => `'${String(s).replace(/'/g, "''")}'`;
function command(job) {
  const header =
    job.auth === "service-role"
      ? `'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = ${lit(defaults.vault.serviceRole)})`
      : `'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = ${lit(defaults.vault.cronSecret)})`;
  return `select net.http_post(url := ${lit(appUrl + job.path)}, headers := jsonb_build_object('Content-Type', 'application/json', ${header}), body := '{}'::jsonb)`;
}

console.log(`${apply ? "APPLY" : "DRY RUN"}: ${jobs.length} jobs -> ${appUrl}`);
for (const j of jobs)
  console.log(
    `- ${j.name} [${j.schedule}, ${j.scheduleSource}] POST ${j.path} (${j.auth === "service-role" ? "service-role bearer" : "x-cron-secret"} from Vault)${j.note ? " - " + j.note : ""}`,
  );
if (!apply) process.exit(0);

for (const k of ["CRON_SECRET", "SUPABASE_SERVICE_ROLE_KEY"]) {
  if (!process.env[k] || process.env[k].length < 16) {
    console.error(`${k} must be set (value is not printed)`);
    process.exit(2);
  }
}
const upsert = (name, envVar) =>
  [
    `\\getenv secret_value ${envVar}`,
    `select vault.update_secret(id, :'secret_value') from vault.secrets where name = ${lit(name)};`,
    `select vault.create_secret(:'secret_value', ${lit(name)}, 'restpilot migration kit') where not exists (select 1 from vault.secrets where name = ${lit(name)});`,
    `\\unset secret_value`,
  ].join("\n");
const sql =
  [
    "\\set QUIET on",
    "\\o /dev/null",
    "begin;",
    upsert(defaults.vault.cronSecret, "CRON_SECRET"),
    upsert(defaults.vault.serviceRole, "SUPABASE_SERVICE_ROLE_KEY"),
    ...jobs.map(
      (j) => `select cron.schedule(${lit(j.name)}, ${lit(j.schedule)}, ${lit(command(j))});`,
    ),
    "commit;",
  ].join("\n") + "\n";
psql(url, ["-f", "-"], { input: sql });
const rows = queryJson(
  url,
  `select jobname, schedule, active, command like ${lit("%" + appUrl + "%")} as targets_app,
  command !~ '(sk_|eyJ|re_[A-Za-z0-9])' as no_inline_secret from cron.job order by jobname`,
);
for (const r of rows)
  console.log(
    `scheduled ${r.jobname} [${r.schedule}] active=${r.active} targets_app=${r.targets_app} no_inline_secret=${r.no_inline_secret}`,
  );
