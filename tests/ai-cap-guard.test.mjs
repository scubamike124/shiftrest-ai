// Users must not be able to raise their own AI budget (user_prefs.ai_daily_token_cap).
// The migration was also exercised on a throwaway Postgres 16 with Supabase-style
// roles: an authenticated UPDATE/INSERT/upsert kept 15000, service_role and the
// database owner could change it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

const dir = new URL("../supabase/migrations/", import.meta.url);

test("a migration guards ai_daily_token_cap against signed-in writes", () => {
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  const guard = files.filter((f) =>
    /CREATE TRIGGER user_prefs_guard_ai_cap/.test(readFileSync(new URL(f, dir), "utf8")),
  );
  assert.equal(guard.length, 1, "exactly one migration creates the guard trigger");
  const sql = readFileSync(new URL(guard[0], dir), "utf8");
  assert.match(sql, /BEFORE INSERT OR UPDATE ON public\.user_prefs/);
  assert.match(sql, /current_user IN \('authenticated', 'anon'\)/);
  assert.match(sql, /NEW\.ai_daily_token_cap := OLD\.ai_daily_token_cap/);
  assert.doesNotMatch(
    sql,
    /SECURITY DEFINER/,
    "must run as the caller so current_user is the request role",
  );
  // It must come after the migrations that create the column and the policies.
  const cap = files.findIndex((f) =>
    /ai_daily_token_cap/.test(readFileSync(new URL(f, dir), "utf8")),
  );
  assert.ok(files.indexOf(guard[0]) > cap);
});
