# RestPilot AI — Attorney Review Package

_Prepared: 2026-06-27 — engineer draft, not legal advice._

## 1. Public legal routes

All under `/legal/*` plus `/safety`:

- `/legal` index
- `/legal/terms`
- `/legal/privacy`
- `/legal/cookies`
- `/legal/acceptable-use`
- `/legal/accessibility`
- `/legal/disclaimers` (AI, health, medical, emergency, safety-sensitive)
- `/legal/subscription`
- `/legal/refunds`
- `/legal/third-parties` (subprocessors)
- `/legal/security`
- `/legal/copyright` (DMCA)
- `/legal/trademark`
- `/legal/license` (software license)
- `/legal/open-source`
- `/legal/electronic-consent`
- `/safety` (plain-language Safety Center)

Source of truth: `src/lib/legal/meta.ts`.

## 2. Consent flow summary

1. **Signup (`/auth`)** — required checkbox accepts: Terms, Privacy, AI &
   Health Disclaimers, Safety Center, Electronic Consent.
   Recorded by `recordAcceptanceFn` → `legal_acceptances` table with
   user id, document slug, version (`LEGAL_EFFECTIVE`), source page, IP,
   user-agent.
2. **Onboarding (`<Onboarding>` modal)** — required acknowledgements:
   AI may be inaccurate; not medical advice; not an emergency service
   (call 911); companion mode optional; user responsible for safe use;
   review generated content before relying on it.
   Recorded as doc=`onboarding-ack` + mirrored in
   `user_prefs.consent_json.onboarding_ack`.
3. **Cookie banner** — first visit; accept all / reject non-essential /
   manage per-category (preferences, analytics, AI logs, third-party).
   Stored client-side in `localStorage` (`cookie-consent-v1`).
4. **Wearables & push** — `ConsentModal` component prepared; pending
   wire-up to enable buttons in `WearableCard` and `NotificationsSection`.

## 3. Deletion / export flow summary

- **Delete account** (`/profile`): two confirmations + typed “DELETE”.
  `deleteAccountFn` (server) attempts Stripe cancellation, then deletes
  rows in `shifts, employers, user_prefs, coach_messages, ai_memory,
  ai_recommendations, ai_patterns, ai_feedback, user_events, trips,
  tz_events, push_subscriptions, notification_prefs,
  wearable_connections, wearable_readings, profiles`, then calls
  `auth.admin.deleteUser`. Retains `subscriptions` (canceled) and
  `legal_acceptances` for tax / audit. Returns manifest to client.
- **Export** (`/profile`): `exportAccountFn` returns a JSON file of all
  user-scoped tables + Stripe row + legal acceptances.
- **AI memory purge** (`/profile`, `/memory`): `purgeAiMemoryFn` clears
  `ai_memory`, `ai_recommendations`, `ai_patterns`, `ai_feedback`.

## 4. Stripe / subscription flow summary

- Plans: Monthly $7.99, Annual $49.99, Lifetime $99.
- Checkout: Stripe Embedded Checkout (`createCheckoutSession`).
- Renewals: webhook writes `subscriptions` row; `subscription-state`
  query gates Premium gating.
- Cancellation: via Stripe Billing Portal (`createPortalSession`).
- Refunds: governed by `/legal/refunds`; lifetime is non-refundable
  after 14 days per current policy draft.
- Renewal disclosure surfaced on paywall via `RenewalDisclosure`.

## 5. Safety / Health / AI risk summary

- AI outputs are advisory; product is not a medical device, not a
  diagnostic tool, not an emergency service.
- Card-level `SafetyNote` links: Right Now, Smart Alarm, Companion
  Whisper, AI Brief, Long Clock, Wearable Card.
- Offline banner discloses sensor inaccuracy and that notifications may
  be delayed or blocked.
- Driving / safety-sensitive disclaimer in `/legal/disclaimers`.
- Onboarding requires explicit acknowledgement before first meaningful
  use.

## 6. Known limitations / TODO before launch

- Wire `ConsentModal` into wearable and push connect flows.
- Global wording sweep to remove guarantee-style language from UI
  strings (e.g. “ensures”, “guarantees”, “will keep you safe”).
- Server-side mirror of cookie consent for legal proof.
- Regional copy adjustments (EU/UK/CA cancellation, AU consumer law).
- Designated DMCA agent registration.
- Children: enforce 16+ at signup (currently self-declared).
- Pen-test report and SOC posture summary for `/legal/security`.

## 7. Questions for attorney

1. Is the lifetime “lifetime of the service” framing defensible in our
   primary jurisdictions?
2. Are our refund windows (Monthly: none after charge; Annual: 14-day;
   Lifetime: 14-day) compliant with EU 14-day right of withdrawal
   given immediate digital delivery and the consumer waiver?
3. Are our health disclaimers strong enough to keep RestPilot out of
   regulated “medical device” scope (FDA SaMD, EU MDR)?
4. Is our AI-output disclaimer sufficient to disclaim reliance for
   safety-sensitive professions (commercial drivers, pilots, surgeons,
   first responders)?
5. Is our consent record (user id + doc slug + version + IP + UA +
   timestamp + source) sufficient evidence under E-SIGN / UETA / eIDAS?
6. Are the retained categories on account deletion (canceled Stripe
   subscription rows, legal acceptances) adequately disclosed in the
   Privacy Policy?
7. Cookie banner: does our reject-all-by-default behavior satisfy
   GDPR / ePrivacy explicit-consent requirements?
8. Do we need a separate California Notice at Collection and a
   “Do Not Sell or Share” page given current data flows?
