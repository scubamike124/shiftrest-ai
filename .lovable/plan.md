# Smart Alarm — Preview-Only Verification Test

## Goal

Determine whether the shelved Smart Alarm code path actually fires an iOS Web Push notification end-to-end on an installed PWA, so we can decide if Phase 1 restoration is a UI-flip or a rebuild.

## Scope Guardrails

- Flag flip lives on **preview only** — production stays at `SMART_ALARM_ENABLED = false`.
- No schema changes, no cron changes, no VAPID rotation.
- Test device: user's iPhone, PWA opened **from Home Screen icon** (not Safari tab). iOS Web Push does not deliver in a browser tab context — this must be confirmed before the alarm is set.
- After the test, flag flips back to `false` regardless of outcome.

## Steps

1. **Preview-only flag flip**
   - Edit `src/lib/flags.ts`: `SMART_ALARM_ENABLED = import.meta.env.DEV || window.location.hostname.includes('id-preview--')`
   - This keeps production hard-off; only the preview URL (`id-preview--...lovable.app`) enables the feature.
   - Verify SmartAlarmCard renders on preview, does not render on production build.

2. **User pre-flight (screenshots requested in the report)**
   - Confirm PWA is installed: home-screen icon exists, tapping it opens standalone (no Safari chrome).
   - Screenshot: Settings → Notifications → RestPilot AI (permission = Allow, Sounds on, Banners on, Lock Screen on).
   - Screenshot: Settings → Focus (nothing active — no Sleep, no DND, no Personal/Work focus).
   - Note iOS version and whether the PWA was opened from icon vs. tab.

3. **Alarm test**
   - Open PWA from home-screen icon.
   - Grant notification permission if prompted (first-run only).
   - Set a 2-minute Smart Alarm with a distinct title (e.g. "test-2min-A").
   - Lock the phone immediately. Do not touch it.
   - Wait 3 minutes.

4. **Capture result**
   - Exactly one of: notification fires with sound / fires silent / fires late / does not fire.
   - If it fires: note delay from scheduled time.
   - If it doesn't: unlock, reopen PWA, screenshot any in-app state.

5. **Backend evidence pull (regardless of outcome)**
   - `dispatch-alarms` function logs for the test window — did the row get scanned, did `web-push` return 201, or 404/410/timeout?
   - `push_subscriptions` row for this device — endpoint present, `expiration_time` value.
   - `smart_alarms` row for "test-2min-A" — `dispatched_at` set?

6. **Revert**
   - Flip `SMART_ALARM_ENABLED` back to `false` on preview.
   - No production deploy in this plan.

## Report Addendum

Update the docx report with a new section:

- **Test context:** installed PWA vs. browser tab (per user requirement).
- **Permission + Focus state** at test time (from screenshots).
- **Outcome + backend evidence** table.
- **Known platform reliability gap (new):** iOS Web Push subscriptions are documented to silently expire after ~1–2 weeks of inactivity, requiring PWA reinstall + resubscribe. Even a green test today does not mean Phase 1 is production-ready without a fallback (e.g. local notification, SMS via Twilio, or scheduled email) or a resubscribe-on-launch flow.

## Decision Matrix (what the outcome means)

| Result | Interpretation | Next action |
|---|---|---|
| Fires on time, with sound | Existing code is functional. Shelving was premature. | Plan Phase 1 restoration + resubscribe-on-launch flow for the 1–2 week expiry gap. |
| Fires late / silent | Delivery works, config bug (payload, sound field, priority). | Small targeted fix, re-test, then Phase 1 with fallback. |
| Does not fire, backend shows 201 sent | On-device delivery gap (iOS/APNs). Focus, permission, or subscription expiry. | Check subscription `expiration_time`, resubscribe, re-test. |
| Does not fire, backend shows scan-miss or 404/410 | Server path still broken (case-sensitivity, endpoint stale, VAPID subject). | Fix server, re-test before any Phase 1 discussion. |
| Does not fire, no backend activity at all | Cron/pg_net not hitting the function on preview URL. | Verify cron target URL matches preview build. |

## What I Need From You

- Confirm plan.
- Then: screenshots (permission + Focus), confirmation the PWA was opened from the home-screen icon, and the alarm title you used. I'll pull the backend logs and write up the addendum.

## Out of Scope

- Any production deploy.
- Rebuilding on a new provider (OneSignal, FCM, Twilio) — that's a Phase 2 decision after this test.
- Rotating VAPID keys or touching `push_subscriptions` schema.
