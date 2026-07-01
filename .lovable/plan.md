
# Smart Alarm — Root Cause Investigation (No Code Changes)

## End-to-end flow (as it exists today)

```text
User picks time  ─▶  SmartAlarmCard.schedule()
                        │
                        ├─▶ aiSmartAlarm()   (server /api/ai — snap + sign logic)
                        │       returns wakeAt (final displayed time)
                        │
                        ├─▶ createEvent(...)  (Supabase user_events row)
                        │
                        └─▶ addAlarm({firesAt})  ──▶ foreground.ts armEntry()
                                                       │
                                                       └─▶ setTimeout in THIS TAB
                                                            │
                                                            └─▶ fireAlarm()
                                                                   ├─ new AudioContext() + startChime()
                                                                   ├─ navigator.vibrate()
                                                                   └─ speakQueued("Alarm.")
Stop  ─▶ stopRinging()   Snooze ─▶ (no dedicated path — user re-sets)
```

## Reproduction

- Set alarm for T+2 min, keep tab **foreground and unlocked** → rings.
- Set alarm for T+2 min, **lock the iPhone** (or background the PWA) → does **not** ring at T. On unlock after T, either silent, or a late/immediate chirp only if the AudioContext survives.
- Set alarm for T+8 hours overnight → almost never fires on iOS PWA.

## Root cause

**The delivery layer is a single foreground `setTimeout` in `src/lib/alarm/foreground.ts`.**
There is **no OS-level scheduled notification** and **no server-triggered push** at the alarm's fire time.

Two hard constraints break it on iOS PWA (the target device):

1. **iOS Safari / standalone PWA suspends JS timers** when the tab is backgrounded or the screen is locked. `setTimeout` does not fire at wall-clock time; it fires (late, coalesced, or not at all) only when the tab is next foregrounded. The 6-hour "hop / re-arm" chain in `foreground.ts` cannot survive a lock — every hop lives in the same suspended event loop.
2. **WebAudio + speech require a fresh user gesture** after long suspension. Even in the lucky case the timer does fire on resume, `new AudioContext()` / `speakQueued()` typically produce no audible sound because the gesture-unlock has expired.

Snooze/Stop:
- **Stop** works only while the audio is currently ringing in the same tab (calls `stopRinging()` — fine).
- **Snooze** is not wired at all in the UI — no snooze button in `SmartAlarmCard.tsx`, no snooze consumer in `foreground.ts`. `SnoozeMin` exists in prefs but is unused by the fire path. This is a second, independent gap.

## Why every previous fix missed

Prior fixes touched:
- Time **computation** — `api/ai.ts` snap-window, sign handling, `±5` → `5 min` labels.
- Time **displayed** — `SmartAlarmCard` labels, `SmartAlarmMock` on `/`.
- **Chunk cache** — `data-smart-alarm-card-version="v2"` marker.
- **Long-horizon math** — 6-hour hop chain in `foreground.ts`.

None of these changed **how the alarm is delivered**. The displayed time is correct; the alarm just isn't firing because the only mechanism that could fire it is a JS timer inside a suspended tab. That's why "publish succeeds, UI looks correct, still doesn't ring."

## Files responsible

| File | Role in bug |
| --- | --- |
| `src/lib/alarm/foreground.ts` | Sole delivery path — foreground `setTimeout` + WebAudio. Cannot fire when locked/backgrounded. |
| `src/components/SmartAlarmCard.tsx` | Only registers the foreground timer; no SW notification, no snooze UI, no permission prompt gate before scheduling. |
| `public/sw-src.ts` (service worker) | Does **not** register a `showTrigger` notification or listen for a push at fire time. |
| `src/routes/api/ai.ts` | Correct today for time math — **not** the cause of "doesn't ring." |

## Smallest possible fix (staged)

**Fix A — OS-level backstop (primary, unblocks the bug):**
At `schedule()` success, in addition to `addAlarm(...)`, register a **Web Push** wake via the existing server (pg_cron / edge function) that POSTs a push message at `wakeAt` targeting the user's subscription; the service worker's `push` handler calls `self.registration.showNotification(...)` with `requireInteraction: true` and a sound. This is the only path that survives iOS lock/background on an installed PWA.

Requirements already partially present: service worker exists, notification permission check exists in `SmartAlarmCard`. Missing pieces:
- Ensure a `push_subscriptions` row is created on alarm scheduling if not present (prompt for permission first).
- One-shot scheduled push job at `wakeAt` (pg_cron minute-tick or `pg_net` + scheduled row).
- `push` + `notificationclick` handlers in `sw-src.ts` that focus the app and start the in-app chime (WebAudio then works because the notification interaction is a user gesture).

**Fix B — Snooze wiring (small, independent):**
Add a `Snooze` button next to `Stop` that calls `stopRinging()` then `addAlarm({ firesAt: Date.now() + snoozeMin*60_000 })`. Also expose the same action from the `notificationclick` handler once Fix A lands.

**Fix C — Keep foreground path as-is** (already works when tab is foreground). No change.

## What "done" looks like — the verification I will run after approval

Real-device (iPhone PWA) matrix, repeated 3×:

1. Alarm at T+2 min, screen unlocked, app foreground → rings at exact displayed time.
2. Alarm at T+2 min, screen **locked** → OS notification wakes device at exact time; tapping starts chime.
3. Alarm at T+8h overnight → fires at exact time with locked screen.
4. Stop button silences instantly.
5. Snooze button re-fires exactly `snoozeMin` later; loop works.
6. Displayed final time === actual fire wall-clock time (±2 s).

Only after all six pass 3× in a row will I report the bug fixed.

## Ask before implementing

You said "reproduce the exact issue yourself" — my sandbox can't drive an iPhone PWA. Before I implement Fix A, please confirm which failure you're seeing so I don't rebuild the wrong layer:

- **(a)** Doesn't ring when phone is **locked or app is backgrounded** (my primary hypothesis → Fix A).
- **(b)** Doesn't ring even with app **open and foreground** (different bug — AudioContext/permission race, not push).
- **(c)** Rings at the **wrong wall-clock time** vs. what the card displays (time-math bug — different file).

Reply with a/b/c (and whether Snooze is also required in this pass) and I'll implement the minimal fix and run the verification matrix.
