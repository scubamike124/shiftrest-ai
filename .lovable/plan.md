# Investigation Report — Smart Alarm

No code changes yet. Below is what I found and what I'd change next, pending your approval.

---

## Issue 1 — Simplify Alarm Settings (structure proposal)

### What's on the screen today

`src/components/SmartAlarmCard.tsx` currently stacks, top to bottom:

1. Target wake input
2. Exact Time / Smart Adjustment toggle
3. Maximum-adjustment select (when Smart)
4. Explanation paragraph
5. Primary "Set alarm" button
6. Test (10s) + Stop row
7. `AlarmAudioSettings` block — Sound picker, Volume slider, Vibrate switch, an "Advanced" accordion (Fade-in, Snooze)
8. Last AI result panel
9. Existing alarms list

On a 375px viewport that's ~3 full scrolls. Items 1–5 are the only ones the user touches when actually setting an alarm; 7 is a once-a-month setting that's eating the most space.

### Recommended structure

Keep the **main card scannable in one viewport** by moving anything that isn't "set this alarm right now" behind a sheet:

```text
[ Smart alarm header ]
[ Target wake time ]
[ Exact / Smart toggle ]      ← if Smart, inline pill row (5/10/15/30/Full) instead of <select>
[ One-line explanation ]
[ Set alarm  (primary CTA) ]
[ Test 10s · Stop · ⚙ Settings ]   ← Settings opens the sheet
[ Last result panel ]
[ Upcoming alarms ]
```

`⚙ Alarm Settings` opens a **bottom sheet** (use the existing `@/components/ui/sheet` or `drawer` primitive — both are already in the project) containing:

- Sound (current grid)
- Volume slider + Preview button
- Vibrate toggle (gated on `vibrateSupported()`)
- Fade-in: 0 / 15 / 30 / 60 s
- Snooze: 5 / 9 / 10 / 15 min
- "Done" button (closes; prefs already persist on change via `saveAlarmPrefs`)

Why a sheet over a modal: bottom sheet is the iOS/Android-native pattern for settings drill-downs, keeps the alarm context visible behind a dim, and is reachable with the thumb on a 6.1" phone. The project already uses `vaul` (Drawer) and Radix Sheet, so no new dependency.

Also recommend converting the **Maximum adjustment `<select>`** to a 5-pill chip row (`±5 ±10 ±15 ±30 Full`). It removes one tap (no native picker spin) and visually signals it's a small choice, not a settings menu.

### Files this would touch (when you approve)

- `src/components/SmartAlarmCard.tsx` — remove `<AlarmAudioSettings />` from inline render, add a "Settings" button + Sheet trigger, swap the select for chips.
- New `src/components/alarm/AlarmSettingsSheet.tsx` — wraps the existing `AlarmAudioSettings` body inside `<Sheet>`.
- No changes to `src/lib/alarm/prefs.ts` or `foreground.ts`.

---

## Issue 2 — Smart Adjustment rang at exact time (root cause)

### Code path traced

`SmartAlarmCard.schedule()` (src/components/SmartAlarmCard.tsx:133–219):

1. Reads `adjustmentMode` and `maxAdjustmentMin` — **persisted correctly** to `localStorage` key `restpilot:smart-alarm:prefs` via the effect at line 71. Reload confirmed by the rehydrate effect at line 55.
2. If Smart: calls `aiSmartAlarm({ targetWakeIso, windowMin: 5 })`.
3. Caps the returned `wakeAt` to ±windowMin (line 168–179) — if AI returned out-of-window, it **reverts to the exact target** and rewrites `reason`. This is a real silent-fallback path.
4. `createEvent({ startsAt: wake.toISOString() })` then `addAlarm({ firesAt: new Date(saved.startsAt).getTime() })` — the actual `setTimeout` is keyed off `wake`, not the original target, so the scheduler itself is correct.
5. `syncAlarms` effect (line 104) later re-reads from `fetchEvents`, which returns the same persisted `startsAt`, so no drift there either.

### Where the bug actually is

`src/routes/api/ai.ts:513–541` is the "safety net" that's supposed to fire when the model returns the target unchanged. It builds candidate offsets of **±22.5 min and ±45 min** and clamps them into ±windowMin:

```ts
const candidates = [
  targetMs - cycleMs * 0.25,   // -22.5 min
  targetMs + cycleMs * 0.25,
  targetMs - cycleMs * 0.5,
  targetMs + cycleMs * 0.5,
];
const clamped = candidates
  .map(c => Math.max(targetMs - windowMs, Math.min(targetMs + windowMs, c)))
  .filter(c => c !== targetMs);
```

With `windowMin = 5`, every candidate clamps to `target ± 5min`, which is fine. **But** the trigger condition on line 522 is:

```ts
if (!Number.isFinite(wakeMs) || Math.abs(wakeMs - targetMs) > windowMs || wakeMs === targetMs)
```

The fallback fires only when the model returns the **exact** target or an out-of-window time. If the model returns a time within the window but trivially close — e.g. `target + 30 seconds`, or `target + 1 minute` — the snap does **not** fire, no further nudging happens, and the client-side cap at line 171 happily accepts it. The alarm rings at "essentially the requested time" and the user perceives Smart Adjustment as a no-op.

There are also two model paths in this codebase (`gemini-3-flash` for JSON intents). Despite the prompt's "you MUST move it by ≥1 minute" instruction, models routinely echo the target back when they have no wearable signal — which is the production state for most users today.

### Most likely cause of what you observed

The model returned a wakeAt within ±5 of target but **very close** to it (likely the exact target or off by seconds). One of two things happened:

- **(A)** AI returned exactly `targetMs` → snap fired, picked `target − 5min`, alarm should have rung 5 min early. If your observation is "rang at the requested HH:MM," verify the actual fire time vs the requested HH:MM in the result panel ("AI chose"). If the panel says `target` (no delta shown), the snap **didn't fire** → cause (B).
- **(B)** AI returned `target ± < 1 min` → snap skipped, no meaningful adjustment, alarm rings effectively at the original time.

### Secondary finding — QA self-test does NOT exercise this

`src/routes/qa.smart-alarm.tsx:147` calls `addAlarm({ firesAt: Date.now() + 60_000 })` directly. **It never calls `aiSmartAlarm`.** So the +60s self-test can only validate delivery latency and audio, not whether Smart Adjustment actually moves the alarm. The checklist rows labelled "Smart Adjustment ±5/±10/±15" are manual hints, not automated.

### Answers to your specific questions

1. **Saved correctly?** Yes — see lines 71–76 of `SmartAlarmCard.tsx`.
2. **AI calculating an adjusted time?** Inconsistently. The model often returns the target unchanged. The server-side snap only catches the *exact-equal* case, not the *near-equal* case.
3. **Scheduler ignoring the adjusted time?** No. `addAlarm` and `syncAlarms` both use the persisted `startsAt` from the event, which is the adjusted value.
4. **Adjusted time only displayed, not scheduled?** No — verified the same value flows into `setTimeout`.
5. **Exact vs Smart use different paths?** They share the same scheduler. The divergence is only that Smart calls `aiSmartAlarm` and Exact constructs the response locally with `wakeAt = target`. Both end in the same `createEvent` + `addAlarm` flow.

### Affected files

- `src/routes/api/ai.ts` (lines 517–541) — snap trigger too narrow.
- `src/components/SmartAlarmCard.tsx` (lines 133–219) — no client bug, but the result panel doesn't make a 0-minute delta obvious, so users can't tell whether AI moved anything.
- `src/routes/qa.smart-alarm.tsx` — self-test doesn't cover Smart Adjustment; misleading row labels.

### Fix I'd propose (on approval)

1. **Server snap — broaden the trigger** in `api/ai.ts`: fire whenever `|wakeMs − targetMs| < 60_000` (less than 1 minute), not only when equal. Cap candidates at `min(windowMs, cycleMs * 0.25)` so ±5 still picks ±5, but ±30 picks ±22.5 instead of always saturating to the edge.
2. **Client result panel** — when `deltaMin === 0` and `adjusted === true`, show an explicit "AI kept your time (no better moment in ±N min)" so the behavior isn't invisible.
3. **QA harness** — add an actual `aiSmartAlarm` call path so the ±5/±10/±15 rows verify the returned delta is non-zero and within the window before passing.

Want me to implement (1)–(3) and the sheet refactor from Issue 1 in one change, or split them?
