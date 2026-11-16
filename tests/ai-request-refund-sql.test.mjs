// The refund of an AI request the provider failed
// (supabase/migrations/20261116090000_ai_request_refund.sql).
//
// 1. Static checks of the migration text (always run): the limits did not move,
//    only service_role may call, the refund lock/lookup shape.
// 2. The same migration on a REAL PostgreSQL (only the stand-ins for Supabase's
//    auth.users and roles): refund once, twice, concurrently, another user's
//    token, after the day rolled over, never below zero, the minute counter
//    stays consumed, and an outage cannot lock a customer out.
//    Runs when psql plus PostgreSQL server binaries are installed (or
//    RESTPILOT_TEST_DATABASE_URL points at a disposable server); otherwise it
//    is skipped, and under CI (process.env.CI) a missing database is an error.
import assert from "node:assert/strict";
import { execFile, execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { after, before } from "node:test";

const MIGRATIONS = new URL("../supabase/migrations/", import.meta.url);
const ADMISSION = "20261113090000_ai_request_admission.sql";
const REFUND = "20261116090000_ai_request_refund.sql";
const read = (f) => fs.readFileSync(new URL(f, MIGRATIONS), "utf8");

// ---------------------------------------------------------------- 1. static

test("static: the 30 a minute and 300 a day limits are exactly the original's", () => {
  const original = read(ADMISSION);
  const next = read(REFUND);
  for (const re of [/day_count >= 300/, /minute_count >= 30/, /interval '1 minute'/]) {
    assert.match(original, re);
    assert.match(next, re);
  }
  assert.doesNotMatch(next, /day_count >= (?!300\b)\d+/);
  assert.doesNotMatch(next, /minute_count >= (?!30\b)\d+/);
  // The consume body is the original's, plus the ledger insert and the token.
  const body = (sql) =>
    sql
      .split("create or replace function public.consume_ai_request")[1]
      .split("revoke all on function public.consume_ai_request")[0]
      .replace(/\s+/g, " ");
  const stripped = body(next)
    .replace(/ request_token uuid;/, "")
    .replace(/ -- Earlier days[\s\S]*?returning token into request_token;/, "")
    .replace(/, 'token', request_token\)/, ")");
  assert.equal(stripped.trim(), body(original).trim());
});

test("static: only service_role can call either function or read the ledger", () => {
  const sql = read(REFUND);
  for (const fn of ["consume_ai_request(uuid)", "refund_ai_request(uuid, uuid)"]) {
    assert.match(
      sql,
      new RegExp(
        `revoke all on function public\\.${fn.replace(/[()]/g, "\\$&")} from public, anon, authenticated;`,
      ),
    );
    assert.match(
      sql,
      new RegExp(
        `grant execute on function public\\.${fn.replace(/[()]/g, "\\$&")} to service_role;`,
      ),
    );
  }
  assert.match(sql, /alter table public\.ai_request_ledger enable row level security;/);
  assert.match(sql, /revoke all on public\.ai_request_ledger from public, anon, authenticated;/);
  assert.equal((sql.match(/security definer/g) ?? []).length, 2);
  assert.equal((sql.match(/set search_path = ''/g) ?? []).length, 2);
});

test("static: the refund touches only the day counter, never below zero, and keeps the minute counter", () => {
  const refund = read(REFUND).split("create or replace function public.refund_ai_request")[1];
  assert.match(refund, /set day_count = greatest\(day_count - 1, 0\)/);
  assert.doesNotMatch(refund, /minute_count\s*=/);
  assert.doesNotMatch(refund, /minute_started\s*=/);
  // Locks the user's allowance row FIRST (as consume does), then the ledger row; the user is in the lookup.
  assert.ok(
    refund.indexOf("from public.ai_request_allowance") <
      refund.indexOf("from public.ai_request_ledger"),
  );
  assert.match(refund, /where token = _token and user_id = _user_id for update/);
  assert.match(refund, /entry\.state <> 'consumed'/);
  assert.match(refund, /entry\.day_started <> today/);
});

test("static: has_ai_budget and the token allowance are untouched by this migration", () => {
  const code = read(REFUND).replace(/^\s*--.*$/gm, "");
  assert.doesNotMatch(code, /has_ai_budget|ai_log|ai_daily_token_cap/);
});

// ------------------------------------------------------------ 2. real PostgreSQL

const asPgUser = (cmd, args) => {
  if (process.getuid?.() === 0) {
    const quoted = [cmd, ...args].map((a) => `'${String(a).replaceAll("'", "'\\''")}'`).join(" ");
    return execFileSync("su", ["postgres", "-s", "/bin/sh", "-c", quoted], { stdio: "pipe" });
  }
  return execFileSync(cmd, args, { stdio: "pipe" });
};

function findPgBin() {
  const dirs = [];
  if (process.env.PG_BIN) dirs.push(process.env.PG_BIN);
  try {
    for (const v of fs.readdirSync("/usr/lib/postgresql").sort().reverse()) {
      dirs.push(`/usr/lib/postgresql/${v}/bin`);
    }
  } catch {
    /* not installed */
  }
  return dirs.find(
    (d) => fs.existsSync(path.join(d, "initdb")) && fs.existsSync(path.join(d, "pg_ctl")),
  );
}

let skip = null;
let cluster = null;
let url = null;
let baseUrl = null;
const dbName = `refund_test_${process.pid}`;

const psql = (target, args, input) =>
  execFileSync(
    "psql",
    ["-X", "-q", "-v", "ON_ERROR_STOP=1", "--no-psqlrc", "-d", target, ...args],
    {
      input,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    },
  );

/** Run statements as `role` (default: the superuser) and return stdout. */
const sql = (text, role) => psql(url, ["-f", "-"], role ? `set role ${role};\n${text}` : text);
/** One value (a SELECT of a single scalar/jsonb), trimmed. */
const one = (query, role) =>
  psql(url, ["-At", "-f", "-"], `${role ? `set role ${role};\n` : ""}${query};`)
    .trim()
    .split("\n")
    .pop();

before(() => {
  const have = spawnSync("psql", ["--version"]).status === 0;
  let base = process.env.RESTPILOT_TEST_DATABASE_URL;
  if (!have) skip = "psql is not installed";
  else if (!base) {
    const bin = findPgBin();
    if (!bin) skip = "no RESTPILOT_TEST_DATABASE_URL and no local PostgreSQL server binaries";
    else {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "restpilot-refund-pg-"));
      if (process.getuid?.() === 0) execFileSync("chown", ["postgres", dir]);
      const port = 20000 + Math.floor(Math.random() * 20000);
      asPgUser(path.join(bin, "initdb"), [
        "-D",
        path.join(dir, "data"),
        "-A",
        "trust",
        "-U",
        "postgres",
        "--no-sync",
      ]);
      asPgUser(path.join(bin, "pg_ctl"), [
        "-D",
        path.join(dir, "data"),
        "-w",
        "-l",
        path.join(dir, "log"),
        "-o",
        `-p ${port} -k ${dir} -c listen_addresses='' -c fsync=off`,
        "start",
      ]);
      cluster = { dir, bin };
      base = `postgresql://postgres@localhost:${port}/postgres?host=${encodeURIComponent(dir)}`;
    }
  }
  if (skip) {
    if (process.env.CI)
      throw new Error(`the PostgreSQL-backed refund tests are required in CI: ${skip}`);
    return;
  }
  baseUrl = base;
  psql(base, ["-c", `drop database if exists ${dbName}`]);
  psql(base, ["-c", `create database ${dbName}`]);
  const u = new URL(base);
  u.pathname = `/${dbName}`;
  url = u.toString();
  sql(`
    do $$ begin create role anon nologin; exception when duplicate_object or unique_violation then null; end $$;
    do $$ begin create role authenticated nologin; exception when duplicate_object or unique_violation then null; end $$;
    do $$ begin create role service_role nologin bypassrls; exception when duplicate_object or unique_violation then null; end $$;
    grant usage on schema public to anon, authenticated, service_role;
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
    create schema auth;
    create table auth.users (id uuid primary key default gen_random_uuid());
    grant usage on schema auth to service_role;
  `);
  sql(read(ADMISSION));
  sql(read(REFUND));
});

after(() => {
  if (skip) return;
  if (!cluster && baseUrl) {
    try {
      psql(baseUrl, ["-c", `drop database if exists ${dbName} with (force)`]);
    } catch {
      /* best effort */
    }
  }
  if (cluster) {
    try {
      asPgUser(path.join(cluster.bin, "pg_ctl"), [
        "-D",
        path.join(cluster.dir, "data"),
        "-m",
        "immediate",
        "stop",
      ]);
    } catch {
      /* already gone */
    }
    fs.rmSync(cluster.dir, { recursive: true, force: true });
  }
});

const db = (name, fn) =>
  test(`postgres: ${name}`, async (t) => {
    if (skip) return t.skip(skip);
    await fn(t);
  });

const newUser = () => one(`insert into auth.users default values returning id`);
const consume = (u) => JSON.parse(one(`select public.consume_ai_request('${u}')`, "service_role"));
const refund = (u, token) =>
  JSON.parse(one(`select public.refund_ai_request('${u}', '${token}')`, "service_role"));
const counts = (u) =>
  JSON.parse(
    one(
      `select jsonb_build_object('day', day_count, 'minute', minute_count, 'day_started', day_started::text) from public.ai_request_allowance where user_id = '${u}'`,
    ),
  );
const ledger = (u) =>
  JSON.parse(
    one(
      `select coalesce(jsonb_agg(jsonb_build_object('token', token, 'state', state, 'day', day_started::text) order by token), '[]') from public.ai_request_ledger where user_id = '${u}'`,
    ),
  );

db("consume still admits 30 a minute and 300 a day, and returns an opaque token", () => {
  const u = newUser();
  const first = consume(u);
  assert.equal(first.allowed, true);
  assert.equal(first.retry_after_seconds, 0);
  assert.match(first.token, /^[0-9a-f-]{36}$/);
  for (let i = 1; i < 30; i++) assert.equal(consume(u).allowed, true);
  const denied = consume(u);
  assert.equal(denied.allowed, false);
  assert.ok(denied.retry_after_seconds >= 1 && denied.retry_after_seconds <= 60);
  assert.equal(denied.token, undefined, "a refused request has no token");
  assert.equal(ledger(u).length, 30, "only admitted requests are in the ledger");
});

db("refund once: the day counter goes back by one, the minute counter stays consumed", () => {
  const u = newUser();
  const { token } = consume(u);
  assert.deepEqual(counts(u).day, 1);
  assert.deepEqual(refund(u, token), { refunded: true });
  const c = counts(u);
  assert.equal(c.day, 0);
  assert.equal(c.minute, 1, "the minute counter is never refunded");
  assert.equal(ledger(u)[0].state, "refunded");
});

db("refund twice: the second is a no-op", () => {
  const u = newUser();
  consume(u);
  const { token } = consume(u);
  assert.deepEqual(refund(u, token), { refunded: true });
  assert.deepEqual(refund(u, token), { refunded: false, reason: "already_refunded" });
  assert.deepEqual(refund(u, token), { refunded: false, reason: "already_refunded" });
  assert.equal(counts(u).day, 1, "one refund of two requests");
});

db("a failed ledger insert rolls back the admission debit", () => {
  const u = newUser();
  consume(u);
  sql(`create function public.fail_ledger_insert() returns trigger language plpgsql as $$
       begin raise exception 'injected ledger write failure'; end $$;
       create trigger fail_ledger_insert before insert on public.ai_request_ledger
       for each row execute function public.fail_ledger_insert()`);
  try {
    assert.throws(() => consume(u), /injected ledger write failure/);
    assert.equal(counts(u).day, 1, "no debit can survive without its ledger token");
    assert.equal(counts(u).minute, 1);
    assert.equal(ledger(u).length, 1);
  } finally {
    sql(`drop trigger fail_ledger_insert on public.ai_request_ledger;
         drop function public.fail_ledger_insert()`);
  }
  assert.equal(consume(u).allowed, true, "admission recovers after the database failure");
  assert.equal(counts(u).day, 2);
});

db("a failed counter refund rolls back its ledger state and remains safe to retry", () => {
  const u = newUser();
  const { token } = consume(u);
  sql(`create function public.fail_allowance_update() returns trigger language plpgsql as $$
       begin raise exception 'injected counter write failure'; end $$;
       create trigger fail_allowance_update before update on public.ai_request_allowance
       for each row execute function public.fail_allowance_update()`);
  try {
    assert.throws(() => refund(u, token), /injected counter write failure/);
    assert.equal(counts(u).day, 1, "a failed refund grants no allowance");
    assert.equal(ledger(u)[0].state, "consumed", "the earlier ledger update is rolled back");
  } finally {
    sql(`drop trigger fail_allowance_update on public.ai_request_allowance;
         drop function public.fail_allowance_update()`);
  }
  assert.deepEqual(refund(u, token), { refunded: true });
  assert.deepEqual(refund(u, token), { refunded: false, reason: "already_refunded" });
  assert.equal(counts(u).day, 0, "retry grants exactly the original single debit");
  assert.equal(counts(u).minute, 1);
});

db("concurrent refunds of one token: exactly one wins", async () => {
  const u = newUser();
  for (let i = 0; i < 4; i++) consume(u);
  const { token } = consume(u);
  assert.equal(counts(u).day, 5);
  const runs = await Promise.all(
    Array.from(
      { length: 12 },
      () =>
        new Promise((resolve, reject) =>
          execFile(
            "psql",
            [
              "-X",
              "-At",
              "-q",
              "--no-psqlrc",
              "-d",
              url,
              "-c",
              `set role service_role; select public.refund_ai_request('${u}', '${token}')`,
            ],
            (err, out) => (err ? reject(err) : resolve(out.trim().split("\n").pop())),
          ),
        ),
    ),
  );
  const refunded = runs.map((r) => JSON.parse(r)).filter((r) => r.refunded === true);
  assert.equal(refunded.length, 1);
  assert.equal(counts(u).day, 4, "decremented exactly once");
});

db(
  "concurrent refunds of different tokens, with consumes in between, never lose or double count",
  async () => {
    const u = newUser();
    const tokens = Array.from({ length: 6 }, () => consume(u).token);
    const run = (q) =>
      new Promise((resolve, reject) =>
        execFile(
          "psql",
          ["-X", "-At", "-q", "--no-psqlrc", "-d", url, "-c", `set role service_role; ${q}`],
          (e, o) => (e ? reject(e) : resolve(o.trim().split("\n").pop())),
        ),
      );
    const out = await Promise.all([
      ...tokens.flatMap((t) => [
        run(`select public.refund_ai_request('${u}', '${t}')`),
        run(`select public.refund_ai_request('${u}', '${t}')`),
      ]),
      ...Array.from({ length: 4 }, () => run(`select public.consume_ai_request('${u}')`)),
    ]);
    const refunded = out.map((o) => JSON.parse(o)).filter((o) => o.refunded === true).length;
    const admitted = out.map((o) => JSON.parse(o)).filter((o) => o.allowed === true).length;
    assert.equal(refunded, 6, "each of the 6 tokens refunded exactly once");
    assert.equal(admitted, 4);
    assert.equal(counts(u).day, 6 + 4 - 6);
  },
);

db("another user's token refunds nothing and does not spend the owner's refund", () => {
  const a = newUser();
  const b = newUser();
  const { token } = consume(a);
  consume(b);
  assert.deepEqual(refund(b, token), { refunded: false, reason: "unknown_request" });
  assert.equal(counts(a).day, 1);
  assert.equal(counts(b).day, 1);
  assert.deepEqual(refund(a, token), { refunded: true }, "the owner can still refund it");
  // A user who never consumed anything, an unknown token and nulls.
  const c = newUser();
  assert.deepEqual(refund(c, token), { refunded: false, reason: "unknown_request" });
  assert.deepEqual(refund(a, "00000000-0000-4000-8000-000000000000"), {
    refunded: false,
    reason: "unknown_request",
  });
  assert.deepEqual(JSON.parse(one(`select public.refund_ai_request(null, null)`, "service_role")), {
    refunded: false,
    reason: "invalid",
  });
});

db("refund after the UTC day rolled over: no refund, the new day's counter is untouched", () => {
  const u = newUser();
  const { token } = consume(u);
  // The day passes: the request and the counter are from yesterday.
  sql(`update public.ai_request_ledger set day_started = day_started - 1 where user_id = '${u}';
       update public.ai_request_allowance set day_started = day_started - 1 where user_id = '${u}'`);
  assert.deepEqual(refund(u, token), { refunded: false, reason: "window_closed" });
  assert.equal(counts(u).day, 1);
  // The next consume starts the new day at 1 and prunes yesterday's ledger rows.
  const next = consume(u);
  assert.equal(counts(u).day, 1);
  assert.deepEqual(
    ledger(u).map((r) => r.token),
    [next.token],
  );
  assert.deepEqual(refund(u, token), { refunded: false, reason: "unknown_request" });
  assert.equal(counts(u).day, 1);
  assert.deepEqual(refund(u, next.token), { refunded: true });
  assert.equal(counts(u).day, 0);
});

db("the counter never goes below zero", () => {
  const u = newUser();
  const { token } = consume(u);
  sql(`update public.ai_request_allowance set day_count = 0 where user_id = '${u}'`);
  assert.deepEqual(refund(u, token), { refunded: true });
  assert.equal(counts(u).day, 0);
  // And many refunds in a row cannot go negative either.
  const tokens = Array.from({ length: 3 }, () => consume(u).token);
  sql(`update public.ai_request_allowance set day_count = 1 where user_id = '${u}'`);
  for (const t of tokens) refund(u, t);
  assert.equal(counts(u).day, 0);
});

db("abuse bound: refunds never raise the 30 a minute limit", () => {
  const u = newUser();
  let admitted = 0;
  for (let i = 0; i < 45; i++) {
    const r = consume(u);
    if (r.allowed) {
      admitted += 1;
      assert.equal(refund(u, r.token).refunded, true);
    }
  }
  assert.equal(admitted, 30, "a failing provider cannot be hit faster than 30 a minute");
  const c = counts(u);
  assert.equal(c.day, 0);
  assert.equal(c.minute, 30);
});

db("lock-out: an outage no longer uses up the 300 a day (and 300 real answers still do)", () => {
  const u = newUser();
  const burn = (n, failed) => {
    for (let i = 0; i < n; i++) {
      // Each minute window is fresh, as it is across a day of ordinary use.
      sql(
        `update public.ai_request_allowance set minute_started = now() - interval '2 minutes', minute_count = 0 where user_id = '${u}'`,
      );
      const r = consume(u);
      assert.equal(r.allowed, true, `request ${i + 1}`);
      if (failed) assert.equal(refund(u, r.token).refunded, true);
    }
  };
  burn(250, true); // a long outage: 250 requests, none answered
  assert.equal(counts(u).day, 0);
  burn(299, false); // then a normal day of 299 answered requests
  assert.equal(counts(u).day, 299);
  burn(1, false);
  sql(
    `update public.ai_request_allowance set minute_started = now() - interval '2 minutes', minute_count = 0 where user_id = '${u}'`,
  );
  const denied = consume(u);
  assert.equal(denied.allowed, false, "300 answered requests still stop the day");
  // For contrast, the pre-refund behaviour: 300 failures alone would have been a lock-out.
  const v = newUser();
  for (let i = 0; i < 300; i++) {
    sql(
      `update public.ai_request_allowance set minute_started = now() - interval '2 minutes', minute_count = 0 where user_id = '${v}'`,
    );
    consume(v);
  }
  assert.equal(counts(v).day, 300);
});

db("service_role only: anon and authenticated cannot consume, refund or read the ledger", () => {
  const u = newUser();
  const { token } = consume(u);
  for (const role of ["anon", "authenticated"]) {
    assert.throws(
      () => sql(`select public.refund_ai_request('${u}', '${token}')`, role),
      /permission denied/,
    );
    assert.throws(() => sql(`select public.consume_ai_request('${u}')`, role), /permission denied/);
    assert.throws(() => sql(`select * from public.ai_request_ledger`, role), /permission denied/);
  }
  assert.equal(counts(u).day, 1);
});

db("deleting a user removes their ledger rows", () => {
  const u = newUser();
  consume(u);
  sql(`delete from auth.users where id = '${u}'`);
  assert.equal(one(`select count(*) from public.ai_request_ledger where user_id = '${u}'`), "0");
});
