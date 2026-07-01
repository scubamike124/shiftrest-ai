# Phase 4 — Push Enrollment on Alarm Create

## Final Readiness Review

1. **Reuses existing infra.** Uses `pushSupported()`, `ensureServiceWorker()`, `ensurePushSubscription()`, `subscriptionPayload()` from `src/lib/notifications/client.ts` and the existing `subscribePush` server fn in `src/lib/push/subscribe.functions.ts`. No new VAPID, SW, or table work.
2. **No duplicate subscriptions.** `subscribePush` upserts on `(user_id, endpoint)`. `pushManager.getSubscription()` short-circuits if a subscription already exists, so a repeat schedule is a no-op upsert.
3. **Existing notification features unchanged.** `NotificationsSection` continues to use the same helpers. No edits to `sw-src.ts`, `web-push.server.ts`, `dispatch-alarms.ts`, cron, or `notification_prefs`.
4. **Alarm scheduling is decoupled.** Enrollment runs in `scheduleMutation.onSuccess` inside a try/catch — a push failure never blocks alarm creation. The row already exists in `user_events`; the foreground timer path is untouched.
5. **Denied permission fails gracefully.** If `Notification.permission === "denied"`, we show a single non-blocking toast ("Notifications blocked — enable in Settings → Safari → Notifications to get locked-screen alarms") and return. No re-prompt loop.
6. **Non-installed Safari.** If `pushSupported()` is false or (iOS Safari AND not standalone), we show a one-time "Add to Home Screen for reliable alarms" toast with a link opening the existing `SmartAlarmCoach` install instructions. Detection: `/iP(hone|ad|od)/.test(ua)` + `!window.matchMedia('(display-mode: standalone)').matches && !navigator.standalone`.
7. **No migration for existing users.** Purely additive client behavior gated on next alarm create. Users with an existing push subscription simply re-upsert the same row.

## Implementation Scope

Single file touched: `src/components/SmartAlarmCard.tsx`.

Add a helper `ensureAlarmPushEnrollment()` (local to the file or as `src/lib/alarm/push-enroll.ts` if cleaner) that:

```
if (!signedIn) return;
if (!pushSupported()) { maybeShowInstallToast(); return; }
if (Notification.permission === "denied") { showBlockedToast(); return; }
if (Notification.permission === "default") {
  const res = await Notification.requestPermission();
  if (res !== "granted") { if (res === "denied") showBlockedToast(); return; }
}
const sub = await ensurePushSubscription();
if (!sub) return;
await subscribePush({ data: subscriptionPayload(sub) });
```

Wire it into `scheduleMutation.onSuccess` (after the existing `createEvent` success path near line 197), wrapped in try/catch that only `console.warn`s — never toasts an error on top of the "Alarm set" success toast.

**Not in scope (per request):**
- No Snooze, no Stop.
- No SW `notificationclick` action changes.
- No dispatch route changes.
- No cron changes.
- No `notification_prefs` UI changes.

## Rollback

Revert the single `SmartAlarmCard.tsx` diff (and delete `push-enroll.ts` if extracted). Nothing server-side changes.

## Verification After Implementation

- `tsgo` typecheck green.
- Publish → Update.
- `curl https://shift-rest-ai.lovable.app/api/public/version` → new `buildId`, report it.
- On iPhone PWA: schedule an alarm, tap Allow at the prompt, then check `select count(*) from push_subscriptions where user_id = <me>` returned ≥ 1 with fresh `last_seen_at`.
- Seed a due alarm 60s out, invoke dispatch route manually, expect response to move from `{noSubs:1}` → `{sent:1}`.

STOP after report. Await approval + your locked-screen device test before Phase 5.
