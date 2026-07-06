# Smart Alarm — actual history and current on-disk state

I traced this via chat history (messages #1122, #1190–#1204, #1240–#1262 for delivery; #1263–#1266 for shelving; #1678 for cleanup) and the files still in the repo. Below is what the record actually shows — not a summary.

## Terminology check

Chat history and the codebase show **two delivery mechanisms**, both built in-house against the same Smart Alarm UI. **No third-party alarm provider (OneSignal, FCM, Twilio, SmartThings, etc.) was ever integrated or attempted.** Every push we sent went out via Apple's own Web Push endpoint (`web.push.apple.com`) using our own VAPID keys and the `web-push` npm package — Apple is not a "provider" we signed up for, it's the browser-mandated endpoint for iOS PWA Web Push. If by "two providers" you meant two external services, that framing doesn't match the history — I want to flag that before you decide next steps.

The two mechanisms are:

## Mechanism 1 — Foreground `setTimeout` scheduler

**Purpose:** Fire the alarm from the open PWA tab using a JS timer, no server involvement.

**Code (still on disk, dormant behind flag):**
- `src/lib/alarm/foreground.ts` (250 LOC) — scheduler, `MAX_DELAY_MS = 6 * 60 * 60 * 1000`
- `src/lib/alarm/sounds.ts` (268 LOC) — WebAudio playback
- `src/lib/alarm/prefs.ts` (53 LOC)
- Rendered by `src/components/SmartAlarmCard.tsx` (419 LOC)

**Failure — actual observed behavior (message #1122):**
> "The foreground alarm scheduler in `src/lib/alarm/foreground.ts` enforces a **hard 6-hour cap** (`MAX_DELAY_MS = 6 * 60 * 60 * 1000`). Any alarm whose scheduled time is more than 6h out is silently not scheduled."

Beyond that, the fundamental problem on iOS installed-PWA is that Safari suspends JS timers when the tab is backgrounded or the phone is locked — a `setTimeout` set for 06:30 does not fire if the phone was locked at 22:00. This wasn't an error message; it was a category-level limitation of the mechanism.

**Root cause identified?** Yes, definitively — no `setTimeout` can survive iOS backgrounding.

## Mechanism 2 — Server-scheduled Web Push (VAPID → Apple Web Push → SW)

**Purpose:** Backstop for mechanism 1 so alarms fire while the phone is locked.

**Code (still on disk, dormant behind flag):**
- `src/routes/api/public/hooks/dispatch-alarms.ts` (122 LOC) — cron endpoint that scans `user_events` for `title ILIKE 'alarm:%'` and sends via `web-push`
- `src/lib/alarm/push-enroll.ts` (94 LOC) — client-side subscription
- `public/sw-src.ts` (218 LOC) — service worker `push` handler with `kind === "smart-alarm"` branch
- `push_subscriptions` DB table, VAPID keys (`VAPID_PUBLIC_KEY`/`_PRIVATE_KEY`/`_SUBJECT` secrets), `pg_cron` job `restpilot-dispatch-alarms`

**Failures — real logs from actual attempts:**

Test 1 (message #1242), 8:17 PM alarm:
```
title: "Alarm: 8:17 PM"
dispatched_at: 2026-07-01 03:16:00.130Z
Cron tick 03:16: { "scanned": 1, "claimed": 1, "sent": 2, "noSubs": 0, "rolledBack": 0 }
Apple Web Push subscriptions: 2 active web.push.apple.com endpoints
No 404/410. No backend errors. Apple accepted the push.
```
Backend succeeded; nothing appeared on the phone. Two issues were identified from that trace:
- Payload sent `kind: "alarm"`; SW alarm branch keys off `kind === "smart-alarm"` → SW fell through to the plain-push branch, no `requireInteraction`, no alarm styling.
- Production cron job was pointing at the `-dev.lovable.app` preview URL, not the published production URL.

Both fixed the same night (message #1246).

Test 2 (message #1248), 8:27 PM alarm — after the fixes:
```
title: "Alarm: 8:27 PM"     (capital A)
dispatched_at: NULL         (never claimed)
Cron ticks 03:26/03:27/03:28/03:29: { "scanned": 0, ... }  every time
```
Reproduction with two rows inserted 30s ahead of the next tick:
```
"Alarm: TEST-CAPS"  (capital A) → scanned:0, never dispatched
"alarm: test-lower" (lowercase)  → scanned:1, sent:2, dispatched 03:33:00
```

**Root cause:** The deployed production build of `dispatch-alarms.ts` still had `.like("title", "alarm:%")` (case-sensitive) even though the repo already had `.ilike`. Every new alarm from the UI was written with capital `Alarm:` and no cron tick would ever match it.

**The fix that shipped:** `SmartAlarmCard.tsx` now writes `alarm: <time>` in lowercase (message #1250), and `dispatch-alarms.ts` uses `.ilike`. Whether the case-sensitive server route was ever re-verified in production is unclear because of what happened next:

**What actually stopped the work (messages #1252–#1262):** Repeated Publish → Update clicks failed to rotate the production build ID. Production stayed pinned at `b-1782871310335` (built 02:01:50Z) while preview kept rolling forward to `b-1782878396127` and beyond. Investigation concluded it was a Lovable platform/promotion issue, not application code. The lowercase-title fix and `.ilike` fix were never validated end-to-end in production because production wouldn't accept a new build during the debugging window.

**Root cause identified?** Partially. The delivery-layer bugs (payload `kind`, cron URL, case-sensitive filter) were identified and fixed in the source. Whether that fixed version ever actually reached production and delivered a locked-screen notification was never confirmed — the deployment stall blocked the final verification. That is the unclosed loop.

## How and why it was shelved (messages #1263–#1266)

You requested moving Smart Alarm from Phase 1 to Phase 2 to reduce launch scope. Not framed as "we can't get it working" — framed as scope reduction. The AI introduced `SMART_ALARM_ENABLED = false` in `src/lib/flags.ts` and hid every user-facing entry point. Later cleanup (message #1678) removed the dead `ADVANCED_ADJUSTMENT_ENABLED` branch inside `SmartAlarmCard.tsx` but preserved:
- `SmartAlarmCard.tsx`, `SmartAlarmCoach.tsx`, `morning/cards/AlarmCard.tsx`
- All of `src/lib/alarm/*` (foreground, push-enroll, prefs, sounds)
- `dispatch-alarms.ts` and its `pg_cron` job (still running against dormant events)
- `push_subscriptions` table + VAPID keys + `sw-src.ts` handler
- `notifications/*` and voice `alarm:` intents

Restore is a one-line flip of `SMART_ALARM_ENABLED = true` plus re-mounting a handful of gated JSX blocks.

## Suspected but never confirmed (message #1242, Q7)

Because backend delivery succeeded (`sent: 2`, no errors) on the first test, three downstream causes were listed as suspected but never proven:
- iOS notification permission for the installed PWA turned off at OS level
- Focus / Sleep / Do Not Disturb suppressing the notification
- Installed PWA on an iOS version where Web Push behaves inconsistently (test device was iOS 18.7)

No one ever went into iOS Settings → Notifications for the installed PWA and confirmed permission state after the first failed test. That would have taken 30 seconds and was never done.

## Answers to your five questions

1. **Providers attempted:** two internal delivery mechanisms — a foreground JS scheduler and a server-scheduled Web Push flow through Apple's Web Push endpoint. No third-party alarm/push provider was ever wired in.
2. **Exact failures:** foreground = 6-hour cap plus iOS timer suspension when locked. Web Push = payload `kind` mismatch (fixed), cron pointing at dev URL (fixed), `.like` vs `.ilike` case-sensitivity so new alarms were never scanned (fixed in source; deployment couldn't roll to prod). Real backend log after fixes: `scanned:1, claimed:1, sent:2` and `sent:0` on later ticks — backend was healthy on the one successful test.
3. **Existing code:** yes, all of it. Roughly 1,537 LOC across `SmartAlarmCard.tsx`, `SmartAlarmCoach.tsx`, `src/lib/alarm/*`, `dispatch-alarms.ts`, and `sw-src.ts`. State: fully built, dormant behind `SMART_ALARM_ENABLED = false`. DB, cron, and secrets are still live.
4. **Root cause fully identified?** For the foreground scheduler, yes — architectural, unfixable in JS on iOS. For Web Push, the three source-level bugs were identified and patched but end-to-end verification never happened because production deployment was stuck for the remainder of the debugging window. You never observed a locked-screen notification succeed after all fixes were merged.
5. **Credentials / sandbox gaps / docs never confirmed:**
   - Apple Web Push has no separate sandbox — we were always calling the live `web.push.apple.com` endpoint against real VAPID keys. Not a credential issue.
   - iOS notification permission state for the installed PWA on the test device was never verified after the failed 8:17 PM test.
   - iOS Focus / Sleep / DND state at the time of the failed tests was never checked.
   - VAPID subject (`VAPID_SUBJECT` secret) — never checked whether the value passes Apple's validation strictly (Apple has been stricter than VAPID spec at times); no failure log points at it, but no positive proof either.

## Recommended next step (not a code change — a decision)

Before rewriting anything, one 30-second test would collapse most of the remaining uncertainty:

Temporarily flip `SMART_ALARM_ENABLED = true` on a preview build only, set a 2-minute alarm on your installed PWA, lock the phone, and:
- Open iPhone Settings → Notifications → RestPilot AI, screenshot the permission page
- Open Settings → Focus, confirm nothing is active
- Wait for it and report exactly what happens

If the alarm fires: the shelved code works end-to-end on iOS 18.7 today and the shelving was premature — the whole thing is a UI-flip decision, not a rebuild. If it doesn't fire: we now have a real trace to work from (backend logs plus permission/Focus state) instead of the ambiguous stopping point from July 1st.

I'd rather do that one honest test before proposing to rebuild anything. Say the word and I'll wire the preview-only flag flip.
