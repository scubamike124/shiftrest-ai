# Home Experience Redesign — AI Companion as Centerpiece

## Investigation Summary

Current state:
- `src/routes/dashboard.tsx` (987 lines) is the active home — uses `CompanionHero` plus a long stack of cards (`AIBriefCard`, `RightNowCard`, `SmartAlarmCard`, `LastNightStrip`, `MultiDayPlan`, `TomorrowPreviewCard`, `DailyReviewCard`, `PatternAlerts`, `DecisionCenterCard`, `AIActivityFeed`, etc.).
- `src/routes/index.tsx` is a separate marketing/landing surface.
- Existing avatar work: `src/components/companion/Avatar.tsx` (portrait-hybrid premium avatar), `src/components/CompanionAvatar.tsx` (small chip), `CompanionHero`, `PilotOrb`.
- Bottom navigation lives in `src/components/BottomNav.tsx`.
- All feature cards already exist — this is purely presentation/layout.

## Goals

1. AI Companion = visible centerpiece, persistent, one tap away.
2. Reorganize existing cards into a premium glass bento grid.
3. Zero feature removal — every current card keeps its data + behavior.

## Implementation Plan

### 1. Persistent Corner Avatar (new)
- New component `src/components/companion/CompanionDock.tsx`:
  - Small animated avatar (reuse `Avatar` at `sm` size) inside a glowing glass pill.
  - Fixed top-right, safe-area aware, z-50, always visible on authenticated routes.
  - Subtle pulse when Companion has a new brief or proactive whisper.
  - Tap → navigates to `/companion` (full premium avatar experience already shipped).
- Mount inside `src/routes/__root.tsx` (or an authenticated layout wrapper) so it persists across `/dashboard`, `/sleep`, `/plan`, `/health`, etc.
- Hide on `/companion`, `/auth`, `/onboarding`, marketing `index`, and legal routes via pathname check.

### 2. Dashboard Redesign (`src/routes/dashboard.tsx`)
Replace the current vertical scroll with a structured bento grid. Keep all data hooks and queries — only the JSX layout changes.

Section order (mobile-first, single column, expanding to 2-col at `sm:`):

```text
┌──────────────────────────────────────────┐
│ Greeting + date           [avatar chip]  │  ← Hero strip
├──────────────────────────────────────────┤
│  AI Morning/Evening Brief (full width)   │  ← AIBriefCard, hero treatment
├──────────────────┬───────────────────────┤
│ Sleep Score      │ Recovery / Readiness  │  ← LastNightStrip + WearableCard
├──────────────────┴───────────────────────┤
│ Right Now AI Coach (full width, accent)  │  ← RightNowCard
├──────────────────┬───────────────────────┤
│ Smart Alarm      │ Sleep Sounds          │  ← SmartAlarmCard + new SleepSoundsCard
├──────────────────┴───────────────────────┤
│ Daily Schedule (full width)              │  ← shift list + MultiDayPlan
├──────────────────┬───────────────────────┤
│ Weather          │ Traffic               │  ← weather/* + traffic/*
├──────────────────┼───────────────────────┤
│ Calendar         │ Hydration             │
├──────────────────┴───────────────────────┤
│ Sleep Streak (full width)                │
├──────────────────────────────────────────┤
│ Quick Actions (chip grid)                │  ← deep links to /sleep, /plan, /pilot…
└──────────────────────────────────────────┘
```

- Greeting strip replaces existing `CompanionHero` (move that experience into the new `/companion` flow only; greeting is text + time + tiny inline avatar — the persistent dock handles avatar access).
- Add light wrappers as needed: `SleepSoundsCard`, `HydrationCard`, `SleepStreakCard`, `QuickActionsCard` — composed from existing data/utilities (no new business logic).
- Preserve: offline hydration, `CompanionIntroSheet` first-launch flow, all mutations (add/edit/delete shift), employer logic.

### 3. Visual Language (tokens, not per-component hardcodes)
Update `src/styles.css`:
- Add tokens: `--glass-bg`, `--glass-border`, `--glow-primary`, `--glow-secondary`, `--shadow-premium`.
- Purple/blue glow gradient: `linear-gradient(135deg, oklch(0.62 0.19 280), oklch(0.65 0.17 240))`.
- Add `@utility glass-card` (rounded-3xl, backdrop-blur-xl, layered border + inner highlight + soft shadow).
- Add `@utility glow-accent` for primary cards.
- Typography: keep current font stack but tighten heading scale; add `tracking-tight` to card titles.

### 4. Reusable Card Shell
- `src/components/home/HomeCard.tsx`: standard glass shell with optional icon, title, accent, action slot. All dashboard cards render their existing content inside this shell for visual consistency.

### 5. Files Changed / Added

Added:
- `src/components/companion/CompanionDock.tsx`
- `src/components/home/HomeCard.tsx`
- `src/components/home/SleepSoundsCard.tsx`
- `src/components/home/HydrationCard.tsx`
- `src/components/home/SleepStreakCard.tsx`
- `src/components/home/QuickActionsCard.tsx`
- `src/components/home/GreetingHeader.tsx`

Modified:
- `src/routes/__root.tsx` — mount `CompanionDock` with route-aware visibility.
- `src/routes/dashboard.tsx` — replace JSX layout only; keep all queries/mutations.
- `src/styles.css` — glass + glow tokens, utilities.

Untouched:
- All data libs (`lib/insights`, `lib/sleep-engine`, wearables, prefs, offline snapshot).
- `/companion`, `/pilot`, `/sleep`, `/plan`, etc.
- `BottomNav`, auth, Supabase wiring.

### 6. Out of Scope
- No new backend, schema, or AI logic.
- No changes to Companion conversation, voice, lip-sync, or memory.
- Traffic card uses existing component only if data is wired; otherwise shows a clean "coming soon" inside the same glass shell.

### 7. Verification
- Manual: viewport 375×598 — grid collapses to single column, dock visible top-right, every existing feature reachable.
- Build passes (typecheck via tsgo on changed files).
- `/companion` tap from dock loads the premium animated avatar shipped last slice.

Approve and I'll implement.
