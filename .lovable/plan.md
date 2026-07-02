
# Batch B — AI Companion Polish (Investigation & Plan)

Investigation-first. Scope: Home focal point, portrait + orb visuals, richer greetings, voice/persona UX. No animated avatar, no wearables, no Smart Alarm.

## 1. Investigation Findings

**Files involved (existing, no new subsystems needed):**
- Home: `src/routes/dashboard.tsx` (886 lines), `src/components/home/GreetingHeader.tsx` (34), `src/components/AIBriefCard.tsx`.
- Companion visual: `src/components/PilotOrb.tsx` (conic-gradient orb + `OrbBadge`), `src/components/companion/SpeakingIndicator.tsx`.
- Pilot: `src/routes/pilot.tsx` (670), `src/routes/companion.tsx` (1603).
- Voice/persona UX: `src/components/voice/VoiceSettings.tsx` (354), `src/routes/settings.companion.tsx` (573).
- Prompts: `src/lib/ai/context.server.ts` (mode overlays already exist), `src/routes/api/brief.ts`, `src/lib/ai/prompts.server.ts`.

**What's reusable:**
- `OrbBadge` / `PilotOrb` — already on-brand (aurora conic gradient), just needs a bigger role on Home.
- 9 mode overlays in `context.server.ts` already exist; the 6 user-facing presets map cleanly.
- `greetingWithName()` in `src/lib/time/day-part.ts` handles time-of-day.
- `AIBriefCard` already renders insights/recommendations.

**What should be redesigned:**
- `GreetingHeader` — small 14×14 orb tucked in the corner. Elevate to a full-width "Companion Hero" card as Home's first block.
- Greeting copy — currently only `${dayPart}, ${name}`. Add one contextual line (shift + recovery + sleep-debt aware).
- `VoiceSettings` list — checkmark-only selected state; add pinned "Current" card at top + inline preview button per row.
- Persona overlays — tighten wording so Calm/Coach/Motivational read distinctly out loud.

**Performance:** all changes are presentation-layer; no new API calls. Greeting context reads data already fetched for the dashboard (shifts, insights, sleep). Animations use existing Tailwind keyframes + one CSS `@keyframes breathe` — GPU-only (transform/opacity). Portrait image is a single generated 1024² JPG imported statically (LCP-friendly).

**Mobile:** Hero card uses `grid-cols-[auto_1fr]`, 375px verified. Tap targets ≥44px. `dvh` where needed.

**A11y:** All decorative glow layers get `aria-hidden`. Speaking indicator gets `role="status" aria-live="polite"`. Persona radio group gets `role="radiogroup"` with keyboard navigation.

## 2. Home Experience — Companion Hero

Replace `GreetingHeader` with `CompanionHero` at the top of `dashboard.tsx`:
- Left: `OrbBadge size="lg"` with idle breathing glow.
- Right: greeting line ("Good evening, Joe"), one contextual sub-line ("Early shift tomorrow — 05:00"), and a large primary "Talk to Pilot" button linking to `/companion`.
- Below the hero: existing `AIBriefCard` (daily summary), a compact 3-stat strip (recommended bedtime · sleep debt · recovery) pulled from data already in dashboard scope.

No new queries — reuses `insights`, `recommendations`, next-shift, and sleep aggregates already fetched.

## 3. AI Visual Identity — Portrait + Orb

- Generate one premium abstract "Pilot" portrait (soft aurora nebula + suggested silhouette, no face detail — matches "no animated avatar" constraint). Save to `src/assets/pilot-portrait.jpg`.
- New `<PilotPortrait state="idle|speaking" size />` component: portrait image + soft radial glow layer + idle breathing animation + speaking-indicator pulse ring when `state="speaking"`. Reused on Home hero and Pilot page header.
- Keep `OrbBadge` for nav/inline uses.

## 4. Greeting Personality

Extend `src/lib/time/day-part.ts` (or add `src/lib/greeting/context.ts`) with `buildGreetingLine({ name, now, nextShift, sleepDebtMin, recoveryScore, prevBedtime })` returning one short contextual sentence. Pure function, unit-testable, no network. Rules:
- Prioritise: shift-in-<12h > poor recovery > sleep debt > bedtime nudge > neutral affirmation.
- Never more than one clause. Example outputs match the user's spec.

Applied in the new `CompanionHero` and (as `pilotGreeting()`) at top of `/pilot` route.

## 5. Voice Experience — VoiceSettings redesign

- Pin the currently-selected voice as a large "Now speaking" card at the top with waveform + Play preview + Change action.
- Below: horizontally-scrollable filter chips (Language, Accent), then a vertical list where each row has: avatar dot, name, 1-line description, ▶︎ preview icon, big radio target (whole row tappable).
- Reduce taps: no modal — inline preview, single-tap select. Optimistic UI.
- Preview button shows loading spinner while TTS streams; auto-stops previous preview.

## 6. Personality Presets — 6 canonical

Consolidate to the 6 requested presets and tighten copy in `MODE_OVERLAYS`:
- **Calm** (maps to `warm`) — soft, slower cadence, no exclamations.
- **Companion** (`companion`) — conversational, one follow-up question.
- **Coach** (`coach`) — action-first, timings + wins.
- **Friendly** (`friend`) — casual, light humour.
- **Professional** (`professional`) — precise, structured, minimal small talk.
- **Motivational** (`motivational`) — high-energy, single challenge.

Each overlay gets a distinctive cadence rule + example opener so the model produces audibly different output. Preset picker in `settings.companion.tsx` becomes a card grid (2×3) with a short sample line under each name and a "Preview voice" button that TTS-reads the sample in the current voice.

## 7. Performance & Regression Guardrails

- No new server calls in the Home path.
- Portrait image ≤180KB JPG, statically imported (Vite hashes + preloads).
- Animations: transform/opacity only, `will-change` avoided.
- Behind-the-scenes prompt changes gated so the brief/coach APIs still return existing JSON shape.
- TypeScript strict clean, security scan re-run pre-publish.

## 8. Out of Scope (confirmed)

Animated talking avatar, Smart Alarm, Fitbit, Oura, Apple Health, Garmin, Whoop, smart-home.

## 9. Delivery Order (small batches)

1. **B-1 Visual foundation** — generate portrait, ship `PilotPortrait`, breathing keyframe, add speaking-ring variant to `OrbBadge`.
2. **B-2 Home hero** — `CompanionHero` in `dashboard.tsx`, retire old `GreetingHeader` layout, add 3-stat strip.
3. **B-3 Greeting engine** — `buildGreetingLine()` + unit tests; wire into Home + Pilot.
4. **B-4 Persona overlays** — rewrite 6 overlays in `context.server.ts`, redesign preset picker.
5. **B-5 Voice selector** — pinned current voice + inline preview redesign in `VoiceSettings.tsx`.
6. **B-6 QA + publish** — typecheck, mobile pass at 375/390/430, security scan, publish.

Each sub-batch lands independently and is safe to revert.

Reply **"go B-1"** to start with the visual foundation, or approve the full sequence with **"go B"** and I'll ship B-1 → B-6 in order, pausing after each for your ack.
