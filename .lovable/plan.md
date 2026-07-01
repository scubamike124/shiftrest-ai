
# Smart Alarm V1 — Simplify to Exact Time Only

## Product decision & impact

Ship an alarm that always rings at exactly the time the user picks. AI wake-time shifting is removed from the UI for V1 but kept in the codebase behind an off-by-default flag so it can be reintroduced later as an "Advanced" option.

**Risk / reliability impact — net positive:**
- Removes an entire class of "why did it fire at 6:52 instead of 7:00?" support issues.
- Removes the AI call from the critical scheduling path — one fewer network dependency between "tap Set" and "row in `user_events`".
- Fewer UI states to QA (one mode instead of two × 6 window sizes).
- No effect on the reliability work we just completed: `dispatched_at` claim, `pg_cron` minute tick, push enrollment, snooze/stop, foreground re-arm — all continue to operate on the exact `starts_at` the user picked.
- AI bedtime/wind-down/sleep advice is unaffected (separate surfaces: coach, brief, companion).

## Files involved

1. **`src/components/SmartAlarmCard.tsx`** — primary UI change.
   - Delete the Exact/Smart segmented control, adjustment chip row, `SmartAlarmCoach` result panel (or hide when not applicable), and the `aiSmartAlarm` call in the mutation.
   - Keep: time picker, Set button, list of scheduled alarms, snooze/stop, sound/volume/fade/vibrate Sheet, push enrollment call, foreground `addAlarm`.
   - Keep `adjustmentMode`/`maxAdjustmentMin` state + `PREFS_KEY` behind an internal `ADVANCED_ADJUSTMENT_ENABLED = false` constant so re-enabling later is a one-line flip.

2. **`src/routes/index.tsx`** — `SmartAlarmMock` on the marketing/home card.
   - Remove the "Smart adjustment" chip row from the mock to match shipped UI. No logic.

3. **`src/routes/qa.smart-alarm.tsx`** — QA harness.
   - Hide/remove the `SmartAdjustmentTester` section (or gate it on the same flag). Keep the +60s self-test, long-horizon +7h tester, and manual checklist — those validate the reliability path we're keeping.

4. **`src/lib/ai-client.ts`** — leave `aiSmartAlarm` export in place (unused by UI, still used by QA if we keep it flagged). Zero change required.

5. **`src/routes/api/ai.ts`** — leave the smart-alarm handler in place. Dead code from V1 UI's perspective, live for future flag flip and for the QA harness. Zero change required.

6. **`SmartAlarmCoach.tsx`, `ai/trust/*`** — no change; simply not rendered when adjustment is off.

**Not touched (reliability layer stays intact):**
- `src/lib/alarm/foreground.ts`
- `src/lib/alarm/push-enroll.ts`
- `src/routes/api/public/hooks/dispatch-alarms.ts`
- `public/sw-src.ts` (snooze/stop actions)
- `user_events` schema, `dispatched_at`, cron job

## Smallest safe implementation plan (one PR)

1. Add `const ADVANCED_ADJUSTMENT_ENABLED = false;` at the top of `SmartAlarmCard.tsx`.
2. In `onSubmit`, when the flag is false: skip `aiSmartAlarm`, compute `wakeAt = targetLocal` directly, `createEvent` with the exact target ISO, then `addAlarm` + `ensureAlarmPushEnrollment` as today.
3. Conditionally render the mode toggle, chip row, and Coach result on `ADVANCED_ADJUSTMENT_ENABLED`. Button label becomes just "Set alarm".
4. Update the marketing mock in `src/routes/index.tsx` to drop the adjustment chips.
5. Gate `SmartAdjustmentTester` in `qa.smart-alarm.tsx` on the same flag (import the constant or duplicate as `false`).
6. Typecheck. No migration, no cron change, no publish gating needed beyond a standard Publish → Update.

## Re-introduction path (future)

Flip `ADVANCED_ADJUSTMENT_ENABLED` to `true` (or promote it to a per-user preference / entitlement check for a paid tier). All existing code — the mode toggle, chip row, `aiSmartAlarm` call, Coach panel, QA tester, and server route — comes back with no re-authoring. Recommended future gate: `useSubscription().tier === 'elite'` or a Settings toggle stored in `prefs`.

## Verification after implementation

- Typecheck green.
- Manual: pick 7:00, tap Set → row in `user_events` has `starts_at` exactly 7:00, `title` starts with `alarm:`, no AI network call in devtools.
- QA harness +60s test still PASS.
- Locked-screen push still delivers via the cron path (unchanged).

Awaiting approval before coding.
