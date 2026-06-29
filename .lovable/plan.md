## Goal
Make the landing hero unmistakably sell **Aura, the AI Sleep Companion** — visible, tappable, conversational — using the existing premium portrait avatar as the emotional centerpiece. Mobile-first, no clutter, no functional changes.

## Scope (only file edited)
- `src/routes/index.tsx` — `head()` meta, `Hero`, `HeroStack`, `Trust` chips.

Untouched: pricing, dashboard, onboarding, auth, payments, Companion logic, avatar component, CSS tokens, breakpoints/safe-area work from the last pass.

## Changes

### 1. Copy rewrite (mobile + desktop variants kept)
- **Eyebrow:** `Meet Aura · your AI Sleep Companion` → `Aura · the AI companion you can see, tap & talk to`
- **Headline (mobile, short):** `Meet the AI companion that helps you unwind, sleep & wake up better.`
- **Headline (sm+, editorial):** `Meet the AI companion that helps you unwind, sleep, and wake up better.` — "companion" in italic indigo-glow as today.
- **Subhead (mobile):** `Tap to talk. Sleep sounds, smart alarm, wind-down — one calm assistant for the hours that wreck everyone else.`
- **Subhead (sm+):** `Tap your companion after work, ask for calming sounds, start a wind-down routine, or let her wake you at the right time — a personal assistant built for shift life.`
- **Primary CTA:** `Start free — 7 days` (unchanged)
- **Secondary CTA:** `Meet your Companion` (unchanged, anchors to `#meet-aura`)

### 2. Hero trust row → companion-selling chips
Replace the three generic trust pills (Private / Fitbit·Oura / Memory) with four capability chips that match the user-requested support row, each with a Lucide icon already imported:
- `Mic` — Tap to talk
- `Waves` — Sleep sounds
- `BellRing` — Smart alarm
- `Moon` — Wind-down guidance

Move "Private by default · Fitbit & Oura sync" into one tiny line below the CTAs (kept, just demoted) so trust signal isn't lost.

### 3. HeroStack — keep premium avatar, tighten messaging
- Keep the portrait `CompanionAvatarFace size="lg"` and aura ring exactly as-is (premium reference is the strength of the page).
- Eyebrow inside card: `Your AI Sleep Companion · live` → `Live · Tap to talk to Aura`.
- Sub-line under "Meet Aura.": add one short whisper line `"Hey — rough shift? Let's wind down."` in muted small text, italic, to make the avatar feel alive without clutter.
- Inner chip row stays (`Sleep sounds · Smart alarm · Wind-down`) — already matches the brief.
- Tonight tile unchanged (mobile stacks, desktop floats — already polished).

### 4. SEO meta
Update `title` / `description` / `og:title` / `og:description` to lead with the new headline so social shares match the page.

## Premium guardrails
- Headline kept to **one** line on phones (≤ ~38 chars per line at 390px).
- Avatar size, aura, breath, blink unchanged — that's the premium hook, don't dilute.
- Chip row uses existing tokens (`border-border/60 bg-card/50`), no new colors.
- No new sections, no new images, no layout grid changes — only copy + chip swap inside the existing hero shells.

## QA
- Typecheck.
- Playwright screenshots at 390 / 430 / 768 / 1280 — confirm no overlap, all CTAs tappable, chips wrap cleanly, avatar remains the focal point, no clipped text.

Ship only if the hero reads as a premium personal-assistant pitch and the avatar still feels like the centerpiece.