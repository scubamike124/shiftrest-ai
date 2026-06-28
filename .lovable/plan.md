## Goal

Make the public landing page (`/`) immediately sell RestPilot as a **visible AI sleep assistant**, using the same premium portrait avatar from the dashboard. No existing content removed — only added/restructured.

## Changes

### 1. Hero — swap right-side visual for the Companion

In `src/routes/index.tsx > HeroStack`:
- Keep the existing Sleep-window / circadian dial card, but **shrink it and move it to a secondary floating tile** (bottom-left of the stack).
- The primary visual becomes a new **CompanionHeroCard**:
  - Large `CompanionAvatarFace` (size `lg`, aura on) inside a glass card matching the new bento style (`glass-card`, soft purple/blue glow).
  - Eyebrow: "Your AI Sleep Companion · live".
  - Headline (display font): "Meet Aura."
  - Sub: "Tap to talk. She plans tonight's sleep, calms you down after shift, runs sounds, sets your smart alarm, and checks in all day."
  - Pulsing "Tap to talk" pill linking to `/companion` (or `/auth` if signed out, with `?next=/companion`).
  - Three micro-chips under the avatar: "Sleep sounds", "Smart alarm", "Wind-down".
- Add a small "AI Companion" eyebrow chip to the headline column so the H1 narrative ties to the avatar.

### 2. New section — "Meet your Companion" (full bento panel)

Insert immediately after `LogoTicker`, before `DayInLifeSection`, gated behind the same `showBelowFold`:

`<CompanionShowcaseSection />` — premium glass bento with:
- Left: oversized `CompanionAvatarFace` (lg, aura) on a dark glass card with soft indigo/violet glow, mirroring the dashboard `CompanionHero` styling. Caption: "Tap the avatar anywhere in the app to open your Companion."
- Right: 2×3 bento grid of capability cards (glass + icon + 1-line copy):
  - Wind-down after shift
  - Sleep sounds & mixes
  - Smart alarm
  - Nightly guidance & check-ins
  - Routines & reminders
  - Personal memory (private to you)
- Primary CTA: "Meet your Companion" → `ctaHref`; secondary: "See how memory works" → `/memory` (anchor only if signed in, else marketing copy).

### 3. Reuse, do not duplicate

- Use the existing `CompanionAvatarFace` from `src/components/companion/Avatar.tsx` (already premium portrait + lip-sync engine). No new avatar art.
- Use existing CSS tokens from the bento redesign (`glass-card`, `glass-card-accent`, `dock-glow`, `card-eyebrow`, `card-title`) — already in `src/styles.css`.
- All other landing sections (`DayInLifeSection`, `SmartAlarmSection`, `DashboardSection`, `Testimonials`, `PricingPreview`, `CtaBand`) stay **unchanged**.

### 4. Mobile-first polish

- On `< sm`, CompanionHeroCard stacks above the dial tile (avatar first, full-width, 240px).
- Showcase section becomes single column; capability bento becomes a 2-col grid on mobile, 3-col on `lg`.
- Reduced-motion respected (avatar already does this).

### 5. SEO

Update hero `<head>` meta to mention the Companion:
- Title: "RestPilot AI — Your AI Sleep Companion for Shift Workers"
- Description and og:description rewritten to lead with "Meet Aura, your always-on AI sleep companion…".

## Files touched

- `src/routes/index.tsx` — replace `HeroStack`, add `CompanionShowcaseSection`, update `<head>` meta, add `CompanionHeroCard` component.

## Files NOT touched

- All other landing sections, pricing, footer, auth flow, dashboard, Companion route, avatar component itself.

## Acceptance

- Above the fold on mobile: the premium avatar is visible with a clear "Tap to talk" CTA.
- A visitor scrolling once sees a dedicated Companion section explaining sleep, calming, sounds, alarm, routines, reminders, nightly guidance.
- Pricing, day-in-life, smart alarm, testimonials all still render as before.