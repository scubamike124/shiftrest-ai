## Upgrade 2 — Advanced Scheduling / Long Clock

Goal: support flexible rotating schedules (4-on/4-off, 2-week panama, etc.), produce a real multi-day plan with absolute timestamps, and feed both into the existing 14-day fatigue horizon + ranked recommendations — without breaking the current weekly-shift flow.

### 1. Database (one migration)

- `shifts.week_index` — `smallint NOT NULL DEFAULT 0`. Position inside the rotation cycle (0 = week A, 1 = week B…). Existing rows = 0 → behaves exactly like today.
- `user_prefs.cycle_weeks` — `smallint NOT NULL DEFAULT 1`. 1 = current weekly behavior. 2–6 = multi-week rotation.
- `user_prefs.cycle_anchor` — `date NULL`. The Monday that "week 0" starts on. NULL → derives from `created_at` Monday so legacy users keep working.

No new tables, no policy changes, existing GRANTs cover the new columns.

### 2. New module `src/lib/schedule.ts`

Pure helpers consumed by insights, recommendations, the dashboard, and `/plan`:

- `weekIndexFor(date, anchor, cycleWeeks)` → 0..cycleWeeks-1
- `shiftsForDate(shifts, date, anchor, cycleWeeks)` → `Shift[]` for that calendar date
- `buildMultiDayPlan(shifts, prefs, location, now, days = 7)` → array of `{ date, shifts, sleep, windDown, recovery, fatigueScore }` for the next N days
- `buildLongClock(shift, date, prefs, sun)` → timestamped events (`Date` objects) covering: pre-shift wake + bright light, pre-shift meal, caffeine-on, shift-start, optional pre-shift nap, caffeine-cutoff, shift-end + wind-down, blackout/sleep block, sunrise amber, post-sleep recovery window, anchor for tomorrow

### 3. Engine updates (backward compatible)

- `src/lib/shifts.ts`: add `weekIndex` to `Shift`, read/write `week_index`, default 0.
- `src/lib/prefs.ts`: add `cycleWeeks`, `cycleAnchor` (ISO date) to `Prefs`, persist on save.
- `src/lib/insights.ts`: `dayFatigue` swaps `shifts.find(s => s.day === idx)` for `shiftsForDate(...)` so the 14-day horizon respects rotation cycles. When `cycle_weeks = 1` results are identical to today.
- `src/lib/recommendations.ts`: feed today + tomorrow into the ranker so split-sleep, caffeine-cutoff, and nap recs work across the cycle boundary.

### 4. UI (mobile-first)

- `src/components/MultiDayPlan.tsx` — new horizontal-scroll card: 7-day strip with per-day fatigue chip, shift block, sleep window, caffeine window. Tap → opens that day's long-clock.
- `src/components/LongClockSheet.tsx` — bottom-sheet timeline rendering `buildLongClock` for the tapped day.
- `ShiftEditor` (in `src/routes/index.tsx`): when `cycle_weeks > 1`, render a `Week A / B / …` selector. Hidden when cycle = 1 → existing flow untouched.
- `src/routes/profile.tsx`: small "Rotation cycle" control (1–6 weeks + anchor date). Defaults preserved.
- `src/routes/plan.tsx`: add "Next 7 days" tab using the new multi-day plan; keep current single-day view as default.

### 5. Verification

- `tsgo --noEmit` clean.
- Signed-in Playwright run: create week-A shift, switch cycle to 2 weeks, create week-B shift, refresh, confirm both persist and the 7-day strip shows the alternating pattern.
- Confirm AI brief + ranked recs still render when `cycle_weeks = 1` (regression guard).

### Out of scope

Stripe, location, auth, profile billing UI — untouched.
