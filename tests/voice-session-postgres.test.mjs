// The live-voice ledger functions and the has_ai_budget lockdown
// (supabase/migrations/20261115070000_voice_session_ledger_and_budget_rpc_lockdown.sql)
// on a real PostgreSQL with every migration applied, called as the roles
// PostgREST uses. Includes real concurrent sessions at the budget boundary.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { after, before, test } from "node:test";
import { quoteLiteral, startMigratedDatabase } from "./_pg-supabase.mjs";

const db = startMigratedDatabase();
const skip = db.skip ? `PostgreSQL unavailable: ${db.skip}` : false;
after(() => db.stop?.());

const A = "0a0a0a0a-0000-4000-8000-00000000000a";
const B = "0b0b0b0b-0000-4000-8000-00000000000b";
const q = (id) => quoteLiteral(id);
const used = (id) =>
  db.json(`SELECT coalesce(sum(total_tokens),0)::int AS n FROM public.ai_log WHERE user_id = ${q(id)}`)[0].n;
const call = (role, sqlText) => db.sql(`SET ROLE ${role};\n${sqlText}`);
const claim = (id, sid, debit, cap) => {
  db.sql(`UPDATE public.user_prefs SET ai_daily_token_cap = ${cap} WHERE user_id = ${q(id)}`);
  return db.json(`SELECT public.claim_voice_session(${q(id)}, ${q(sid)}, ${debit}, 210) AS v`, { role: "service_role" })[0].v;
};

before(() => {
  if (skip) return;
  db.sql(`INSERT INTO auth.users (id, email) VALUES (${q(A)}, 'a@example.invalid'), (${q(B)}, 'b@example.invalid');
          INSERT INTO public.user_prefs (user_id) VALUES (${q(A)}), (${q(B)}) ON CONFLICT DO NOTHING;`);
});

test("has_ai_budget cannot be called by signed-in or anonymous users, only the backend", { skip }, () => {
  for (const role of ["authenticated", "anon"]) {
    assert.throws(() => call(role, `SELECT public.has_ai_budget(${q(B)});`), /permission denied/, role);
  }
  const ok = db.json(`SELECT public.has_ai_budget(${q(B)}) AS v`, { role: "service_role" });
  assert.equal(ok[0].v, true);
});

test("voice RPCs are service_role only", { skip }, () => {
  for (const role of ["authenticated", "anon"]) {
    for (const stmt of [
      `SELECT public.claim_voice_session(${q(A)}, 'x', 10, 210);`,
      `SELECT public.end_voice_session(${q(A)}, 'x', -10, 'ok');`,
      `SELECT public.charge_voice_overage(${q(A)}, 'x', 0, 10);`,
    ]) {
      assert.throws(() => call(role, stmt), /permission denied/, `${role}: ${stmt}`);
    }
  }
});

test("claim: ok under the cap; refused (and nothing written) when the debit does not fit; one active session", { skip }, () => {
  assert.equal(claim(A, "s-over", 15000, 15000), "exhausted"); // used 0 + 15000 is not < 15000
  assert.equal(used(A), 0);
  assert.equal(claim(A, "s-ok", 14999, 15000), "ok");
  assert.equal(used(A), 14999);
  assert.equal(claim(A, "s-second", 1, 500000), "active");
  assert.equal(used(A), 14999, "refused claim wrote nothing");
});

test("end: refund clamped to the debit, once, only for the owner; overage charged once per bucket", { skip }, () => {
  const end = (id, sid, delta) =>
    db.json(`SELECT public.end_voice_session(${q(id)}, ${q(sid)}, ${delta}, 'ok') AS v`, { role: "service_role" })[0].v;
  assert.equal(end(B, "s-ok", -100), null, "another user cannot end it");
  assert.equal(end(A, "s-ok", -999999), -14999, "refund can never exceed the debit");
  assert.equal(used(A), 0);
  assert.equal(end(A, "s-ok", -5), null, "replay does nothing");
  assert.equal(used(A), 0);
  assert.equal(end(A, "unknown", -5), null);
  // a new session is allowed after the first ended; positive delta is overage
  assert.equal(claim(A, "s-2", 1000, 500000), "ok");
  assert.equal(end(A, "s-2", 700), 700);
  assert.equal(used(A), 1700);
  assert.equal(claim(A, "s-3", 1000, 500000), "ok");
  const over = (b) =>
    db.json(`SELECT public.charge_voice_overage(${q(A)}, 's-3', ${b}, 500) AS v`, { role: "service_role" })[0].v;
  assert.equal(over(0), true);
  assert.equal(over(0), false, "same bucket is charged once");
  assert.equal(over(1), true);
  assert.equal(
    db.json(`SELECT public.charge_voice_overage(${q(B)}, 's-3', 9, 500) AS v`, { role: "service_role" })[0].v,
    false,
    "wrong user",
  );
});

test("parallel mints at the budget boundary cannot overshoot the cap or both become active", { skip }, async () => {
  db.sql(`DELETE FROM public.ai_log WHERE user_id IN (${q(A)}, ${q(B)})`);
  // Two different users share nothing; the race is one user firing N claims at once.
  // Cap 25,000 and debit 10,000: only two debits could fit, but only ONE session may be active.
  db.sql(`UPDATE public.user_prefs SET ai_daily_token_cap = 25000 WHERE user_id = ${q(A)}`);
  const run = (sid) =>
    new Promise((resolve, reject) => {
      const p = spawn("psql", ["-X", "-q", "-At", "--no-psqlrc", "-d", db.url, "-c",
        `SELECT public.claim_voice_session(${q(A)}, '${sid}', 10000, 210)`], { stdio: ["ignore", "pipe", "pipe"] });
      let out = "";
      p.stdout.on("data", (d) => (out += d));
      p.on("close", (c) => (c === 0 ? resolve(out.trim()) : reject(new Error("psql " + c))));
    });
  // service_role is not needed for this superuser connection; the function is the unit under test.
  const results = await Promise.all(Array.from({ length: 8 }, (_, i) => run(`race-${i}`)));
  assert.equal(results.filter((r) => r === "ok").length, 1, results.join());
  assert.equal(results.filter((r) => r === "active").length, 7, results.join());
  assert.equal(used(A), 10000);
  // boundary: after ending (refund all), 3 parallel claims where only one debit fits under cap
  const firstSid = db.json(`SELECT intent FROM public.ai_log WHERE user_id = ${q(A)} AND intent LIKE 'rt-mint:%'`)[0].intent.slice(8);
  db.sql(`SELECT public.end_voice_session(${q(A)}, '${firstSid}', -10000, 'ok')`);
  db.sql(`UPDATE public.user_prefs SET ai_daily_token_cap = 10001 WHERE user_id = ${q(A)}`);
  const more = await Promise.all(Array.from({ length: 5 }, (_, i) => run(`edge-${i}`)));
  assert.equal(more.filter((r) => r === "ok").length, 1, more.join());
  assert.ok(used(A) <= 10001 && used(A) === 10000, `used ${used(A)}`);
});

// Deterministic: hold a claim's transaction open and fire a second claim while it
// is uncommitted. With the advisory lock the second call waits for the first and
// then sees it as active. Without the lock it cannot see the uncommitted row and
// would also answer "ok" (two active sessions), so this test fails.
const psqlBg = (sqlText) =>
  new Promise((resolve, reject) => {
    const p = spawn("psql", ["-X", "-q", "-At", "--no-psqlrc", "-d", db.url, "-c", sqlText], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    p.stdout.on("data", (d) => (out += d));
    p.on("close", (c) => (c === 0 ? resolve(out.trim().split("\n")[0]) : reject(new Error("psql " + c))));
  });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test("the per-user advisory lock serialises claims (fails if the lock is removed)", { skip }, async () => {
  db.sql(`DELETE FROM public.ai_log WHERE user_id = ${q(A)}`);
  db.sql(`UPDATE public.user_prefs SET ai_daily_token_cap = 500000 WHERE user_id = ${q(A)}`);
  const first = psqlBg(
    `SELECT public.claim_voice_session(${q(A)}, 'lock-1', 10000, 210); SELECT pg_sleep(1.5);`,
  );
  await sleep(400);
  const started = Date.now();
  const second = await psqlBg(`SELECT public.claim_voice_session(${q(A)}, 'lock-2', 10000, 210)`);
  assert.equal(await first, "ok");
  assert.equal(second, "active", "second claim must wait for the first, then see it active");
  assert.ok(Date.now() - started >= 600, "second claim actually waited on the lock");
  assert.equal(used(A), 10000);
});

test("the lock also protects the budget boundary (only one of two debits fits)", { skip }, async () => {
  db.sql(`DELETE FROM public.ai_log WHERE user_id = ${q(A)}`);
  db.sql(`UPDATE public.user_prefs SET ai_daily_token_cap = 15000 WHERE user_id = ${q(A)}`);
  const first = psqlBg(
    `SELECT public.claim_voice_session(${q(A)}, 'edge-1', 10000, 210); SELECT pg_sleep(1.5);`,
  );
  await sleep(400);
  const second = await psqlBg(`SELECT public.claim_voice_session(${q(A)}, 'edge-2', 10000, 210)`);
  assert.equal(await first, "ok");
  assert.notEqual(second, "ok");
  assert.ok(used(A) <= 14999);
});
