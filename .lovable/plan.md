# Stripe Web Billing — Investigation & Plan

## Recommended approach: Lovable's built-in Stripe Payments

Lovable has a built-in Stripe integration (`enable_stripe_payments`) that requires **no Stripe account setup, no API key entry, and no webhook configuration on your end**. Lovable manages the Stripe account, keys, webhooks, and Customer Portal wiring. A test (sandbox) environment is created instantly; going live requires a short verification step.

This is strongly preferred over bring-your-own-key (BYOK) Stripe. The rest of this plan assumes built-in Stripe Payments. If you insist on BYOK, the same architecture applies — only the setup and secret management differ.

Note on tax: as part of setup, Stripe will be configured with full compliance handling (Stripe handles tax calc, collection, filing, disputes, transactional support for ~80 countries at +3.5% per transaction). Adjustable per-transaction later.

---

## 1. Stripe products & prices

Three products, each with one price:

| Product | Price ID purpose | Type | Amount | Trial |
|---|---|---|---|---|
| RestPilot Monthly | `price_monthly` | recurring, 1 month | $7.99 USD | 7-day free trial |
| RestPilot Annual | `price_annual` | recurring, 1 year | $49.99 USD | 7-day free trial |
| RestPilot Lifetime Founder | `price_lifetime` | one-time | $99.00 USD | none |

Trial is applied via `subscription_data.trial_period_days: 7` on the Checkout session for the two recurring plans only.

## 2. Environment variables

With built-in Stripe Payments, Lovable injects everything automatically (publishable key, secret key, webhook secret, price IDs via the product catalog tool). No env vars to manage manually.

For reference, behind the scenes the following are populated:
- `STRIPE_SECRET_KEY` (Lovable-managed)
- `STRIPE_WEBHOOK_SECRET` (Lovable-managed)
- `STRIPE_PUBLISHABLE_KEY` (Lovable-managed, used client-side if needed)

## 3. Database changes (`profiles` table)

Add Stripe-specific columns; keep existing `subscription_tier`, `trial_ends_at`, `subscription_expires_at`. Drop the unused `revenuecat_user_id` column.

New columns on `public.profiles`:
- `stripe_customer_id text` — links the user to their Stripe customer.
- `stripe_subscription_id text` — current active subscription (null for lifetime or free).
- `subscription_status text` — mirror of Stripe status: `trialing`, `active`, `past_due`, `canceled`, `unpaid`, `incomplete`, `incomplete_expired`, or `lifetime`.
- `cancel_at_period_end boolean default false`.
- Index on `stripe_customer_id` for fast webhook lookup.

`isPremium` becomes: `tier === "lifetime"` OR `status IN ('trialing','active')` (no manual expiry math needed — Stripe is source of truth).

Writes to subscription fields happen **only** in the webhook handler using `supabaseAdmin` (service role). RLS stays read-only-self for the user.

## 4. Webhook event plan

One route: `src/routes/api/public/stripe-webhook.ts` (POST). Signature-verified using `stripe.webhooks.constructEvent` with the raw body and webhook secret.

| Event | Action |
|---|---|
| `checkout.session.completed` | If `mode=subscription`: store `stripe_customer_id`, `stripe_subscription_id`, set tier (monthly/annual), status `trialing` or `active`. If `mode=payment` (lifetime): set tier `lifetime`, status `lifetime`, store customer id. |
| `customer.subscription.created` | Backfill/confirm fields (defensive). |
| `customer.subscription.updated` | Update status, `cancel_at_period_end`, `subscription_expires_at` = `current_period_end`. |
| `customer.subscription.deleted` | Set status `canceled`, tier `free`, clear `stripe_subscription_id`. |
| `invoice.payment_failed` | Set status `past_due`. |
| `invoice.payment_succeeded` | Refresh `subscription_expires_at` = `current_period_end`, status `active`. |

User-to-customer mapping: the Checkout session is created server-side with `client_reference_id = auth.uid()` and `metadata.user_id`. Webhook reads metadata for the first event, then uses `stripe_customer_id` for subsequent events.

## 5. Server functions (TanStack `createServerFn`)

New file `src/lib/billing.functions.ts`:
- `createCheckoutSession({ plan: 'monthly'|'annual'|'lifetime' })` — auth-protected, returns Checkout URL. Adds 7-day trial for recurring plans. Success URL: `/profile?checkout=success`. Cancel URL: `/paywall`.
- `createPortalSession()` — auth-protected, returns Customer Portal URL for managing/canceling subscription.

## 6. Files requiring changes

**New**
- `src/lib/billing.functions.ts` — Checkout + Portal server fns.
- `src/routes/api/public/stripe-webhook.ts` — webhook receiver.
- Migration: profile column changes.

**Modified**
- `src/routes/paywall.tsx` — wire CTAs to `createCheckoutSession`; default-select Annual; new copy ("No charge today • Cancel anytime before your trial ends"); rename Lifetime CTA to "Become a Founding Member"; rename badge to "Founding Member — Limited Time"; optional Stripe/Visa/Mastercard trust row.
- `src/lib/subscription.ts` — read new fields; remove mock `startTrial`; replace `restorePurchases` with a server-fn that re-syncs from Stripe.
- `src/routes/profile.tsx` — replace "Restore purchases" with **Manage Subscription** button → opens Customer Portal. Handle `?checkout=success` toast.

**Untouched**
- All iOS / native / RevenueCat / App Store references. (Nothing in the codebase actually wires to RevenueCat; the `revenuecat_user_id` column will be dropped because it's dead.)

## 7. Security risks & mitigations

- **Webhook spoofing** → verify Stripe signature with raw body before any DB write.
- **Trial abuse** (same card, multiple accounts) → enable Stripe's built-in "block multiple trials per customer" in Checkout settings.
- **Privilege escalation via client writes** → all subscription columns updated only via service-role webhook; RLS prevents user UPDATE on those fields (tighten the existing update policy with a column allowlist via a trigger that rejects changes to subscription_* from non-service roles).
- **Replay attacks** → store processed `event.id` in a small `stripe_events` table; ignore duplicates.
- **Lost webhooks** → on app load, a lightweight `syncSubscription` server fn calls Stripe to refresh state if `subscription_status` is stale.
- **PII** → never log full Stripe payloads; log event id + type only.

## 8. Test checklist

- [ ] Monthly checkout → trial starts, `status=trialing`, premium unlocked instantly.
- [ ] Annual checkout → trial starts, premium unlocked.
- [ ] Lifetime checkout → one-time charge, `tier=lifetime`, permanent premium.
- [ ] Cancel during trial via Portal → premium remains until trial end, then revoked.
- [ ] Cancel active sub → premium remains until period end (cancel_at_period_end), then revoked.
- [ ] Failed payment → `past_due` → premium revoked after Stripe's dunning window.
- [ ] Webhook signature with bad secret → 401, no DB write.
- [ ] Duplicate webhook delivery → idempotent.
- [ ] Annual is pre-selected on paywall.
- [ ] Lifetime CTA reads "Become a Founding Member" and badge reads "Founding Member — Limited Time".
- [ ] Trial copy renders under Monthly/Annual CTAs only (not Lifetime).
- [ ] Signed-out user clicking a plan → routed to `/auth` then back to checkout.
- [ ] `Manage Subscription` opens Portal for users with `stripe_customer_id`.

## 9. Effort estimate

~3–4 hours of implementation once approved:
- 30 min: enable built-in Stripe Payments + create the 3 products/prices.
- 45 min: DB migration + subscription.ts refactor.
- 60 min: Checkout + Portal server fns + webhook route.
- 45 min: paywall + profile UI changes and copy.
- 30 min: end-to-end test in Stripe test mode.

---

## Decision needed before I build

1. **Confirm I should enable Lovable's built-in Stripe Payments** (recommended — no account or keys needed from you). If you'd rather connect your own Stripe account with your own API key, say so explicitly.
2. **Confirm I can drop the unused `revenuecat_user_id` column** (nothing in the code references it).
3. **Trust logos**: OK to add a small "Powered by Stripe • Visa • Mastercard • Amex" row under the CTA? (Stripe's brand guidelines allow this for Checkout-powered apps.)
