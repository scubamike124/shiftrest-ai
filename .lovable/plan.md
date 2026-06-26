# Final Stripe & Launch Checklist — Plan

## Current status (verified just now)

**Stripe go-live is NOT complete.** The Payments dashboard shows step 1 (claim the Stripe account) is still `in_progress`; steps 2–5 are locked. Until you finish all five steps in the Payments tab, **live checkout does not exist** — only test-mode (sandbox) checkout works. I cannot run real-money tests for you; only you can complete the Stripe onboarding because it requires your business identity, bank account, and 2FA on your Stripe login.

Products in code are correct: `restpilot_monthly` ($7.99/mo, 7-day trial), `restpilot_annual` ($49.99/yr, 7-day trial), `restpilot_lifetime` ($99 one-time). When you complete go-live, Lovable automatically copies these to your live Stripe account and provisions the live webhook — no extra wiring on my side.

## What I will do this turn (code-only, no live Stripe needed)

### 1. Lifetime Membership legal language

Update `src/routes/terms.tsx` to add a dedicated **Lifetime Membership** section using your exact wording: lifetime = lifetime of the *service*, not the *purchaser*; ends if RestPilot AI is discontinued; does not include future separate products unless stated.

Align wording across:
- `src/routes/paywall.tsx` — Lifetime card subcopy ("One-time payment · Lifetime of the service") and fine-print row under the CTA.
- `src/routes/terms.tsx` — new section + update the existing single-line lifetime mention.
- Checkout success copy in `src/routes/profile.tsx` already reads "Lifetime access — thank you for being a Founding Member." — leave as-is; matches.

### 2. Sandbox smoke test (what I can verify without live Stripe)

Drive Playwright against the running preview using Stripe test card `4242 4242 4242 4242` to confirm:
- Monthly checkout opens, completes, webhook fires, `subscriptions` row inserted with `status='trialing'`, Profile shows Premium + trial banner.
- Annual checkout same path.
- Lifetime checkout completes as one-time payment, row inserted with `status='lifetime'`, Profile shows "Lifetime access" and **no** Manage Subscription button.
- Customer Portal opens in a new tab from Profile.
- Cancel-at-period-end via portal updates the row; UI shows "Cancels on …".

I'll capture screenshots and the resulting DB rows so you have evidence.

## What only you can do (in this order)

### 3. Complete Stripe go-live (5 steps in the Payments tab)
1. Claim the sandbox into a new or existing Stripe account (link in Payments tab).
2. Complete Stripe's "Activate your account" wizard (business info, bank account, 2FA).
3. Install the Lovable app on your **live** Stripe account (Stripe will offer "copy from sandbox" — include the Lovable app).
4. Wait ~1 minute for Lovable to auto-provision live API keys and the live webhook.
5. Run the automated readiness check in the Payments tab.

<presentation-actions><presentation-open-payments>Open payments dashboard</presentation-open-payments></presentation-actions>

### 4. Final live-money tests (after step 3 completes)
You'll need to test with a real card (small charge, then refund yourself via Stripe dashboard if desired):
- Monthly purchase → trial active → Premium unlocks → cancel via portal → access until period end → row flips to canceled.
- Annual purchase → trial active → Premium unlocks.
- Lifetime purchase → permanent Premium, no portal management button.
- Trigger a failed-payment scenario in Stripe dashboard → confirm app surfaces `past_due` gracefully.

I'll give you a one-page test script with exact steps and expected DB/UI state before you start.

## 5. Publish

Once your live readiness check is green and you've completed at least the Monthly + Lifetime live tests, I'll publish to `shift-rest-ai.lovable.app` and send the URL for final iPhone Safari testing.

**Do not publish before live go-live is complete** — publishing now would ship a production site whose paywall still routes to sandbox Stripe, so any real customer who tries to subscribe would see test-mode behavior or a configuration error.

## Files this turn

- `src/routes/terms.tsx` — add Lifetime Membership section, refresh updated date.
- `src/routes/paywall.tsx` — tighten Lifetime wording to match terms (one short sentence under the Lifetime CTA).
- `/tmp/browser/stripe-smoke/` — Playwright sandbox test script + screenshots.

## Out of scope

- No schema changes, no new features, no pricing changes, no payment UI redesign.
- Will not touch the Stripe webhook handler — it's already correct.
- Will not publish until you confirm go-live is complete and live tests pass.

Approve to proceed.
