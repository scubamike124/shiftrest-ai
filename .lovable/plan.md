## Legal & Compliance Final Rollout — Investigation & Plan (Steps 4–11)

Investigation only. No code shipped until you approve. Typecheck runs after each step. No changes to auto-generated Supabase files, no edits to existing auth/Stripe/wearable/push/deletion flows beyond what each step requires.

---

### Current State Audit (what already exists)

- **Legal docs**: 15 routes under `/legal/*` + `/safety` + `LEGAL_DOCS` registry in `src/lib/legal/meta.ts`. Footer wired. `/privacy` + `/terms` redirect to `/legal/*`.
- **Auth**: `src/routes/auth.tsx` — Google OAuth + email/password. Has a passive Terms/Privacy line, **no consent checkbox, no acceptance log**.
- **Onboarding**: `src/components/Onboarding.tsx` — 3 slides, final slide shows DISCLAIMER but uses a single "I understand" button (no checkboxes, no granular consent, no persistence beyond `onboarded` flag).
- **Account deletion**: `src/lib/account.functions.ts` — deletes `shifts`, `employers`, `user_prefs`, `coach_messages` + `auth.admin.deleteUser`. **Missing**: `ai_memory`, `ai_log`, `ai_recommendations`, `ai_feedback`, `user_events`, `trips`, `tz_events`, `push_subscriptions`, `wearable_connections`, `wearable_readings`, `notification_log`, `notification_prefs`, `ai_patterns`, `profiles`, Stripe subscription cancel, retained-records disclosure.
- **No** export function, no AI memory purge function, no cookie banner, no consent modals for wearables/push, no paywall renewal block, no safety links on Smart Alarm / Right Now / Companion / Wearable cards.
- **Risky wording found** (sweep targets): `src/routes/index.tsx`, `src/routes/features.tsx`, `src/components/SmartAlarmCard.tsx`, `src/components/RightNowCard.tsx`, `src/components/CompanionWhisper.tsx`, `src/components/WearableCard.tsx`, `src/components/CoachTipCard.tsx`, `src/routes/coach.tsx`, `src/routes/paywall.tsx`, `src/routes/pricing.tsx`, `src/routes/plan.tsx`, `src/routes/playbooks.tsx`. Likely phrases to soften: "optimize", "fix", "guarantees", "protects", "ensures", "tracks your health", anything implying medical/safety outcomes.

---

### Step 4 — Legal Acceptance + Consent Tracking

**DB migration** (single migration):
- `public.legal_acceptances` — `id`, `user_id` FK→auth.users, `document_slug` (text), `document_version` (text — uses `LEGAL_EFFECTIVE`), `accepted_at` (timestamptz default now), `ip` (inet, nullable), `user_agent` (text, nullable), `source` (text — e.g. `signup`, `onboarding`, `wearable_connect`, `push_enable`, `paywall`), `snapshot_json` (jsonb — frozen titles+versions list).
- Indexes: `(user_id, document_slug, document_version)`, `(user_id, accepted_at desc)`.
- GRANTs: `SELECT, INSERT` to authenticated (no UPDATE/DELETE — append-only audit log), `ALL` to service_role.
- RLS: users can SELECT/INSERT own rows (`auth.uid() = user_id`).
- `ALTER TABLE public.user_prefs ADD COLUMN consent_json jsonb DEFAULT '{}'::jsonb` — latest active flags (`tos`, `privacy`, `ai_disclaimer`, `health`, `safety`, `esign`, `cookies`, `wearables`, `push`, `marketing_opt_in`).

**Server function**: `src/lib/legal/consent.functions.ts`
- `recordAcceptanceFn({ documents: string[], source: string, snapshot? })` — inserts one row per doc into `legal_acceptances`, merges into `user_prefs.consent_json`. Reads IP/UA from request headers inside handler.
- `getConsentStatusFn()` — returns current `consent_json` and last accepted versions.

**UI**:
- `src/routes/auth.tsx` — required checkbox on signup: "I agree to the Terms, Privacy Policy, AI Disclaimer, Health & Wellness Disclaimer, Safety Center, and Electronic Consent." Sign-in unaffected. On successful signup, call `recordAcceptanceFn({ source: 'signup' })`.
- `src/components/consent/ConsentModal.tsx` — shared modal (title, bullet disclosures, doc links, "I understand and agree" CTA, cancel). Used for wearable and push first-connect.
- Wire into `src/components/WearableCard.tsx` connect flow (gate before OAuth start) and `src/lib/push/subscribe.functions.ts` UI caller (likely `src/components/NotificationsSection.tsx`).

---

### Step 5 — Truthful Deletion / Export / AI Memory Purge

**`src/lib/account.functions.ts` — expand `deleteAccountFn`**:
- Cancel active Stripe subscription before purge (try/catch; non-fatal). Use `createStripeClient(env)` from `@/lib/stripe.server`, read sub via `supabaseAdmin`.
- Purge in dependency order: `ai_feedback`, `ai_recommendations`, `ai_memory`, `ai_patterns`, `ai_log`, `user_events`, `trips`, `tz_events`, `wearable_readings`, `wearable_connections`, `push_subscriptions`, `notification_log`, `notification_prefs`, `coach_messages`, `shifts`, `employers`, `user_prefs`, `legal_acceptances` (retain? see below), `profiles`, `subscriptions` (retain billing record), then `auth.admin.deleteUser`.
- **Retained records disclosure**: keep `subscriptions` rows (tax/accounting) and `legal_acceptances` (audit/legal). Return `{ ok, retained: ['subscriptions','legal_acceptances'] }`.
- Update `/legal/privacy` + UI delete confirmation copy to match: "We retain Stripe billing records and legal acceptance logs as required by tax, accounting, and legal-defense obligations."

**New server fns** in `src/lib/account.functions.ts`:
- `exportAccountFn` — returns JSON bundle of all user-owned rows (profile, prefs, shifts, employers, ai_memory, ai_recommendations, ai_feedback, ai_log, user_events, trips, tz_events, wearable_connections (token redacted), wearable_readings, notification_prefs, notification_log, push_subscriptions (endpoint redacted), legal_acceptances, subscriptions). Client downloads as `restpilot-export-<date>.json`.
- `purgeAiMemoryFn` — deletes `ai_memory`, `ai_recommendations`, `ai_feedback`, `ai_patterns` for user; preserves shifts/prefs. Surfaced from `src/routes/memory.tsx`.

**UI**: add Export + Purge AI Memory buttons in `src/routes/profile.tsx` and `src/routes/memory.tsx`.

---

### Step 6 — Cookie / Consent Banner

- `src/components/legal/CookieBanner.tsx` — fixed bottom banner, first visit only. Categories: Necessary (locked on), Preferences, Analytics, AI service logs, Third-party. Buttons: Accept all / Reject non-essential / Manage. "Manage" opens dialog with per-category switches.
- Persist to `localStorage['restpilot.cookie-consent']` (signed-out) and, when signed in, mirror into `user_prefs.consent_json.cookies`.
- Mount in `src/routes/__root.tsx` below `<Outlet />`.
- Link to `/legal/cookies`. Reading helper `src/lib/legal/cookies.ts` exposes `hasConsent(category)` for analytics gating later.

---

### Step 7 — In-Product Safety / Paywall / Offline Disclosures

- Tiny `<SafetyNote to="/safety#driving" />` component in `src/components/legal/SafetyNote.tsx`. Insert into:
  - `SmartAlarmCard.tsx` → `/safety#driving`
  - `RightNowCard.tsx` → `/safety#ai`
  - `CompanionWhisper.tsx` → `/safety#companion`
  - `WearableCard.tsx` → `/safety#devices`
  - `CoachTipCard.tsx` + `AIBriefCard.tsx` → `/safety#ai`
- `src/routes/paywall.tsx` + `src/routes/pricing.tsx` — add `<RenewalDisclosure />`: price, cadence, auto-renew language, cancel anytime via portal, refund policy link to `/legal/subscription`, lifetime caveats.
- `src/components/OfflineBanner.tsx` — extend tooltip with the listed disclosures (outage, sensor inaccuracy, sync delay, notification delay, not an emergency service).

---

### Step 8 — Remaining Legal Appendages

Tighten copy in these existing routes — append sections, don't rewrite:
- `legal.privacy.tsx` — AI provider processing, model/provider swaps, analytics/logging, retention windows, deletion vs retained records, uploads & generated content.
- `legal.acceptable-use.tsx` — prohibited misuse, safety-sensitive misuse.
- `legal.third-parties.tsx` — list AI gateway (Lovable AI), Stripe, Fitbit, Oura, Open-Meteo, BigDataCloud, OpenAI TTS, Gemini, Web Push providers.
- `legal.subscription.tsx` — subscription changes, failed payments, refund/credit limits, lifetime scope.
- `legal.security.tsx` — security limitations, no guarantee of uninterrupted/error-free service.
- `legal.license.tsx` — scope, restrictions, no reverse-engineering, termination.

Bump `LEGAL_EFFECTIVE` in `src/lib/legal/meta.ts`.

---

### Step 9 — In-Product Consistency Sweep + Onboarding Consent

- Grep+rewrite pass on the files listed under "Risky wording found". Replace outcome-promising verbs ("optimize", "fix", "guarantees", "protects") with informational verbs ("suggests", "estimates", "may help").
- Rewrite `src/components/Onboarding.tsx`: add a 4th slide "Before we start" with **required checkboxes**:
  - AI may be inaccurate
  - Not medical advice
  - Not an emergency service — call 911/local emergency
  - Companion mode is optional
  - I'm responsible for safe use
  - Review AI-generated content before relying on it
  
  Submit calls `recordAcceptanceFn({ source: 'onboarding', documents: ['terms','privacy','disclaimers','safety','electronic-consent'] })` before `markOnboarded()`.

---

### Step 10 — Verification Matrix

`docs/legal/verification-matrix.md` — table per document & disclosure: route, user action, backing table/function, test status, residual risk. Used as the QA checklist.

---

### Step 11 — Attorney Pass Package

`docs/legal/attorney-package.md` — index of all legal routes, consent flow, deletion/export flow, Stripe/subscription flow, safety/health/AI risk register, known limitations, open questions for counsel.

---

### Investigation answers (as requested)

- **Files changed**: `src/routes/auth.tsx`, `src/components/Onboarding.tsx`, `src/routes/__root.tsx`, `src/routes/profile.tsx`, `src/routes/memory.tsx`, `src/routes/paywall.tsx`, `src/routes/pricing.tsx`, `src/lib/account.functions.ts`, `src/components/WearableCard.tsx`, `src/components/NotificationsSection.tsx`, `src/components/SmartAlarmCard.tsx`, `src/components/RightNowCard.tsx`, `src/components/CompanionWhisper.tsx`, `src/components/CoachTipCard.tsx`, `src/components/AIBriefCard.tsx`, `src/components/OfflineBanner.tsx`, `src/lib/legal/meta.ts`, 6 `legal.*.tsx` routes, plus new files: `src/lib/legal/consent.functions.ts`, `src/lib/legal/cookies.ts`, `src/components/legal/ConsentModal.tsx`, `src/components/legal/CookieBanner.tsx`, `src/components/legal/SafetyNote.tsx`, `src/components/legal/RenewalDisclosure.tsx`.
- **Migrations**: 1 — create `legal_acceptances` (table + grants + RLS), add `user_prefs.consent_json`.
- **Edge functions**: none. All server-side via `createServerFn`.
- **Stripe impact**: deletion now attempts subscription cancel via `createStripeClient`; failure is non-fatal and disclosed. No webhook or pricing changes.
- **Auth impact**: signup gains a required checkbox; sign-in untouched; OAuth flow unchanged.
- **Deletion/export risk**: deletion becomes broader — must run on test account first. Export bundles redact tokens/endpoints.
- **Testing**: typecheck after each step; Playwright smoke on `/auth` signup, onboarding consent, cookie banner, profile export+delete, wearable connect modal.

Awaiting approval to begin Step 4.