## What I found

I fetched the currently-live bundle from `https://restpilotai.com/plan` (`assets/plan-Zp6eEaf-.js`) and grepped it:

- ✅ contains `"Voice briefing"` and `"No shift scheduled"`
- ❌ does **not** contain `"Rest day for"` — the exact string from the off-day fallback I added to `buildPlanText()` last turn

That string is in the source (`src/routes/plan.tsx`, `buildPlanText()` off-day branch). So **the last "Published" click did not actually deploy the fix** — the live bundle still has the old JSX where `<VoicePlayer>` sits *inside* the `shift ? … : …` branch. This is the same publish/cache gap you flagged.

Consequence: on any day the app decides "no shift", the whole VoicePlayer + Share row disappears — exactly what you're seeing. And "no shift" is decided by:

```ts
const shift =
  shiftsForDate(safeShifts, activeDate, prefs.cycleAnchor, prefs.cycleWeeks)[0]
  ?? safeShifts.find(s => s.day === activeDay && (s.weekIndex ?? 0) === 0);
```

So there **is** a second failure mode beyond "off-day": if your shifts were saved with a `weekIndex` that doesn't match today's rotation slot (e.g. multi-week rotation, or `cycleAnchor` unset), `shiftsForDate` returns `[]`, the `weekIndex === 0` fallback also misses, and the page renders "No shift scheduled" **even on a day you clearly scheduled a shift** — hiding the button in the current live bundle.

## Fix (small, UI-only, matches the previously-approved intent)

1. **Republish** the current source. The already-merged edit that hoists `<VoicePlayer>` + Share out of the `shift ? … : …` branch and adds the rest-day script is already in `src/routes/plan.tsx` — it just needs to actually reach production this time.

2. **Belt-and-suspenders in `src/routes/plan.tsx`**: broaden the shift-day fallback so a mis-tagged `weekIndex` can't make a real shift invisible:
   ```ts
   const shift =
     shiftsForDate(safeShifts, activeDate, prefs.cycleAnchor, prefs.cycleWeeks)[0]
     ?? safeShifts.find(s => s.day === activeDay && (s.weekIndex ?? 0) === 0)
     ?? safeShifts.find(s => s.day === activeDay); // any weekIndex
   ```
   This only affects which day is treated as a "shift day" for the plan body; it doesn't touch scheduling storage, cycle math elsewhere, or the VoicePlayer render path (which is already unconditional after step 1).

3. **No other files touched.** No pipeline, TTS, auth, service-worker, or routing changes. The timing panel and `[brief-timing #xxxxx]` instrumentation stay exactly as they are.

## Verification I will do before saying it's fixed

- `tsgo` clean.
- `curl https://restpilotai.com/assets/plan-*.js | grep 'Rest day for'` returns a match (proves the new bundle actually shipped, not just built).
- Drive the published `/plan` with Playwright signed in as a test session, switch across weekdays, and confirm the **Voice briefing** button is in the DOM on every day — screenshot both a shift day and an off-day.

Only after those three pass do I hand it back to you for the on-phone timing screenshot.
