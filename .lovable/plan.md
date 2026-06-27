# Upgrade 3 — Notifications & Automation

Goal: deliver the right reminder at the right moment around every shift, without spamming users or waking them up. Web Push first (works on iOS 16.4+ PWA, Android, desktop), with a clean upgrade path to native push later.

## What the user gets

Five reminder types, each opt-in independently:

1. **Wind-down reminder** — fires `windDownMin` before sleep window starts. "Dim lights, screens off, warm shower."
2. **Caffeine cutoff** — fires 10 min before the computed cutoff. "Last coffee in 10 min — anything later will hit your sleep."
3. **Pre-shift bright light** — fires at wake time (shift.start − 90 min). "10–20 min bright light now to lock in alertness."
4. **Shift-end recovery** — fires at shift end. "Hydrate, light protein, start wind-down in {windDownMin} min."
5. **Quiet-hours guard** — global setting; any reminder whose fire time falls inside quiet hours is suppressed (not deferred — circadian timing matters more than the ping).

All five derive from the existing Long Clock, so they automatically respect multi-week rotations, employer overrides, and saved location.

## Anti-spam rules (hard constraints)

- Max **4 notifications per 24 h** per user.
- **30-min dedupe window**: identical kind within 30 min collapses to one.
- **Off days = silent.** No "rest day" pings.
- **Quiet hours suppress, never queue-and-dump later.**
- **Sleep window is always quiet**, even if the user forgot to set quiet hours.
- One-tap "Snooze 1 h" and "Mute today" from any notification.

## Architecture

```text
┌────────────────────┐    every 5 min     ┌──────────────────────────┐
│ pg_cron (Supabase) │ ─────────────────► │ /api/public/hooks/notify │
└────────────────────┘                    └────────────┬─────────────┘
                                                       │
                              for each user with prefs.notifications_enabled
                                                       │
                                          buildLongClock(shift, today, prefs)
                                          + quiet-hours + dedupe + daily cap
                                                       │
                                                       ▼
                                       Web Push (VAPID) → user device(s)
                                                       │
                              Service Worker shows notification + action btns
```

- **No always-on background tabs.** Server-driven via pg_cron + Web Push, so it fires whether the app is open or not.
- **Service worker** (`public/sw.js`) handles `push`, `notificationclick`, and the Snooze / Mute actions.

## Data model

Three new tables (RLS on, scoped to `auth.uid()`):

- `push_subscriptions` — `endpoint`, `p256dh`, `auth`, `user_agent`, `last_seen_at`. One row per device.
- `notification_prefs` — per-user toggles for the 5 kinds, quiet-hours start/end, daily cap (default 4), `timezone`.
- `notification_log` — `kind`, `scheduled_for`, `sent_at`, `suppressed_reason` (quiet-hours / cap / dedupe / off-day). Powers dedupe + a "Recent reminders" view in Profile.

## Server pieces

- `/api/public/hooks/notify` — pg_cron target, runs every 5 min. Anon-key auth header. Inside: loads candidate users, builds today's Long Clock, filters by toggles + quiet hours + cap + log dedupe, sends via `web-push` (Node-compatible, edge-safe).
- `subscribePush` / `unsubscribePush` server fns — manage `push_subscriptions` for the current user.
- `sendTestNotification` server fn — fires a single push to the calling user (for the Profile "Send test" button).

## Secrets

- `VAPID_PUBLIC_KEY` — public, fine in client bundle.
- `VAPID_PRIVATE_KEY` — generated via `generate_secret`, server-only.
- `VAPID_SUBJECT` — `mailto:` contact for push providers.

## UI

New **Notifications** section in `src/routes/profile.tsx` (replaces today's lightweight `notify.ts` block):

- Master toggle "Enable reminders" — triggers `Notification.requestPermission()` and registers the SW + subscription on first enable.
- Five per-kind switches with one-line explanations and the typical fire time relative to today's shift.
- Quiet-hours range picker (default 22:00–07:00, follows device TZ).
- Daily cap slider (1–6, default 4).
- "Send test notification" button.
- "Recent reminders" list — last 10 entries from `notification_log` with status (sent / suppressed: reason).
- Clear unsupported-browser state for iOS < 16.4 with "Add to Home Screen" instructions.

Mobile-first: stacked rows, 44 px tap targets, sticky save bar, no horizontal scroll at 375 px.

## Files

New:
- `public/sw.js`
- `src/lib/push/vapid.server.ts`
- `src/lib/push/subscribe.functions.ts` (subscribe / unsubscribe / sendTest)
- `src/lib/notifications/schedule.ts` (pure: derive due reminders from Long Clock + prefs + log)
- `src/lib/notifications/copy.ts` (notification titles/bodies per kind)
- `src/routes/api/public/hooks/notify.ts`
- `src/components/NotificationsSection.tsx`

Changed:
- `src/routes/profile.tsx` — swap legacy notify block for `<NotificationsSection />`.
- `src/lib/notify.ts` — deprecate in favor of server-driven push; keep a tiny shim that calls `subscribePush`.
- `src/routes/__root.tsx` — register `/sw.js` once on mount.

## Migration

```text
push_subscriptions, notification_prefs, notification_log
+ RLS policies (user_id = auth.uid())
+ GRANTs to authenticated + service_role
+ updated_at triggers
pg_cron: every 5 min → /api/public/hooks/notify
```

## Out of scope (call out so we don't scope-creep)

- Native iOS/Android push (requires Capacitor wrapper — already on the "later" list).
- SMS reminders (Twilio cost; can add via connector if you want it).
- Email digests.
- Partner/co-pilot notifications (belongs in Partner Mode upgrade).

## Acceptance criteria

1. Enabling reminders on iOS PWA, Android Chrome, and desktop Chrome registers a subscription row.
2. With a saved shift starting in 2 h, manually triggering the hook fires the pre-shift bright-light push.
3. A reminder scheduled inside quiet hours never sends and shows up in the log as `suppressed: quiet-hours`.
4. Daily cap of 4 is respected; the 5th is suppressed as `suppressed: cap`.
5. Off-day = zero pushes.
6. Disabling a kind stops it within one cron cycle.
7. "Send test notification" works on all three platforms.
8. Typecheck clean, no runtime errors at 375 px and desktop.

Approve and I'll start implementing in that order: migration → VAPID + SW → subscribe fn → schedule engine → cron hook → Profile UI → cron registration → live verification.
