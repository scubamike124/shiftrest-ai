# Smart Alarm — Investigation Report

## Root Cause

The foreground alarm scheduler in `src/lib/alarm/foreground.ts` enforces a **hard 6-hour cap** (`MAX_DELAY_MS = 6 * 60 * 60 * 1000`). Any alarm whose fire time is more than 6 hours away is **silently skipped**:

```ts
const MAX_DELAY_MS = 6 * 60 * 60 * 1000; // 6h
...
if (delay > MAX_DELAY_MS) {
  if (existing) { clearTimeout(existing); timers.delete(a.id); }
  continue;   // ← no timer scheduled, no log, no fallback
}
```

The default wake time picker (`defaultTomorrowWake()` in `SmartAlarmCard.tsx`) pre-fills **tomorrow at 07:00**. When a user schedules in the evening (say 10–11 pm), the alarm is 8–10 hours out, so:

1. `addAlarm()` runs → delay > 6h → **timer is dropped**.
2. `syncAlarms()` re-runs after the events query refetches → same delay > 6h → **still dropped**.
3. No console output, no toast, no fallback path that the user can see.

**Smart Adjustment is a red herring.** Whether the AI nudges +5 or not, the resulting fire time is still >6h away, so it never schedules. The behavior is identical for Exact Time set far in the future — but users notice it on Smart because they explicitly look for the adjusted ring.

The only out-of-tab fallback is the server-side cron in `src/lib/notifications/run.server.ts` + web-push, which requires:
- PWA installed,
- Push permission granted,
- A valid push subscription stored.

In the **Preview environment** (`id-preview--...lovable.app`) this is essentially never satisfied — the URL changes per build, service-worker scope and push subscriptions don't carry over, so the only real path is the foreground timer that just got dropped.

### Why Test 10s and the +60s QA self-test PASS

Both use delays well under 6h, so they fall through the cap and ring normally. They exercise the same `setTimeout`/`fireAlarm` code, but never hit the silent-drop branch.

## Verified Flow

1. `schedule()` (SmartAlarmCard.tsx:134) calls `aiSmartAlarm(...)`, awaits the AI, then uses the **AI-adjusted** `wake` time when building the event and calling `addAlarm({firesAt: new Date(saved.startsAt).getTime(), ...})`. ✔ scheduling happens **after** the AI computes the final time.
2. `addAlarm` clears any existing timer for the same id, then sets a new one — but only if `delay <= MAX_DELAY_MS`. ✘ silent skip above 6h.
3. `syncAlarms` runs again from the `useEffect` on `alarms` after the query invalidates; same 6h gate, same silent skip.
4. Test 10s and real alarms share `fireAlarm()` — identical pipeline, only the scheduling gate differs by delay.

## Files Involved

- `src/lib/alarm/foreground.ts` — the 6h cap, no logging, no long-delay strategy.
- `src/components/SmartAlarmCard.tsx` — default wake is tomorrow 07:00, no surfaced warning when the foreground path won't cover the gap.
- `src/lib/notifications/run.server.ts` + `src/lib/push/web-push.server.ts` — the only out-of-tab path, requires push subscription that Preview rarely has.

## Proposed Fix (for approval)

1. **Re-arm strategy in `foreground.ts`**: replace the silent drop with a chained `setTimeout`. When `delay > MAX_DELAY_MS`, schedule an intermediate wake (`MAX_DELAY_MS - 60s`) that re-calls the same scheduler; repeat until within the safe window, then arm the real fire. Keeps the per-timer limit safe while still firing for tomorrow-morning alarms when the tab survives.
2. **Instrumentation** in `foreground.ts` (gated by a `restpilot:debug-alarm` localStorage flag to stay quiet in prod):
   - `scheduled` log: id, requestedAtIso, fireAtIso, delayMs, mode (`direct` | `re-arm`).
   - `re-armed` log on each intermediate hop.
   - `fired` log already exists via `alarm:fired` CustomEvent — extend the detail with `scheduledAtMs` so QA HUD can show drift.
   - `skipped` log with reason (`past`, `cancelled`, `replaced`) — never silent.
3. **Surface the truth in the UI** when the alarm exceeds the foreground window AND no valid push subscription is present:
   - Inline note on `SmartAlarmCard`: "This alarm is X hours away. Keep the app open, or enable notifications so we can ring it in the background." Link to enable notifications.
   - Same banner on the `/qa/smart-alarm` self-test row when the test target exceeds 6h.
4. **QA self-test additions** in `src/routes/qa.smart-alarm.tsx`:
   - New row: "Long-horizon alarm (+7h)" that schedules a real alarm 7h out and asserts the intermediate re-arm timer landed within ±10s.
   - Display the same `requested / scheduled / fired / drift` table you already use, plus the new `re-arms` count.
5. **No behavior change to AI logic** — the existing snap in `routes/api/ai.ts` is correct and Smart Adjustment is producing the right wake time. Don't touch it.

## Out of Scope

- Replacing the foreground fallback with a fully native scheduler (would require Capacitor / native wrappers).
- Push-subscription reliability fixes for Preview URLs (separate issue; we can document it).

Awaiting approval before implementing.
