#!/usr/bin/env node
// Step 3 of the migration kit: prove the target holds exactly the archive's
// data. Read-only against the target.
//
//   TARGET_DB_URL=... node scripts/migration/verify.mjs --plan ./plan --confirm-target <ref>
//
// Checks, per table restored: row count and an order-independent sha256 of
// the COPY text (same algorithm as plan.mjs over the archive). Also: auth
// account/password-hash counts, identities per provider, sequence values,
// RLS enabled on every table that had it, and policy count.
// --allow-growth: after the app has gone live on the target, accept tables
// that only grew (checksums are then reported, not enforced).
import fs from "node:fs";
import path from "node:path";
import { assertSafeTarget, redactUrl } from "./lib.mjs";
import { copyDigest, queryJson } from "./pg.mjs";

const argv = process.argv.slice(2);
const opt = (name) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? undefined : argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : true;
};
const planDir = opt("plan");
const url = process.env.TARGET_DB_URL;
const allowGrowth = Boolean(opt("allow-growth"));
try {
  assertSafeTarget(url, opt("confirm-target"));
} catch (e) {
  console.error(e.message);
  process.exit(2);
}
if (!planDir) {
  console.error("usage: verify.mjs --plan <dir> --confirm-target <ref> [--allow-growth]");
  process.exit(2);
}

const manifest = JSON.parse(fs.readFileSync(path.join(planDir, "manifest.json"), "utf8"));
const results = [];
let failures = 0;
const fail = (msg) => {
  failures++;
  results.push({ ok: false, check: msg });
};
const pass = (msg) => results.push({ ok: true, check: msg });

console.log(`verify: target ${redactUrl(url)}; archive ${manifest.archive}`);
const tableRows = [];
for (const [table, exp] of Object.entries(manifest.tables)) {
  let got;
  // import.mjs appends newer repository migrations to the history table;
  // compare only the archive's versions there.
  const where =
    table === "supabase_migrations.schema_migrations" && manifest.migrationHistory?.length
      ? ` WHERE version = ANY (ARRAY[${manifest.migrationHistory.map((v) => `'${v.replace(/'/g, "''")}'`).join(",")}])`
      : "";
  try {
    got = await copyDigest(url, table + where, exp.columns);
  } catch (e) {
    fail(`${table}: ${e.message}`);
    continue;
  }
  const sameCount = got.rows === exp.rows;
  const sameSum = got.sha256 === exp.sha256;
  tableRows.push({
    table,
    expectedRows: exp.rows,
    actualRows: got.rows,
    checksum: sameSum ? "match" : "DIFF",
  });
  if (sameCount && sameSum) continue;
  if (allowGrowth && got.rows >= exp.rows) {
    pass(`${table}: grew ${exp.rows} -> ${got.rows} (allowed)`);
    continue;
  }
  fail(
    `${table}: expected ${exp.rows} rows sha ${exp.sha256.slice(0, 12)}, got ${got.rows} rows sha ${got.sha256.slice(0, 12)}`,
  );
}
const matched = tableRows.filter(
  (t) => t.checksum === "match" && t.expectedRows === t.actualRows,
).length;
pass(`${matched}/${Object.keys(manifest.tables).length} tables match row count and checksum`);

const [acct] = queryJson(
  url,
  `select count(*)::int as users,
  count(*) filter (where encrypted_password ~ '^\\$2[aby]\\$')::int as bcrypt,
  count(*) filter (where coalesce(encrypted_password, '') !~ '^\\$2[aby]\\$')::int as without_password
  from auth.users`,
);
const a = manifest.auth;
const acctOk = allowGrowth
  ? acct.users >= a.users && acct.bcrypt >= a.bcryptPasswords
  : acct.users === a.users &&
    acct.bcrypt === a.bcryptPasswords &&
    acct.without_password === a.withoutPassword;
(acctOk ? pass : fail)(
  `auth.users ${acct.users} (expected ${a.users}); bcrypt hashes ${acct.bcrypt} (expected ${a.bcryptPasswords}); without password ${acct.without_password} (expected ${a.withoutPassword})`,
);
const providers = Object.fromEntries(
  queryJson(url, "select provider, count(*)::int as n from auth.identities group by 1").map((r) => [
    r.provider,
    r.n,
  ]),
);
for (const [p, n] of Object.entries(a.identitiesByProvider)) {
  const ok = allowGrowth ? (providers[p] || 0) >= n : providers[p] === n;
  (ok ? pass : fail)(`identities[${p}] ${providers[p] || 0} (expected ${n})`);
}

// Entitlements, including lifetime purchases (offer retired for new
// customers; existing lifetime access must carry over unchanged).
if (manifest.entitlements && Object.keys(manifest.entitlements.subscriptionsByStatus).length) {
  const byStatus = Object.fromEntries(
    queryJson(url, "select status, count(*)::int as n from public.subscriptions group by 1").map(
      (r) => [r.status, r.n],
    ),
  );
  const byPrice = Object.fromEntries(
    queryJson(url, "select price_id, count(*)::int as n from public.subscriptions group by 1").map(
      (r) => [r.price_id, r.n],
    ),
  );
  for (const [k, n] of Object.entries(manifest.entitlements.subscriptionsByStatus)) {
    const ok = allowGrowth ? (byStatus[k] || 0) >= n : byStatus[k] === n;
    (ok ? pass : fail)(`subscriptions status=${k}: ${byStatus[k] || 0} (expected ${n})`);
  }
  for (const [k, n] of Object.entries(manifest.entitlements.subscriptionsByPrice)) {
    const ok = allowGrowth ? (byPrice[k] || 0) >= n : byPrice[k] === n;
    (ok ? pass : fail)(`subscriptions price=${k}: ${byPrice[k] || 0} (expected ${n})`);
  }
}

for (const s of manifest.sequences) {
  const [row] = queryJson(url, `select last_value::bigint as v, is_called from ${s.sequence}`);
  const ok = allowGrowth
    ? Number(row.v) >= s.value
    : Number(row.v) === s.value && row.is_called === s.isCalled;
  (ok ? pass : fail)(`sequence ${s.sequence} = ${row.v} (expected ${s.value})`);
}

if (manifest.rls.tablesWithRls.length) {
  const list = manifest.rls.tablesWithRls
    .map((t) => `'${t.replace(/'/g, "''")}'::regclass`)
    .join(",");
  const off = queryJson(
    url,
    `select c.oid::regclass::text as t from pg_class c where c.oid in (${list}) and not c.relrowsecurity`,
  );
  (off.length ? fail : pass)(
    `RLS enabled on ${manifest.rls.tablesWithRls.length - off.length}/${manifest.rls.tablesWithRls.length} tables${off.length ? ": missing on " + off.map((r) => r.t).join(", ") : ""}`,
  );
}
const [pol] = queryJson(
  url,
  "select count(*)::int as n from pg_policies where schemaname not in ('realtime','vault','cron','pgmq','net','supabase_functions','extensions','graphql','graphql_public')",
);
(pol.n >= manifest.rls.policies ? pass : fail)(
  `${pol.n} app RLS policies on target (archive ${manifest.rls.policies})`,
);

// Repository migrations import.mjs planned on top of the archive must all be applied.
const [mk] = queryJson(
  url,
  "select to_regclass('migration_kit.repo_migrations') is not null as present",
);
if (mk.present) {
  const rows = queryJson(
    url,
    "select version, applied_at is not null as applied from migration_kit.repo_migrations order by version",
  );
  const missing = rows.filter((r) => !r.applied).map((r) => r.version);
  (missing.length ? fail : pass)(
    `repository migrations applied ${rows.length - missing.length}/${rows.length}${missing.length ? "; still pending: " + missing.join(", ") + " (re-run import.mjs)" : ""}`,
  );
}

// Objects the app build needs, regardless of how import.mjs was run.
const required = JSON.parse(
  fs.readFileSync(new URL("./required-objects.json", import.meta.url), "utf8"),
);
const lit = (s) => `'${s.replace(/'/g, "''")}'`;
const missingObjects = queryJson(
  url,
  `select name from (values ${[
    ...required.tables.map((t) => `(${lit(t)}, to_regclass(${lit(t)}) is not null)`),
    ...required.functions.map((f) => `(${lit(f)}, to_regprocedure(${lit(f)}) is not null)`),
  ].join(",")}) v(name, present) where not present`,
).map((r) => r.name);
(missingObjects.length ? fail : pass)(
  `required app objects present ${required.tables.length + required.functions.length - missingObjects.length}/${required.tables.length + required.functions.length}${missingObjects.length ? "; missing: " + missingObjects.join(", ") : ""}`,
);

const report = {
  target: redactUrl(url),
  archive: manifest.archive,
  allowGrowth,
  failures,
  tables: tableRows,
  checks: results,
};
const outFile = path.join(planDir, "verify-report.json");
fs.writeFileSync(outFile, JSON.stringify(report, null, 2) + "\n", { mode: 0o600 });
for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"} ${r.check}`);
console.log(
  failures
    ? `VERIFY FAILED: ${failures} problem(s). Report: ${outFile}`
    : `VERIFY PASSED. Report: ${outFile}`,
);
process.exit(failures ? 1 : 0);
