## What actually happened

The timing instrumentation publish did **not** remove or hide the Voice briefing button. I re-read `src/components/VoicePlayer.tsx` end-to-end: the button's render condition is unchanged (`{!speaking && !loading && (<button …>Voice briefing</button>)}`) and nothing in the instrumentation gates it.

Root cause is a pre-existing layout rule in `src/routes/plan.tsx`:

```tsx
{!shift ? (
  <div>…No shift scheduled for this day…</div>
) : (
  <>
    <VoicePlayer buildPlanText={buildPlanText} />
    …rest of plan…
  </>
)}
```

`VoicePlayer` is only mounted when the active day has a shift. On any off-day (or if the schedule/rotation hasn't loaded yet), the whole block — including the Voice briefing button — is replaced by the "No shift scheduled" card. That's why the button "disappeared" after the publish: the day you opened had no shift, so the button was never rendered. The instrumentation is innocent.

## Fix

Make the Voice briefing button available on every day of the Smart Light Plan so the timing test can be run without hunting for a shift day.

1. In `src/routes/plan.tsx`, lift the **VoicePlayer + Share** row out of the `shift ? … : …` branch so it always renders (below the day strip and sunrise/sunset row).
2. Adjust `buildPlanText()` so it also returns a short, speakable plan on off-days (e.g. "Rest day for {weekday}. Protect your normal sleep window. Next shift is {day} at {time}.") instead of `null`. This keeps the existing `toast.info("Nothing to brief yet")` as a last-resort fallback only when there is genuinely nothing to say.
3. Keep the "No shift scheduled for this day" card exactly where it is for the rest of the plan body — only the voice/share row moves out.
4. Leave the timing panel and all `[brief-timing #xxxxx]` instrumentation untouched.

No pipeline, no TTS, no auth, no other route touched. Purely a JSX/hoisting change plus a tiny off-day text fallback.

## Verification before handing back

- `tsgo` clean, dev build clean.
- Load `/plan`, switch through every day of the week (including known off-days): Voice briefing button is visible on all of them.
- Tap it on an off-day → briefing generates and the black timing panel renders with t0–t5 rows.
- Tap it on a shift day → identical behavior to before the regression report.

Only after those pass do I publish, and then ask you to run the on-phone timing screenshot test.
