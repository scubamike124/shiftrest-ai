# Backend Delivery Fix (Two Changes Only)

Scope is strictly backend/delivery. No UI, no scheduling, no exact-time behavior changes.

## Change 1 — Dispatcher payload `kind`

File: `src/routes/api/public/hooks/dispatch-alarms.ts` (line 92)

- Replace `kind: "alarm"` with `kind: "smart-alarm"` in the `sendPushToUser` payload.
- This is the only line changed in the file. Everything else (auth, atomic claim, ilike filter, rollback) stays as-is.

Reason: the service worker's alarm-notification branch keys off `kind === "smart-alarm"`. With `"alarm"`, the SW falls through to the default push branch — Apple accepts the push (`sent:2`) but iOS surfaces it as a plain notification (or silently), not as the locked-screen alarm.

## Change 2 — Cron target → production URL

Currently cron job `restpilot-dispatch-alarms` (jobid 3) targets:
`https://project--8243527a-2b83-4fe2-aa6d-60b0ae194313-dev.lovable.app/api/public/hooks/dispatch-alarms`

Repoint to the stable production URL:
`https://project--8243527a-2b83-4fe2-aa6d-60b0ae194313.lovable.app/api/public/hooks/dispatch-alarms`

Applied via `supabase--insert` (not a migration — contains project-specific URL + key):

```sql
select cron.unschedule('restpilot-dispatch-alarms');
select cron.schedule(
  'restpilot-dispatch-alarms',
  '* * * * *',
  $$
  select net.http_post(
    url:='https://project--8243527a-2b83-4fe2-aa6d-60b0ae194313.lovable.app/api/public/hooks/dispatch-alarms',
    headers:='{"Content-Type":"application/json","apikey":"<SUPABASE_PUBLISHABLE_KEY>"}'::jsonb,
    body:='{}'::jsonb
  ) as request_id;
  $$
);
```

## Verification

1. `tsgo` typecheck.
2. Publish → Update (server-route change deploys automatically, but the payload change affects what the SW receives; SW is unchanged so no SW rotation needed. Still confirm Build ID rotates after Update so the new server bundle is live).
3. Confirm new cron job row targets the production URL; watch `net._http_response` for a 200.
4. Set a 2-minute alarm on the iPhone PWA, lock the phone.
5. Query `user_events` + `net._http_response`; expect `scanned:1, claimed:1, sent:≥1`.
6. Confirm the locked-screen alarm notification appears with the smart-alarm behavior.

## Files touched

- `src/routes/api/public/hooks/dispatch-alarms.ts` — one-line payload change.
- Cron config in Postgres — unschedule + reschedule with production URL.

Nothing else is modified.
