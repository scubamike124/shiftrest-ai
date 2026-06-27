## Ticket: Dashboard mobile horizontal overflow

Separate from Trust Layer QA. Goal: zero horizontal scroll on `/dashboard` at iPhone widths (390×844 and smaller), desktop layout unchanged, typecheck clean. Trust Layer visual QA reruns once this lands and we have a signed-in sandbox session.

---

### Root cause (verified)

The app shell in `src/routes/__root.tsx` wraps every signed-in route in a flex row:

```tsx
<div className="flex min-h-screen w-full">
  <AppSidebar />
  <div className="flex min-h-screen flex-1 flex-col pb-24 lg:pb-0">
    <Outlet />
  </div>
</div>
```

The inner `flex-1` column has no `min-w-0`. In a flex row, a flex item defaults to `min-width: auto`, which equals the intrinsic minimum content width. Any descendant that can't shrink (large headings, `whitespace-nowrap` chips, fixed-track grids, the LongClock SVG) inflates that column past the viewport. Measured overflow at 390px: 146px, traced to `main.max-w-6xl`, the header grid, and the hero `<section>` — all direct children of that inflating column.

Fixing the column lets `max-w-6xl` and inner `min-w-0` containers behave as designed. The audit below catches any remaining offenders that have their own intrinsic-width issue.

### Fix plan

1. **Shell column min-width (the root fix)** — `src/routes/__root.tsx`
   - Add `min-w-0` and `overflow-x-clip` to the `flex-1` column:
     `flex min-h-screen min-w-0 flex-1 flex-col overflow-x-clip pb-24 lg:pb-0`.
   - Also add `overflow-x-clip` to the outer shell wrapper as a belt-and-braces guard against any future leak (does not affect sticky/positioned children the way `overflow-x-hidden` does).

2. **Dashboard root container** — `src/routes/dashboard.tsx`
   - `<main className="mx-auto flex w-full max-w-6xl flex-col px-5 pt-8 pb-12 lg:px-10 lg:pt-12">` → add `min-w-0`.
   - Add `min-w-0` to every direct child wrapper that hosts a grid or flex row with text + widget.

3. **Header / hero audit** — `src/routes/dashboard.tsx`
   - The arrival header grid (`grid-cols-[minmax(0,1fr)_auto]`) is already correct in shape; verify the inner `<div className="min-w-0">` truncates `h1.text-[34px]` properly. Drop the H1 to `text-[28px] sm:text-[34px] lg:text-[52px]` so a long greeting can't force overflow before `truncate` kicks in.
   - Hero `<section>` — add `min-w-0` and confirm any inner `grid`/`flex` row with chips uses `flex-wrap` (no `whitespace-nowrap` rows).

4. **Wide children audit** — sweep these for fixed/intrinsic widths and apply the same minmax/min-w-0 pattern where needed:
   - `RightNowCard`, `TomorrowPreviewCard`, `DailyReviewCard`, `SmartAlarmCard`
   - `LongClock` (SVG must be `w-full h-auto` inside a `min-w-0` parent; no fixed `width` attr leaking past viewport)
   - `MultiDayPlan`, `LastNightStrip`, `PatternAlerts`, `AIBriefCard`, `CompanionWhisper`, `ArrivalHero`
   - Replace any `flex` row containing text + widget that lacks `min-w-0` on the text side and `shrink-0` on the widget per the responsive-layout rules.

5. **Safe-area padding** — confirm `px-5` honors notch/curved-edge devices. Add `pl-[max(1.25rem,env(safe-area-inset-left))] pr-[max(1.25rem,env(safe-area-inset-right))]` on the dashboard `<main>` (kept behind the existing `px-5` baseline; `lg:px-10` unchanged).

6. **Sheet width sanity** — Trust Layer `RecommendationDetailSheet` already uses `sm:max-w-lg sm:mx-auto`. No changes; verify post-fix it never exceeds 100vw on 320px devices.

### Verification

- Playwright at 390×844, 375×667, and 320×568:
  - Assert `document.documentElement.scrollWidth === clientWidth` on `/dashboard` (signed in).
  - Screenshot dashboard + open `WhyButton` sheet on each width.
  - Enumerate any element with `getBoundingClientRect().right > clientWidth`; expect empty.
- Desktop regression: screenshot at 1440×900 to confirm layout unchanged.
- `bunx tsgo --noEmit` clean.

### Out of scope

- Any Trust Layer code change (this ticket is layout-only).
- Sidebar/BottomNav redesign.

### Follow-up (after merge)

Rerun Trust Layer visual QA while signed in: capture `WhyButton` on RightNow / Tomorrow / DailyReview / SmartAlarm, open the sheet on each, confirm `ConfidenceBadge`, `WhatChanged`, sources, reason, and expected outcome render with real data and no truncation.
