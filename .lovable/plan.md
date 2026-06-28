
# Slice 11 — AI Companion Avatar Home Integration

Investigation-first. No code until approved. Backward compatible — every existing card, route, and prefs key stays intact.

## 1. Investigation Report

### 1.1 Current companion entry points
- `src/components/CompanionAvatar.tsx` — 44×44 sparkle chip in the dashboard header row, links to `/companion`, pulses when the current brief period is unseen (`brief:seen` event + `lastSeenKey()`).
- `src/components/CompanionQuickAsk.tsx` — period-aware "Ask" popover next to the avatar; hidden below `sm:` (mobile users currently see no quick-ask).
- `src/components/CompanionWhisper.tsx` — proactive insight card lower in the feed.
- `src/components/PilotOrb.tsx` — voice orb used inside `/pilot` and `/companion`.
- Bottom nav has `/pilot` (Mic) but no direct Companion tab; sidebar route surface exposes `/companion` via `AppSidebar`.

### 1.2 Dashboard header today (`src/routes/dashboard.tsx` lines 309–322)
```
grid-cols-[minmax(0,1fr)_auto_auto_auto]
  ArrivalHero | CompanionQuickAsk (sm+) | CompanionAvatar (44px) | Profile (40px)
```
On a 375 px viewport the avatar reads as a tiny accent next to the profile dot — not a "central assistant". Mockup direction calls for a calm, prominent hero presence under the greeting.

### 1.3 Brief / period plumbing
- `src/lib/companion/brief-window.ts` already exposes `currentBriefPeriod()`, `periodAnchor()`, `lastSeenKey()`, and dispatches `brief:seen`.
- `MorningBrief` / `DailyBrief` already mark periods seen, so a new hero avatar can subscribe to the same signal with no new state machinery.

### 1.4 First-launch / onboarding
- `src/components/Onboarding.tsx` runs once (gated by `prefs.onboarded`). It covers consent, AI disclaimer, safety. There is **no** companion-specific intro and **no** memory explanation surfaced at launch.
- Memory consent today lives only inside `/companion` and `/memory`.

### 1.5 Prefs / settings
- `src/lib/prefs.ts` has `companionMode`, `companionName`, `memoryConsent`, `voiceId`, etc.
- `src/lib/companion/voice-action-prefs.ts` stores per-device local prefs (voice replies, quiet hours, confirm).
- `src/routes/settings.companion.tsx` is the single source of truth for editable companion settings.
- No `companionIntroSeen` flag exists yet — we need one (local-only, additive, non-destructive).

### 1.6 Analytics
- `src/lib/companion/analytics.ts` `track()` already exists. New events fit the existing union — additive only.

### 1.7 Accessibility / mobile observations
- Header grid has four columns at 375 px → tight; on iPhone SE the `Ask` chip is hidden, leaving only the 44 px sparkle.
- `CompanionAvatar` uses 44 px target, good. Profile chip is 40 px — already below standard but out of scope.
- Reduced-motion: pulse uses `motion-reduce:animate-none` ✓.
- No `aria-live` announcement when a new brief becomes available.

### 1.8 Risks / regressions to avoid
- Don't remove the existing `CompanionAvatar` chip — sidebar/desktop layout still relies on it implicitly via dashboard header. We will **keep it as a compact secondary** and add a new `CompanionHero` block beneath the header on mobile + at hero position on desktop.
- Don't reflow `RightNowCard` order — it must remain the first content card on dashboard. Hero avatar goes **above** RightNow but **below** the greeting row.
- Don't gate first-launch intro on prefs we'd have to migrate; use a local-storage flag plus an optional server-persisted echo when convenient.

## 2. Visual Placement Plan

```text
┌─────────────────────────────────────────────────────────┐
│ ArrivalHero (greeting + date)        [Ask] [✦] [👤]    │  ← unchanged header
├─────────────────────────────────────────────────────────┤
│  ┌───────────────────────────────────────────────────┐  │
│  │  CompanionHero (NEW)                              │  │
│  │  ◉  "Good evening, Casey."                        │  │
│  │     Evening wind-down brief is ready.             │  │
│  │     [Open Companion]  [Not now]                   │  │
│  └───────────────────────────────────────────────────┘  │
├─────────────────────────────────────────────────────────┤
│  RightNowCard                                           │
│  DecisionCenter / Activity / Whisper …  (unchanged)     │
└─────────────────────────────────────────────────────────┘
```

- Mobile: full-width card, ~120 px tall, single CTA + dismiss.
- Tablet (`sm:`): same card, two-column body (avatar | text + CTAs).
- Desktop (`lg:`): same card, slightly larger orb, secondary "Settings" link inline.
- Avatar visual: reuses `PilotOrb` at calm idle, color state from period; never auto-plays audio.
- Header `CompanionAvatar` stays as a quick secondary jump (no duplicate intent — header is "tap to open", hero is "tap to engage with context").

## 3. Avatar States

Single `state` prop drives orb tint + label:

| State | Trigger | Visual | Copy |
|---|---|---|---|
| idle | no fresh brief, no pending action | soft indigo | "I'm here when you need me." |
| greeting | first view in a period | gentle pulse | "Good {morning/afternoon/evening}, {name}." |
| morning_brief | period=morning & unseen | warm amber halo | "Your morning brief is ready." |
| afternoon_check | period=afternoon & unseen | sky halo | "Quick afternoon check-in?" |
| evening_wind | period=evening & unseen | violet halo | "Want to start your wind-down?" |
| action_pending | `companion:action-pending` event | primary ring | "An action needs your confirmation." |
| voice_muted | local pref voiceReplies=off | mute glyph | (no voice copy) |
| quiet_hours | `inQuietHours()` true | dim 60% opacity, no pulse | "Quiet hours — I'll stay quiet." |
| offline | `useOnline()` false | gray ring | "Offline — limited help available." |

All states honor `prefers-reduced-motion`.

## 4. First-Launch Companion Intro

New component `CompanionIntroSheet` (bottom sheet on mobile, dialog on ≥sm):
- Trigger: `companionIntroSeen` flag missing in `localStorage` AND user is on `/dashboard` AND `prefs.onboarded === true` (so it never overlaps the legal onboarding).
- 3 short slides (≤3 taps):
  1. Meet your Companion — what it can help with (sleep, sounds, alarms, briefs).
  2. Memory is optional — off by default; you can review/edit/delete anytime. Link to `/memory`.
  3. Voice & actions — voice replies optional; destructive actions always confirm. Link to `/settings/companion`.
- Single primary CTA "Got it" sets flag + fires `track({event:"settings_changed",surface:"companion-sheet"})` and a new analytics event (see §8).
- Skippable via close button (still marks seen — non-coercive).

## 5. Home Screen Proactive Prompts

`CompanionHero` reads three signals to choose at most **one** prompt at a time:
1. `currentBriefPeriod()` + unseen → "{Period} brief is ready."
2. `prefs.windDownEnabled` + within wind-down window → "Want to start your wind-down?"
3. Memory hint (`fetchCompanionHints`) → "Would you like rain sounds for 20 minutes?"

Dismiss button stores `{key, ts}` in `localStorage` for 6 hours so we never re-nag the same prompt. Quiet hours suppresses any voice — copy remains visible but muted glyph shown.

## 6. Files Affected

New:
- `src/components/companion/CompanionHero.tsx`
- `src/components/companion/CompanionIntroSheet.tsx`
- `src/lib/companion/hero-state.ts` (pure resolver: signals → state + copy + cta)
- `src/lib/companion/intro-flag.ts` (localStorage get/set, SSR-safe)

Edited (small, additive):
- `src/routes/dashboard.tsx` — mount `<CompanionHero />` above `RightNowCard`; mount `<CompanionIntroSheet />` once.
- `src/lib/companion/analytics.ts` — extend union with `avatar_viewed`, `avatar_tapped`, `companion_opened_from_dashboard`, `intro_viewed`, `intro_completed`, `memory_explainer_viewed`, `prompt_dismissed`, `prompt_accepted`, `companion_settings_opened`.
- `src/components/CompanionAvatar.tsx` — emit `avatar_tapped` on click + `aria-live` polite announcement when state changes (no visual change).
- `src/components/memory/HowMemoryWorks.tsx` — used inside intro sheet step 2; verify wording matches §"AI Memory Explanation" (no copy changes outside that file).

Not touched: existing brief components, `/companion` route, sidebar, BottomNav, onboarding legal flow.

## 7. Implementation Plan (after approval)

1. Add analytics union additions + `intro-flag.ts` + `hero-state.ts` (pure, unit-friendly).
2. Build `CompanionHero` (PilotOrb at state, copy, CTA → `/companion`, dismiss).
3. Build `CompanionIntroSheet` (3 steps, reuses `HowMemoryWorks`).
4. Mount both in `src/routes/dashboard.tsx`.
5. Wire `aria-live` region inside hero for state transitions.
6. Verify typecheck + manual viewport sweep (375 / 768 / 1280).

## 8. Mobile QA Checklist
- 375×667 (iPhone SE), 390×844 (iPhone 14), 414×896, 768, 1024, 1440.
- No horizontal scroll; safe-area insets respected.
- Hero card ≥ 44 px tap targets; CTA and dismiss reachable one-handed.
- Intro sheet animates from bottom on mobile, centers on desktop.
- No layout shift when state transitions (reserve min-height).
- Pulse disabled under `prefers-reduced-motion`.

## 9. Accessibility Checklist
- Hero is a `<section aria-labelledby>` with named heading.
- Orb image `aria-hidden`; CTA buttons have visible labels.
- State changes announced via `aria-live="polite"`.
- Intro sheet uses shadcn `Sheet`/`Dialog` (focus trap + ESC handled).
- Focus returns to hero CTA after intro dismiss.
- Keyboard: Tab order → Hero CTA → Dismiss → next card.
- Contrast ≥ 4.5:1 verified against `--background`.

## 10. Rollback Plan
- All additions are net-new files plus four lines in `dashboard.tsx`. Rollback = revert that JSX block + delete the new files. Prefs/db untouched. localStorage flag is forward-compatible.

## 11. Safety
- No auto-execution; CTAs only navigate.
- Memory remains off unless user toggles in `/companion` or `/memory`.
- Voice replies remain gated by existing `voice-action-prefs` and quiet hours.
- Destructive actions are not surfaced from the hero.

Awaiting approval to implement.
