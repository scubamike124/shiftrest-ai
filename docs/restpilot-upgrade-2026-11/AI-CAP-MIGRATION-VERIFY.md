# Verify the AI daily-cap lock (database migration), separately from publishing the website

_Nov 15 2026. Covers `supabase/migrations/20261115060000_lock_ai_daily_token_cap.sql` (PR #76)._

## What the migration does
Before it, any signed-in user could raise their own daily AI allowance by writing `user_prefs.ai_daily_token_cap` from the browser (the table lets owners update their own row, and `has_ai_budget()` reads that column). The migration adds a trigger, `user_prefs_guard_ai_cap`, that runs before every INSERT or UPDATE on `public.user_prefs`. For the `authenticated` and `anon` roles it keeps the stored cap on UPDATE and forces the default (15,000) on INSERT. `service_role` (the backend) and the database owner may still set it. No other column is affected. It is protective and reversible.

## What is known and what is not
Known from the repo:
- The migration file is plain SQL in `supabase/migrations/`; the Supabase project id in `supabase/config.toml` is `czsgjqfcjiuqirvmdlps`.
- `docs/launch/production-checklist.md` and `security-report.md` record earlier migrations as "applied" by Lovable Cloud, and the website code in `main` is served by Lovable after the owner presses **Publish** (`AI-CONSENT-AND-APPLE-SIGNIN.md`).
- Tests prove the migration works on a real PostgreSQL with the repo's own policies (`tests/ai-cap-guard-postgres.test.mjs`).

Not known (I cannot see Lovable or the live database from here):
- Whether Lovable applies a new migration file when `main` changes, when Publish is pressed, or only when asked inside Lovable. Do not assume it is applied because the code merged.
- Whether the live database already has the trigger (the Railway line has an equivalent migration, but that is a different deployment).

So: check the database directly, using the read-only queries below. This is independent of the website publish.

## How to apply it if the check says it is missing
Pick one (all are the owner's decision; I have not done any of them):
1. In Lovable, ask it to apply the pending migration from `main` (it manages the database for this project).
2. In the Supabase dashboard for the project, open **SQL Editor**, paste the full contents of `supabase/migrations/20261115060000_lock_ai_daily_token_cap.sql`, and run it. It is idempotent (`CREATE OR REPLACE` / `DROP TRIGGER IF EXISTS`), so running it twice is harmless.
Then run the checks again.

## Checks you can run on an iPhone (Supabase dashboard, SQL Editor)
All of these are read-only or are rolled back automatically.

### 1. Does the trigger exist and is it enabled?
```sql
select tgname, tgenabled, pg_get_triggerdef(oid) as definition
from pg_trigger
where tgrelid = 'public.user_prefs'::regclass
  and not tgisinternal;
```
Expected: a row named `user_prefs_guard_ai_cap`, `tgenabled` = `O` (enabled), definition `BEFORE INSERT OR UPDATE ... EXECUTE FUNCTION guard_user_prefs_ai_cap()`. No such row = migration not applied.

### 2. Does the function exist?
```sql
select proname, prosecdef as security_definer
from pg_proc
where proname = 'guard_user_prefs_ai_cap'
  and pronamespace = 'public'::regnamespace;
```
Expected: one row, `security_definer` = `false` (it must run as the caller so it can tell the request role).

### 3. Safe negative test (changes nothing)
This pretends to be a signed-in user, tries to raise a cap to 999,999, reports what the table holds, then deliberately errors so the whole thing is rolled back. It uses an existing row and keeps no change.
```sql
do $$
declare
  uid uuid;
  before_cap int;
  after_cap int;
begin
  select user_id, ai_daily_token_cap into uid, before_cap
  from public.user_prefs limit 1;
  if uid is null then
    raise exception 'No user_prefs row to test with';
  end if;
  perform set_config('request.jwt.claim.sub', uid::text, true);
  set local role authenticated;
  update public.user_prefs set ai_daily_token_cap = 999999 where user_id = uid;
  select ai_daily_token_cap into after_cap from public.user_prefs where user_id = uid;
  raise exception 'ROLLED BACK TEST: cap before=% after attempted raise=% (protected if equal and not 999999)', before_cap, after_cap;
end $$;
```
Expected: an error message (that is the point; it rolls everything back) reading `cap before=X after attempted raise=X`. If `after` shows `999999`, the lock is NOT in place. Nothing is saved either way.

## Rollback (removes the protection)
```sql
drop trigger if exists user_prefs_guard_ai_cap on public.user_prefs;
drop function if exists public.guard_user_prefs_ai_cap();
```
This returns users to being able to edit their own cap, so only do it if the trigger causes a problem.

## What the live site does before and after
- **Before the migration (code from PR #76 published, trigger missing):** budget checks, fail-closed errors and usage accrual all work, but a user who writes `ai_daily_token_cap` directly can still raise their own allowance. This is the open hole.
- **After the migration:** writes to that column from signed-in or anonymous requests are ignored (the stored value stays). Saving other preferences (voice, partner name, etc.) works as before. The backend can still change a cap.
- **Order does not matter for safety.** The migration is safe to apply before or after the code is published; it only touches the one column's write path.
