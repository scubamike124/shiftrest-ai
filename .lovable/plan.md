
# Plan — 14-day Trial, Trial Usage Cap, Science Trust Section

Two independent workstreams. Both are frontend-heavy plus a small server-side gate for the voice cap.

---

## 1) Trial length: 7 days → 14 days

### 1a) Stripe/billing config (source of truth)
- `src/lib/billing.functions.ts` line 102: change `trial_period_days: 7` → `trial_period_days: 14`.
- No Stripe product/price change needed — `trial_period_days` is set per checkout session, not on the price. Existing subscribers/trials are unaffected; only new checkouts get 14 days.

### 1b) Copy sweep
Every user-visible "7-day" / "7 days" trial reference:
- `src/routes/paywall.tsx`
  - L158 CTA: `"Start 7-day free trial"` → `"Start 14-day free trial"`
  - L196 Monthly sub: `"per month · 7-day free trial"` → `"per month · 14-day free trial"`
  - L204 Annual sub: `"per year · save 48% · 7-day free trial"` → `"per year · save 48% · 14-day free trial"`
- `src/routes/pricing.tsx`
  - L29 Monthly `trial: "7-day free trial"` → `"14-day free trial"`
  - L32 / L70 "Long Clock (7-day plan)" — this is a product feature, NOT the trial. Leave unchanged.
- `src/routes/index.tsx`
  - L159 `"Start free — 7 days"` → `"Start free — 14 days"`
  - L855 perks `"7-day free trial"` → `"14-day free trial"`
  - L937 `"Free for 7 days. No card games…"` → `"Free for 14 days. No card games…"`
- `src/routes/features.tsx`
  - L192 `"7 days free. No card games…"` → `"14 days free. No card games…"`
- `src/lib/email-templates/trial-ending.tsx` — copy is already parameterized by `daysRemaining`, no change.
- `src/routes/legal.subscription.tsx` — currently generic ("If we offer a free trial…"), no change needed.

No other 7-day trial strings exist (verified via ripgrep).

---

## 2) Trial voice/AI Companion usage cap (60 minutes over the 14 days)

Goal: hard cap on OpenAI Realtime session minutes for users in `status = "trialing"`. Paying subscribers are unaffected.

### 2a) Schema (single migration)
New table `trial_usage`:
```
user_id uuid PK references auth.users on delete cascade
environment text not null              -- 'sandbox' | 'live'
voice_seconds_used integer not null default 0
last_updated_at timestamptz not null default now()
```
- RLS enabled. Policy: `SELECT` only own row (authenticated). No client `INSERT/UPDATE` — writes go through the server function only.
- GRANTs: `SELECT` to `authenticated`, `ALL` to `service_role`.
- Composite unique on `(user_id, environment)` via PK swap: PK = `(user_id, environment)`.

### 2b) Server-side gate on session mint
`src/lib/realtime/openai.functions.ts` (`mintRealtimeSession`) — add before the OpenAI `client_secrets` call:
1. Load subscription state via existing `context.supabase` (`subscriptions` row, latest for env).
2. Compute `isTrial` = `status === "trialing"`. Paid tiers (`active`/`lifetime`/`canceled`-with-future-end) skip the cap entirely.
3. If `isTrial`:
   - Read `trial_usage.voice_seconds_used` for `(userId, env)` via `supabaseAdmin` (dynamic import in handler).
   - If `>= TRIAL_VOICE_SECONDS_CAP` (constant = `60 * 60`), return `{ error: "trial_limit_reached", limitReached: true, capMinutes: 60 }` — DO NOT mint session.
4. Return the client secret plus `{ trialRemainingSeconds }` so the client can show a countdown.

### 2c) Usage accounting (client → server)
`src/lib/realtime/useOpenAIRealtime.ts`:
- Track `sessionStartAt` when datachannel opens.
- On `disconnect()` / component unmount / `pagehide` / peer-connection failure, compute elapsed seconds and POST to a new server fn `recordTrialVoiceUsage({ seconds, environment })`.
- Use `navigator.sendBeacon` with a JSON blob to a small server route (`src/routes/api/trial-usage-beacon.ts`) as a fallback when the page is unloading — server fns can't be reached from `sendBeacon` cleanly.
- Server route validates the Supabase JWT (existing pattern in `src/routes/api/*`), then `UPSERT`s `voice_seconds_used = voice_seconds_used + :delta`, clamped at cap.

### 2d) UX
- Idle Pilot screen: if `isTrial` and remaining < cap, show a subtle chip: `"Trial voice minutes: 42 / 60 left"`.
- On mint failure `trial_limit_reached`: replace the "Tap to Talk" affordance with a card — "You've used your 60 trial voice minutes. Upgrade to keep talking to Pilot." + CTA to `/paywall`.
- No cap for text-only AI (chat prompts through `/api/ai`, `/api/coach`) in this pass — the user asked specifically about voice/Companion conversation minutes, which is where the real cost is. If they want text-token gating later, that's a separate scope.

### 2e) Constants
`src/lib/trial-limits.ts`:
```ts
export const TRIAL_VOICE_MINUTES_CAP = 60;
export const TRIAL_VOICE_SECONDS_CAP = TRIAL_VOICE_MINUTES_CAP * 60;
```
Single source of truth; imported by server + client.

---

## 3) Science / trust section

Two placements:

### 3a) Marketing site — new route `src/routes/science.tsx`
Public page at `/science`, linked from:
- Site footer (`src/components/site/SiteFooter.tsx`) under a "Learn" column.
- Paywall (`src/routes/paywall.tsx`) — small "Backed by circadian research →" link under the perks list.
- Landing page (`src/routes/index.tsx`) — new section between features and pricing.

Content structure:
1. **Hero** — "RestPilot's recommendations are grounded in decades of circadian and shift-work research."
2. **The science we build on** — 4–6 short cards, each with a plain-language claim + a citation to a public, established source. Candidates:
   - Circadian rhythm & the SCN — Czeisler / Duffy (Harvard Med) reviews; NIH/NIGMS circadian primer.
   - Shift-work sleep disorder — AASM ICSD-3 definition; NIOSH "Interim NIOSH Training for Nurses on Shift Work and Long Work Hours".
   - Light exposure & melatonin suppression — Zeitzer et al., Rüger & Scheer reviews.
   - Strategic caffeine timing — Reyner & Horne (nap+caffeine), Wesensten et al. (military fatigue countermeasures).
   - Sleep debt & cognitive performance — Van Dongen et al. 2003 (Sleep journal).
   - Sleep cycle wake timing (~90 min) — Dement & Kleitman baseline; contemporary Walker synthesis.
3. **How we translate research into recommendations** — 3-step diagram: (a) your rotation + wearable signals → (b) circadian model → (c) plain-English plan. Emphasizes: we don't invent advice; the AI selects from research-supported interventions.
4. **What we DON'T do** — honest limits. Not a medical device; not a substitute for a sleep specialist; individual variation matters. Links to existing `/legal/disclaimers` and `/safety`.
5. **Further reading** — external links to NIOSH, CDC NIOSH shift-work resources, AASM patient pages, Sleep Foundation shift-work section. Real URLs only.

`head()` metadata: title "The science behind RestPilot AI — circadian & shift-work research", real description, og tags.

### 3b) In-app — trust affordance
Add a small `<ScienceBadge />` to:
- `CoachTipCard` and `AIBriefCard` footers: `"Based on circadian research →"` linking to `/science#[anchor]` matching the recommendation type (light, caffeine, wake-window).
- Companion recommendation detail sheet (`RecommendationDetailSheet.tsx`) if it has a footer slot — add "Why this works" link.

The link is the trust signal. Copy is short so it doesn't crowd the card.

---

## Technical section

### Files to add
- `supabase/migrations/<ts>_trial_usage.sql`
- `src/lib/trial-limits.ts`
- `src/lib/realtime/trial-usage.functions.ts` (record + get remaining)
- `src/routes/api/trial-usage-beacon.ts` (sendBeacon target)
- `src/routes/science.tsx`
- `src/components/trust/ScienceBadge.tsx`

### Files to modify
- `src/lib/billing.functions.ts` (trial_period_days)
- `src/routes/paywall.tsx`, `src/routes/pricing.tsx`, `src/routes/index.tsx`, `src/routes/features.tsx` (copy)
- `src/lib/realtime/openai.functions.ts` (mint-time gate)
- `src/lib/realtime/useOpenAIRealtime.ts` (elapsed tracking + beacon)
- `src/routes/pilot.tsx` and `src/routes/_authenticated/lab.pilot-realtime.tsx` (trial remaining chip + upgrade card)
- `src/components/site/SiteFooter.tsx` (footer link)
- `src/components/CoachTipCard.tsx`, `src/components/AIBriefCard.tsx`, `src/components/ai/trust/RecommendationDetailSheet.tsx` (ScienceBadge)

### Out of scope
- Changing text/token limits for existing paid tiers.
- Metering text-only AI usage during trial.
- Rewriting legal/subscription copy beyond the trial-length swap.
- Adding new medical/citable claims we can't verify — every citation on `/science` will be a public research org (NIOSH, CDC, AASM, NIH, published Sleep-journal papers), no proprietary or unverified sources.

### Verification
- After edits: build passes, `rg "7-day\|7 days"` returns only the "Long Clock 7-day plan" (product feature) matches.
- Manually open `/paywall` in preview — CTA says 14-day, plan cards say 14-day.
- Trial cap test on preview: seed a `trial_usage` row at 3599s, open Pilot, confirm one more session mints and hits the cap on next attempt with the upgrade card.
