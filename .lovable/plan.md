# RestPilot AI — Pre-Launch Upgrade Plan

Five upgrades, shipped one at a time. Each one is fully built, tested, and bug-free before the next begins. No launch prep until all five are done.

---

## Upgrade 1 — Advanced AI Planning Engine (START HERE)

Goal: turn the current 3-day fatigue model into a real circadian planning brain that personalizes itself to the user.

What we build:
1. **14-day fatigue + recovery forecast** (today + 13 days) replacing the current 3-day window. Same `FatiguePoint` shape, longer horizon, used by the dashboard ring, AI brief, and coach context.
2. **Smarter fatigue model** — add:
   - Sleep debt carry-over (rolling 7-day deficit vs `prefs.sleepHours`)
   - Recovery half-life between shifts (not just "short turnaround" flag)
   - Backward-rotation penalty curve (harshness scales with how many days in a row)
   - Wearable-grounded adjustment: actual sleep duration, efficiency, HRV trend pull the score up or down when data exists
3. **Personalized recommendations engine** — a new `recommendations.ts` that emits 3–5 ranked, time-stamped actions per day ("Anchor sleep 09:30–17:00", "Caffeine cutoff 13:00", "Bright light walk 16:30"), driven by rotation pattern + wearable signals + user prefs.
4. **Improved recovery score** — weighted blend of: circadian debt, fatigue, sleep debt, last-night efficiency, HRV trend (when available). Same 0–100 scale, new bands stay stable so the dashboard ring doesn't visually jump.
5. **Smarter sleep guidance** in `/plan` — anchor-sleep windows for rotating workers, split-sleep suggestion when a turnaround is <9h, pre-shift nap windows on heavy days.
6. **Richer coach context string** so the AI coach quotes specific numbers ("Your 7-day sleep debt is 4.2h, HRV trending −8% — here's how to bank recovery before Friday's night").

Verification before moving on:
- Unit-test the new fatigue/recovery math against fixtures (fixed nights, rotating, irregular, with + without wearable data).
- Live test against 3 schedule shapes (fixed nights / forward-rotating / chaotic) on desktop + mobile preview.
- Confirm dashboard, `/plan`, AI brief, and coach all consume the new horizon without layout regressions.

---

## Upgrade 2 — Advanced Scheduling ("Long Clock")

Goal: handle real shift-worker calendars, not just a 7-day repeating template.

What we build:
1. **Multi-week patterns** — extend the `shifts` table to support a rotation length (1, 2, 3, or 4 weeks) and a start anchor date. The current 7-day repeat stays the default.
2. **Specific-date overrides** — a user can mark "this Wed is OFF" or "extra shift Sat 19:00–07:00" without changing the base pattern. New `shift_overrides` table.
3. **Long Clock view** — a new horizontal scroll calendar (4 weeks visible) that shows base pattern + overrides + fatigue heatmap behind each day.
4. **Advanced shift editor** — per-shift break minutes, on-call vs scheduled, employer-aware quick templates, "duplicate to next week" action.
5. **Smarter calendar logic** — week-over-week comparison, automatic detection of stretches (>3 consecutive shifts, >2 nights in a row) surfaced as warnings in the editor.
6. **Plan + insights re-wired** to read from base pattern + overrides via a single `resolvedShifts(date)` helper, so every screen stays consistent.

Verification: migration runs cleanly, override CRUD round-trips, Long Clock matches dashboard fatigue exactly, and no regressions on existing 7-day-only users.

---

## Upgrade 3 — Notifications & Automation

Goal: notifications fire at the right time, even when the app is closed, and feel like a personal assistant.

What we build:
1. **Schedule-aware wind-down** — reminder fires `prefs.windDownMin` before the computed sleep window, recalculated nightly based on the next shift, not a fixed clock time.
2. **Smart wake notifications** — gentle pre-alarm 15 min before the planned wake, with the day's first action ("Bright light + 200mg caffeine").
3. **Anchor-sleep nudges** for rotating workers ("Protect this 4h anchor sleep — your Friday night is the heavy one").
4. **Pre-shift caffeine + meal reminders** at the computed times from Upgrade 1.
5. **Server-side scheduling** via `pg_cron` + a `/api/public/notifications/cron` route + Web Push (VAPID) for users who granted permission, so notifications fire when the tab is closed. Browser-only fallback stays for users who skip push.
6. **Quiet hours + snooze** controls in Profile.
7. **Automation rules** — auto-create the next week's plan when Sunday rolls over; auto-mark a played voice brief as "heard"; auto-clear the AI brief card after the shift starts.

Verification: end-to-end push delivery test on iOS Safari + Chrome desktop; quiet-hours respected; no duplicate notifications when the tab is open.

---

## Upgrade 4 — Wearable Integration (Finish)

Status: Fitbit + Oura code shipped (provider clients, OAuth callbacks, sync engine, dashboard `LastNightStrip`, Profile `WearableCard`). Production secrets pending.

What we finish:
1. **Apple Health** — read-only via a lightweight web bridge (user exports → drag-drop XML import) until the native wrapper exists; surfaces sleep, HRV, RHR through the same `wearable_readings` table.
2. **Google Fit** — OAuth + Fitness REST API integration, same shape as Fitbit/Oura.
3. **Nightly cron** wired to `pg_cron` calling `/api/public/wearables/cron` for all four providers.
4. **Wearable-grounded coach + insights** — already partially wired in Upgrade 1; verify end-to-end with seeded fake readings.
5. **Sync history + "compare to plan"** card showing planned vs actual sleep for the last 7 nights.
6. **Placeholder-safe development** — every provider's client reads its env vars lazily and shows a clean "Add credentials in Settings" UI instead of crashing when keys are missing.

Verification: each provider connects, disconnects, syncs, and refreshes tokens; missing keys never break the build or dashboard.

---

## Upgrade 5 — UX Polish

Goal: every screen feels like a flagship app.

What we build:
1. **Animation pass** — staggered card mounts on dashboard, spring transitions on tab switches, smooth ring fill on recovery score, subtle parallax on the hero gradient. Framer Motion already available.
2. **Responsiveness** — audit at 320, 375, 414, 768, 1024, 1440. Fix every overflow, tap-target, and safe-area issue. iOS notch + dynamic island.
3. **Layout refinement** — consistent 16/24px rhythm, unified card radii, typographic scale audit (Instrument Serif vs body sans).
4. **Per-screen polish**: dashboard bento alignment, `/plan` timeline visuals, `/coach` message bubbles + streaming indicator, `/swap` analysis card, `/playbooks` card stack, Profile section dividers, paywall hierarchy.
5. **Empty + loading states** — every async surface gets a skeleton; every empty state gets a one-line CTA.
6. **Accessibility pass** — focus rings, ARIA labels on icon-only buttons, color-contrast audit, reduced-motion respect.
7. **Final QA sweep** — Playwright run across every route on mobile + desktop viewports, zero console errors, zero hydration warnings.

Verification: side-by-side before/after screenshots per screen, Lighthouse ≥90 mobile, no runtime errors.

---

## Technical Notes (for the engineer, not the user)

- Upgrade 1 lives mostly in `src/lib/insights.ts`, a new `src/lib/recommendations.ts`, and the `computeInsights` consumers (`/`, `/coach`, `/plan`, `AIBriefCard`). Type changes to `Insights` are additive — keep `fatigueForecast[0..2]` backward-compatible by aliasing into the new 14-day array.
- Upgrade 2 needs two migrations: `shifts.rotation_weeks`, `shifts.anchor_date`, and a new `shift_overrides` table with full GRANTs + RLS.
- Upgrade 3 needs a `push_subscriptions` table, VAPID keys via `add_secret`, and a `pg_cron` job hitting the new public route with the anon `apikey` header.
- Upgrade 4 keeps the lazy-config pattern already in `fitbit.server.ts` / `oura.server.ts` — `getXConfig()` throws with a friendly message; UI shows a "needs setup" state instead of crashing.
- Upgrade 5 is pure frontend; no schema or server changes.

---

## Rules of engagement

- One upgrade at a time. No parallel feature branches.
- Each upgrade ends with: green typecheck, green Playwright smoke, manual verification on mobile + desktop preview, and a published build that the user signs off on.
- Bug found mid-upgrade → fix before continuing.
- Launch prep (App Store assets, marketing site, onboarding video, etc.) does NOT start until Upgrade 5 is signed off.

Approve to begin **Upgrade 1 — Advanced AI Planning Engine**.
