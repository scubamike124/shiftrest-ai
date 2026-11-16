// The user_prefs.ai_daily_token_cap guard
// (supabase/migrations/20261115060000_lock_ai_daily_token_cap.sql) on a real
// PostgreSQL database with every migration applied, including the real
// user_prefs RLS policies and grants. Requests run as the same roles
// PostgREST uses (SET ROLE authenticated/anon/service_role + JWT sub claim).
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { quoteLiteral, startMigratedDatabase } from "./_pg-supabase.mjs";

const db = startMigratedDatabase();
const skip = db.skip ? `PostgreSQL unavailable: ${db.skip}` : false;
after(() => db.stop?.());

const USER = "0c0c0c0c-0000-4000-8000-00000000000c";
const NEWCOMER = "0d0d0d0d-0000-4000-8000-00000000000d";

/** Run `body` in one transaction as `role`, with auth.uid() = sub. */
function as(role, sub, body) {
  return db.sql(`BEGIN;
SET LOCAL ROLE ${role};
SELECT set_config('request.jwt.claim.sub', ${quoteLiteral(sub ?? "")}, true);
${body}
COMMIT;`);
}
const cap = (id) =>
  db.json(
    `SELECT ai_daily_token_cap AS cap, partner_name FROM public.user_prefs WHERE user_id = ${quoteLiteral(id)}`,
  )[0];

before(() => {
  if (skip) return;
  db.sql(`INSERT INTO auth.users (id, email) VALUES (${quoteLiteral(USER)}, 'c@example.invalid'), (${quoteLiteral(NEWCOMER)}, 'd@example.invalid');
          INSERT INTO public.user_prefs (user_id, ai_daily_token_cap) VALUES (${quoteLiteral(USER)}, 60000)
          ON CONFLICT (user_id) DO UPDATE SET ai_daily_token_cap = 60000;`);
});

test(
  "a signed-in user cannot raise their cap with UPDATE; other columns still save",
  { skip },
  () => {
    as(
      "authenticated",
      USER,
      `UPDATE public.user_prefs SET ai_daily_token_cap = 2147483647, partner_name = 'Sam' WHERE user_id = ${quoteLiteral(USER)};`,
    );
    assert.deepEqual(cap(USER), { cap: 60000, partner_name: "Sam" });
  },
);

test(
  "upsert (the savePrefs path) cannot change the cap, with or without the column",
  { skip },
  () => {
    as(
      "authenticated",
      USER,
      `INSERT INTO public.user_prefs (user_id, partner_name, ai_daily_token_cap)
     VALUES (${quoteLiteral(USER)}, 'Alex', 999999)
     ON CONFLICT (user_id) DO UPDATE SET partner_name = EXCLUDED.partner_name, ai_daily_token_cap = EXCLUDED.ai_daily_token_cap;`,
    );
    assert.deepEqual(cap(USER), { cap: 60000, partner_name: "Alex" });
    as(
      "authenticated",
      USER,
      `INSERT INTO public.user_prefs (user_id, partner_name) VALUES (${quoteLiteral(USER)}, 'Robin')
     ON CONFLICT (user_id) DO UPDATE SET partner_name = EXCLUDED.partner_name;`,
    );
    assert.deepEqual(cap(USER), { cap: 60000, partner_name: "Robin" });
  },
);

test("a new row inserted by a signed-in user gets the free-tier cap", { skip }, () => {
  as(
    "authenticated",
    NEWCOMER,
    `INSERT INTO public.user_prefs (user_id, ai_daily_token_cap) VALUES (${quoteLiteral(NEWCOMER)}, 777777)
     ON CONFLICT (user_id) DO UPDATE SET ai_daily_token_cap = EXCLUDED.ai_daily_token_cap;`,
  );
  assert.equal(cap(NEWCOMER).cap, 15000);
});

test("the guard cannot be switched off from a client role", { skip }, () => {
  assert.throws(
    () =>
      as(
        "authenticated",
        USER,
        "ALTER TABLE public.user_prefs DISABLE TRIGGER user_prefs_guard_ai_cap;",
      ),
    /must be owner/,
  );
  assert.throws(
    () => as("authenticated", USER, "SET LOCAL session_replication_role = replica;"),
    /permission denied/,
  );
  assert.throws(
    () => as("authenticated", USER, "DROP FUNCTION public.guard_user_prefs_ai_cap() CASCADE;"),
    /must be owner/,
  );
});

test("anon cannot change prefs: RLS hides every row and rejects inserts", { skip }, () => {
  // anon has table privileges (Supabase default grants); RLS is what stops it.
  const before = cap(USER).cap;
  as("anon", "", `UPDATE public.user_prefs SET ai_daily_token_cap = 999999;`);
  assert.equal(cap(USER).cap, before);
  assert.throws(
    () =>
      as(
        "anon",
        "",
        `INSERT INTO public.user_prefs (user_id, ai_daily_token_cap) VALUES (gen_random_uuid(), 999999);`,
      ),
    /row-level security/,
  );
});

test("service_role and the database owner can still set the cap", { skip }, () => {
  as(
    "service_role",
    "",
    `UPDATE public.user_prefs SET ai_daily_token_cap = 300000 WHERE user_id = ${quoteLiteral(USER)};`,
  );
  assert.equal(cap(USER).cap, 300000);
  db.sql(
    `UPDATE public.user_prefs SET ai_daily_token_cap = 60000 WHERE user_id = ${quoteLiteral(USER)};`,
  );
  assert.equal(cap(USER).cap, 60000);
});

test("has_ai_budget() reads the guarded value", { skip }, () => {
  const [{ ok }] = db.json(`SELECT public.has_ai_budget(${quoteLiteral(USER)}::uuid) AS ok`);
  assert.equal(ok, true);
});

test(
  "a 'partial' ai_log row (client left after part of an answer) counts toward the allowance",
  { skip },
  () => {
    const P = "0e0e0e0e-0000-4000-8000-00000000000e";
    db.sql(`INSERT INTO auth.users (id, email) VALUES (${quoteLiteral(P)}, 'e@example.invalid');`);
    const ok = () => db.json(`SELECT public.has_ai_budget(${quoteLiteral(P)}::uuid) AS ok`)[0].ok;
    assert.equal(ok(), true, "a new user is under the default cap");
    db.sql(`INSERT INTO public.ai_log (user_id, intent, model, prompt_tokens, completion_tokens, status)
          VALUES (${quoteLiteral(P)}, 'coach', 'm', 14000, 2000, 'partial');`);
    assert.equal(ok(), false, "16000 tokens in a 'partial' row exceed the 15000 default cap");
  },
);
