
# Bundle 2 – AI Experience & Decision Center

Goal: make RestPilot feel like one living assistant that has been working all day, instead of a grid of cards. Built entirely on top of the Trust Layer and existing AI tables — **no new AI logic, no duplicated state**.

---

## Investigation Findings

What already exists we can reuse:

- `ai_recommendations` — every AI output (intent, headline, rationale, evidence_json, predicted_impact, confidence, pattern_id, created_at). This is already our decision ledger; nothing new to write.
- `ai_feedback` — `helpful / not_helpful / already_did / ignored_today / dismissed_forever`. `submitFeedback()` already exists in `src/lib/ai-feedback.ts` and already mutes related patterns.
- `ai_log` — every model call (intent, tokens, duration). Perfect for the "synchronized / recalculated / adjusted" timeline rows that aren't full recommendations.
- Trust components: `ConfidenceBadge`, `WhyButton`, `WhatChanged`, `RecommendationDetailSheet` (in `src/components/ai/trust/`), plus `trust.ts` helpers `normalizeConfidence`, `deriveSources`, `confidenceLabel`.
- `ArrivalHero`, `RightNowCard`, `TomorrowPreviewCard`, `DailyReviewCard`, `LongClock`, `PatternAlerts` are wired into `dashboard.tsx`.

Gaps:

1. No surface lists *today's* recommendations as a feed; only the latest per intent is shown inline.
2. `ArrivalHero` doesn't reference how many adjustments the AI has made since last visit.
3. No mixed timeline of recommendations + log events ("synchronized", "recalculated").
4. `LongClock` bands open a local reason popover only — not the Trust sheet, no Accept/Snooze/Ignore.
5. Recommendation cards expose `WhyButton` but not Accept/Snooze/Ignore controls. `submitFeedback` exists but isn't wired to those three explicit verbs.

Everything below is a thin UI layer over data that's already being written.

---

## Implementation Plan

### 1. Decision feed data hook (shared)

New `src/lib/ai/decisions.ts` (client) exposing:

- `useTodayDecisions()` → React Query. Reads `ai_recommendations` for `created_at >= start of local day`, ordered desc. Returns normalized `Decision[]` (id, intent, headline, rationale, confidence, evidence, predictedImpact, createdAt, patternId, feedbackReaction?).
- `useTodayActivity()` → merges today's `ai_recommendations` rows with today's `ai_log` rows (last 50) into a single time-sorted `ActivityEvent[]` with `kind: "decision" | "system"` and a short label derived from `intent` (e.g. `sync` → "Sleep data synchronized", `daily_plan` → "Plan recalculated", `smart_alarm` → "Alarm adjusted"). Pure read; no new tables, no server fn.
- `useDecisionCount(sinceIso)` → count of today's decisions, plus count since a given timestamp (for the Arrival "while you were away" line). The "since" baseline is `localStorage["rp_last_visit"]`, written on dashboard mount *after* read.

Feedback writes reuse `submitFeedback()`. Add three thin wrappers `acceptRecommendation / snoozeRecommendation / ignoreRecommendation` that map to existing reactions:
- Accept → `helpful`
- Snooze → `ignored_today` (already mutes for the day)
- Ignore → `dismissed_forever` (already mutes the pattern 30 days)

No schema change.

### 2. AI Decision Center route + card

- New route `src/routes/decisions.tsx` (`/decisions`). Mobile-first list, desktop two-column. Each row uses existing `ConfidenceBadge`, opens existing `RecommendationDetailSheet`, and shows Accept / Snooze / Ignore buttons (reused on the inline cards too — see step 5).
- New `src/components/DecisionCenterCard.tsx` placed near the top of the dashboard: shows `n decisions today`, the three most recent headlines, and a "View all" link to `/decisions`. Tapping the card or any row opens the sheet inline.

### 3. Personalized Arrival Experience

Extend `ArrivalHero.tsx` only (no new component):
- Pull `useDecisionCount(lastVisit)` and the latest pattern severity.
- Render a second line below the greeting: *"While you were away, I made N adjustments to today's plan."* When `N === 0`, fall back to current copy.
- Pull the next upcoming recommendation (soonest `evidence_json.timeWindow.startIso` in the future from today's decisions) and append *"Next nudge in ~42 min."*. Skip if none.
- Recovery tone derived from existing `insights.ts` recovery score — already imported on the dashboard, passed down as a prop.

### 4. AI Activity Feed

- New `src/components/AIActivityFeed.tsx` rendering `useTodayActivity()` as a vertical timeline (timestamp · icon · short label · optional sub-line). 50-row cap, virtualized only if needed.
- Mounted on `/decisions` as a side panel (desktop) / second tab (mobile). Also surfaces a collapsed 5-row preview on the dashboard below the Decision Center card.

### 5. Interactive Long Clock

- Refactor `LongClock`'s `setActiveId` popover to optionally open `RecommendationDetailSheet` instead, when a band/marker maps to a real decision. Mapping: look up the most recent decision today whose `intent` matches the band id (`smart_alarm` → alarm marker, `winddown` → wind band, `light_plan` → light band, `caffeine` → caffeine marker, `commute` → commute, `recovery` → recovery band, `sleep_plan` → sleep band). Bands with no matching decision keep today's lightweight reason popover.
- When the sheet is open, render Accept/Snooze/Ignore inside the sheet footer and an extra "If ignored" + "Impact this week" section pulled from `evidence_json.predictedImpact` and `evidence_json.weeklyImpact` (already present on many payloads; show "—" when missing instead of fabricating).

### 6. Recommendation Controls (shared)

- New `src/components/ai/trust/RecommendationActions.tsx`: three buttons wired to the wrappers from step 1, with optimistic state + toast, and disabling once a reaction is recorded for that recommendation today.
- Embed it in: `RightNowCard`, `TomorrowPreviewCard`, `DailyReviewCard`, `SmartAlarmCard`, the new Decision Center rows, and the Long Clock sheet. No duplicate handlers — every surface calls the same wrappers.

### 7. Navigation + polish

- Add `/decisions` to `BottomNav.tsx` (mobile) and the desktop side nav.
- Add a head() block with route-specific title/description on `/decisions`.
- No homepage marketing changes.

---

## Out of scope (explicitly)

- No new AI intents, no new model calls, no new tables, no new edge functions.
- No changes to `__root.tsx` shell, marketing pages, billing, or onboarding.
- No regression to offline snapshot — decisions hook degrades to cached data via the existing offline cache layer.

## Verification

- `tsgo` clean.
- Playwright at 390×844: dashboard shows the new card, `/decisions` lists today's rows, the sheet opens with Trust evidence + actions, Long Clock band → sheet works, no horizontal overflow.
- Desktop ≥1280: two-column Decision Center, activity feed visible side-by-side.
- Confirm `submitFeedback` rows land in `ai_feedback` after Accept / Snooze / Ignore by running a quick `supabase--read_query` after the Playwright pass.

Awaiting approval before any code is written.
