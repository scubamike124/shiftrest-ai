
## Investigation Results — Smart Alarm "+5 moved earlier" bug

### 1. What "±5" is intended to mean

The chip is already labeled **"±5"** in the code (`src/components/SmartAlarmCard.tsx` line 306: `` `±${opt.value}` ``) and the helper text says *"AI may move your alarm by up to 5 minutes earlier or later"* (line 318). So the intended product behavior is **B — earlier OR later, up to N minutes**.

The "+5" you saw on screen is likely a font-rendering / glyph issue where the `±` character rendered as `+` (or was cached from an older build). The current source is `±`. Fix: verify on the deployed build; if `±` still renders as `+` on iOS, switch the label to plain ASCII `"5 min"` with subtitle "earlier or later" so no glyph ambiguity remains.

### 2. Root cause of "6:00 PM → 5:55 PM" always going earlier

`src/routes/api/ai.ts` lines 517–547 contain the snap safety-net that fires when the model returns the exact target (or drifts <60s). The candidate offset list is:

```
const offsets = [-offsetCap, offsetCap, -offsetCap * 0.6, offsetCap * 0.6];
...
const pick = candidates[0] ?? ...   // always the first = -offsetCap (earlier)
```

**Every fallback picks `-offsetCap` first → the alarm is always snapped earlier** regardless of what the model said, what the user prefers, or what the sleep cycle actually looks like. With a ±5 window that hard-codes 5:55 PM.

There is no wearable-derived "cycle boundary" math — the code just picks the earliest candidate.

### 3. Why the card says "Ignored"

`src/components/ai/trust/RecommendationActions.tsx` renders **Accept / Snooze / Ignore** buttons under every alarm result (via `RecommendationActions` in `SmartAlarmCard.tsx` line 440). The label "Ignore" is a feedback action button, not a status of the alarm. It's next to the fresh "Moved 5 min earlier" line so it reads as a status — that's the confusion.

### 4. Files involved

- `src/components/SmartAlarmCard.tsx` — chip label (`±5`), result card copy ("Moved X min earlier/later"), renders `RecommendationActions`.
- `src/routes/api/ai.ts` (lines 517–548) — the snap fallback that always picks earlier.
- `src/components/ai/trust/RecommendationActions.tsx` — Accept / Snooze / **Ignore** buttons.

### 5. Proposed fix

**A. Snap logic — make direction meaningful, not "always earlier"**
- Bias direction using a real signal instead of `candidates[0]`:
  1. If model returned a wake time inside the window but too close to target, respect its sign (later vs earlier) and just push it out to ≥60s.
  2. Otherwise pick the direction that is closer to a 90-min cycle boundary from a plausible sleep-onset estimate (fallback: target − 7h30m). If no signal, alternate deterministically per day (hash of date) rather than always earlier.
- Never saturate to `-offsetCap` unconditionally.

**B. Label clarity in `SmartAlarmCard.tsx`**
- Keep behavior = "earlier or later", replace the glyph-prone `±N` with `"N min"` + a subtitle `"earlier or later"` on each chip so iOS Safari can never render it as `+N`.
- Chip group header: change "Maximum adjustment" → "Adjustment window (earlier or later)".

**C. Disambiguate "Ignore" placement**
- In `RecommendationActions`, group buttons under a small header `"Feedback"` and add `aria-label="Give feedback on this recommendation"` so it visibly isn't the alarm's status.
- Alternatively, hide `RecommendationActions` on the initial alarm-set card and only show it after the alarm rings (feedback belongs after the event, not before).

### 6. Awaiting approval

No code changes yet. Approve A + B + C (or any subset) and I'll implement.
