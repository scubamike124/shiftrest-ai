# Smart Alarm Web Push Backstop — Phased Execution Plan

## Implementation Readiness Review

1. **Dependencies already present**
   - `push_subscriptions` table with VAPID keys (`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`) — confirmed in secrets.
   - `web-push` helpers already used by existing notification routes.
   - `user_events` table exists (holds alarms with `firesAt`).
   - `pg_cron` + `pg_net` extensions already enabled (used by existing `ai-learn` nightly job).
   - Service worker (`sw-src.ts`) already handles `push` events for other notification kinds.
   - No new npm packages required.

2. **No duplicate delivery paths**
   - Foreground `setTimeout` chime stays unchanged as best-effort.
   - New path = server push → SW notification. The SW `notificationclick` handler focuses the app; the foreground chime only rings if the app is already open.
   - `dispatched_at` column guarantees each alarm event is pushed exactly once (idempotent guard in dispatch route).

3. **Existing users unaffected during rollout**
   - Migration only **adds** a nullable `dispatched_at timestamptz` column — no data rewrite, no default backfill needed.
   - Existing alarms continue to fire via current foreground path.
   - Push backstop only activates for users who (a) have a `push_subscriptions` row and (b) schedule a new alarm after Phase 4 client wiring ships. Phases 1–3 are server-only and inert to end users.

4. **Rollback per phase**
   - Phase 1: `ALTER TABLE user_events DROP COLUMN dispatched_at;` (safe — no code reads it yet).
   - Phase 2: Delete route file `src/routes/api/public/hooks/dispatch-alarms.ts`. No client references.
   - Phase 3: `SELECT cron.unschedule('dispatch-smart-alarms');`. Dispatch route becomes dormant.

5. **Independent phase testing**
   - Phase 1: verify column exists via `\d user_events`; typecheck passes (types regen after migration).
   - Phase 2: `curl -X POST` the dispatch route with a manually seeded near-future `user_events` row → confirm push received on a subscribed test device, `dispatched_at` set.
   - Phase 3: query `cron.job_run_details` after 2 minutes → confirm scheduled invocations return HTTP 200; leave one seeded row to verify end-to-end dispatch on the tick.

---

## Phase Sequence (execute one at a time, wait for approval between)

### Phase 1 — Database migration
- Add `dispatched_at timestamptz NULL` to `public.user_events`.
- Add partial index: `CREATE INDEX ON user_events (fires_at) WHERE dispatched_at IS NULL AND kind = 'smart-alarm';`
- **Rollback:** `DROP COLUMN dispatched_at` + `DROP INDEX`.
- **Verify:** column present, index present, typecheck green.

### Phase 2 — Dispatch route
- New file: `src/routes/api/public/hooks/dispatch-alarms.ts`.
- Behavior: select `user_events` where `kind='smart-alarm'`, `dispatched_at IS NULL`, `fires_at BETWEEN now() AND now() + interval '90 seconds'`. For each, look up user's `push_subscriptions`, send Web Push payload `{type:'alarm', firesAt, eventId, label}`, then `UPDATE user_events SET dispatched_at = now()`.
- Auth: `apikey` header must equal Supabase anon key (per public-hook convention).
- **Rollback:** delete file.
- **Verify:** manual `curl` with seeded row → push arrives; row marked dispatched; second call is a no-op.

### Phase 3 — Cron scheduling
- `SELECT cron.schedule('dispatch-smart-alarms','* * * * *', $$ SELECT net.http_post(url:='https://project--8243527a-2b83-4fe2-aa6d-60b0ae194313.lovable.app/api/public/hooks/dispatch-alarms', headers:='{"Content-Type":"application/json","apikey":"<anon>"}'::jsonb, body:='{}'::jsonb); $$);`
- **Rollback:** `cron.unschedule('dispatch-smart-alarms')`.
- **Verify:** `cron.job_run_details` shows minute-tick 200 responses.

## STOP — end of Phase 3 report will include
- Typecheck status
- Migration status (column + index)
- Dispatch verification (curl + `dispatched_at` proof)
- Cron verification (`job_run_details` sample)
- Any unexpected issues
- **Locked-screen device test to run:** Install PWA on iPhone → grant notifications → seed an alarm 2 min out via `/qa.smart-alarm` → lock the phone → wait → confirm notification appears at ±10s of target with the phone still locked.

Phase 4 (client subscribe + SW `notificationclick` + Snooze) will not start until you confirm the locked-screen push arrived.
