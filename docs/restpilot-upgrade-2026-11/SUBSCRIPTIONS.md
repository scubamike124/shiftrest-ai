# RestPilot subscriptions: Stripe on the web, Apple In-App Purchase in the iOS app

Priority 8 of the November 14, 2026 master authorization. Status: **prepared, not activated.**
Every new path is behind a flag that defaults to off. No payment service, product, key or
paid plan was created or enabled.

Fixed prices: **Monthly $7.99**, **Annual $49.99**, each with a **14-day free trial**.
Lifetime is discontinued for new customers (PR #9). Existing lifetime members stay entitled.

---

## 1. Summary

| Question | Answer |
|---|---|
| Website | Keep Stripe. The checkout code path is unchanged. A new regression test pins the exact Stripe requests that monthly, annual and the 14-day trial send. |
| iOS app | Sell the same two plans through Apple In-App Purchase (StoreKit), using **RevenueCat** (Capacitor plugin plus webhook). The app never shows Stripe checkout. |
| Links out of the app | Off. One flag allows them on the **US storefront only**, and only next to IAP. Every other storefront gets no link and no call to action. |
| One source of truth | One merged **entitlement** per user, built from Stripe rows (`subscriptions`) and App Store rows (`store_entitlements`). |
| Double billing | If a user is subscribed through any channel, they see their status and how to manage it, never a buy button. A user with two renewing subscriptions sees a warning. |
| Existing subscribers | Nothing migrates. Stripe subscribers stay on Stripe and are recognized in the app. |

**Important finding: the website's Stripe system is not running on the migration branch.**
The owner's working Stripe checkout is production `main` (Lovable). On
`codex/restpilot-railway-migration`, commits `23bccdd` and `1b81e6f` disabled Stripe at the server
adapter (`src/lib/stripe.server.ts` throws). They also removed the browser checkout and replaced
`/pricing` and `/paywall` with the "App preview" screen. Production calls Stripe through Lovable's
connector gateway (`connector-gateway.lovable.dev`, `LOVABLE_API_KEY` plus Lovable connection keys).
That gateway does not exist on Railway.

**Moving `restpilotai.com` to Railway as-is would switch off the owner's working website
checkout.** Restoring it needs a direct Stripe secret key (owner-only, section 7, step 10) and a
restore of the web checkout UI. This PR does not do either: re-enabling payments needs explicit
owner authorization, and the decision belongs to the cutover owner. The server-side checkout
handler is still in source and is now regression-locked, so a restore would send Stripe exactly
what it sent before.

### Which code the iOS app actually runs (November 15, 2026)

The app shell (`ios-app/capacitor.config.json`, bundle `com.restpilotai.app`) loads
**`https://restpilotai.com/`**. Today that is production on Lovable, built from `main`, not this
branch.

- **Production `main`, served in the app today.** `/paywall` embeds **Stripe Embedded Checkout**,
  and `/pricing` links to it. `main` has no native-app gating, so **inside the app a user can open
  Stripe checkout and pay.** Everything in this document (the app-aware paywall, IAP, the
  entitlement merge) is on `codex/restpilot-railway-migration`. That code reaches the app only when
  restpilotai.com is cut over to Railway, or when the shell points at a Railway host.
- **Railway branch (staging).** Stripe is disabled. `/pricing` and `/paywall` show the "App
  preview" screen with no purchase UI. With the IAP flags off (the default), the app shows the
  same screen.

What this means for the White Glove test:
1. **Private White Glove test with the shell pointing at production.** Testers can reach a working
   Stripe checkout inside the app. Payments would be real (live mode) and would bypass Apple. That
   is acceptable only if testers are told not to buy. Owner and native-agent decision.
2. **Safer for the test.** Point the shell's `server.url` at the Railway staging host for the test
   build: no purchase UI anywhere, and the App Review 3.1.1 rules are met by having no purchase at
   all. This is a native-agent change; the cutover agent must then add that origin to Supabase
   redirect URLs.
3. **App Store submission (TestFlight external, or review).** Do not submit a build whose
   `server.url` serves production `main` as it is: an in-app Stripe checkout for a digital
   subscription violates Guideline 3.1.1 outside the US-link exception. Submit only once the
   served host runs this branch: the preview screen with IAP off, or IAP with the flags on after
   the owner setup in section 7.
4. **Production `main` is unchanged on purpose.** The owner said the existing Lovable Stripe
   checkout must not be modified or replaced. No gating is ported to `main`.

**Existing lifetime purchasers.** The `status = 'lifetime'` rows are active premium:
- in the merged entitlement;
- on every paywall surface (status shown, no buy button);
- in the voice gate;
- in the SQL `has_active_subscription` (the AI budget).

These are covered by the `lifetime:` tests in `tests/subscription-lifecycle.test.mjs` and by the
PGlite check.

---

## 2. Apple's current rules, researched November 14, 2026

Primary sources are Apple's own pages. Secondary sources are used only where Apple has not
published the information.

### 2.1 The default rule, for every storefront

- **3.1.1 In-App Purchase.** "If you want to unlock features or functionality within your app, (by
  way of example: subscriptions, …) you must use in-app purchase." RestPilot Premium (AI coach,
  voice, plans) is a digital subscription. In the app it must be sold with IAP.
  [App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/), current
  revision, last updated October 16, 2026
  ([Apple news, Oct 16 2026](https://developer.apple.com/news/?id=92th7e5i)).
- **3.1.2(a) Subscriptions.** A subscription "must work on all of the user's devices where the app
  is available." "Auto-renewable subscription apps may offer a free trial period … by providing the
  relevant information set forth in App Store Connect." The 14-day trial is an App Store Connect
  introductory offer: the free-trial lengths include "1 or 2 Weeks", and each person gets "one
  introductory offer per subscription group"
  ([App Store Connect Help](https://developer.apple.com/help/app-store-connect/manage-subscriptions/set-up-introductory-offers-for-auto-renewable-subscriptions)).
- **3.1.3(b) Multiplatform Services.** Apps "may allow users to access content, subscriptions, or
  features they have acquired … on other platforms or your web site … provided those items are
  also available as in-app purchases within the app." **This lets a website (Stripe) subscriber use
  the app, as long as IAP is offered in the app too.**
- **3.1.3 intro.** Apps "cannot, within the app, encourage users to use a purchasing method other
  than in-app purchase, except for apps on the United States storefront and as set forth in
  3.1.1(a) and 3.1.3(a)." RestPilot is not a "Reader" app under 3.1.3(a), so that exception does
  not apply.

### 2.2 United States storefront: the 2025 court ruling

- **May 1, 2025.** Apple changed Guidelines 3.1.1, 3.1.1(a), 3.1.3 and 3.1.3(a) "for compliance with
  a United States court decision regarding buttons, external links, and other calls to action in
  apps" ([Apple news, May 1 2025](https://developer.apple.com/news/?id=9txfddzf)).
- **Current text.** Entitlements "are not required for developers to include buttons, external
  links, or other calls to action in their United States storefront apps", and the link prohibition
  applies "in all other storefronts, except for the United States storefront"
  ([Guidelines 3.1.1(a)](https://developer.apple.com/app-store/review/guidelines/#link-to-other-purchase-methods)).
- **Litigation status.** Apple's FY2026 Form 10-K (fiscal year ended September 26, 2026), Item 3,
  says the Ninth Circuit upheld the 2025 injunction in part, held that Apple "can charge some
  commission on link-out purchases", and sent the case back to the district court. It also says
  Apple petitioned the Supreme Court on May 21, 2026, and the Court "granted the Company's petition
  to review the applicable legal standard for civil contempt"
  ([Apple 10-K FY2026](https://www.sec.gov/Archives/edgar/data/0000320193/000032019326000026/aapl-20260926.htm)).
  - Secondary reports say the Ninth Circuit ruled in December 2025 and allowed Apple to require
    parity in the size, form and placement of links and buttons
    ([Fenwick](https://www.fenwick.com/insights/publications/ninth-circuit-largely-upholds-ruling-in-epic-v-apple)).
  - In August 2026 Apple proposed link-out commissions of 15%, or 5% under the Small Business
    Program. These are not in effect
    ([9to5Mac, Aug 13 2026](https://9to5mac.com/2026/08/13/apple-proposes-commissions-of-up-to-15-for-off-app-store-purchases-in-the-us/)).
- **What this means for RestPilot.** US links are allowed today, but the commission and placement
  terms are still being litigated and could change on short notice. They are worth little to us:
  the in-app paywall must offer IAP anyway (3.1.3(b)), and an external link adds review risk and
  a second purchase path to support. **Decision: off by default.** `VITE_IAP_US_EXTERNAL_LINK`
  enables a link only when StoreKit reports the US storefront, and only next to IAP. Before turning
  it on, re-check the guidelines and the case status.

### 2.3 European Union, Japan and other storefronts

- **EU (Digital Markets Act).** From **October 1, 2026**, EU apps may combine IAP with alternative
  payment processing or out-of-app offers. Both require the *StoreKit External Purchases or Offers
  Entitlement*, iOS 26.2 or later, the disclosure sheet, monthly reporting, and a choice that stays
  locked for 12 months across all EU storefronts. Commissions:
  - IAP: 26%, or 15% reduced;
  - alternative processing: 20%, or 10% reduced;
  - out-of-app offers: 15%, or 10% reduced, on sales within 7 days of the link tap.

  ([Apple: Apps using alternative payment providers in the EU](https://developer.apple.com/support/apps-using-alternative-payment-providers-in-the-eu/),
  current page; license agreement updated August 18, 2026.)
  **Not worth it for RestPilot.** The saving over IAP is small, and the compliance and reporting
  work is substantial. The EU gets IAP only, with no links.
- **Japan (Mobile Software Competition Act).** Since iOS 26.2 (announced December 17, 2025), apps
  may offer alternative payments and web links, alongside IAP. Web-linked sales carry a 15%
  commission (10% reduced)
  ([Apple newsroom, Dec 2025](https://www.apple.com/newsroom/2025/12/apple-announces-changes-to-ios-in-japan/);
  [Apple: Changes to iOS in Japan](https://developer.apple.com/support/app-distribution-in-japan/)).
  Japan gets IAP only, with no links.
- **All other storefronts.** Guideline 3.1.1(a) allows link entitlements in "specific regions" only.
  Everywhere else "apps and their metadata may not include buttons, external links, or other calls
  to action that direct customers to purchasing mechanisms other than in-app purchase." Those
  storefronts get IAP only, with no links.

### 2.4 How the code applies these rules

`src/lib/entitlements/paywall-policy.ts` holds the decision table. The tests are in
`tests/paywall-policy.test.mjs`.

| Surface | Not subscribed | Subscribed via Stripe | Subscribed via Apple |
|---|---|---|---|
| Website | Stripe checkout if configured (unchanged) | Stripe billing portal | "Billed by Apple", plus a link to Apple's subscription page |
| iOS, US storefront, link flag on | IAP, plus an optional "Subscribe on restpilotai.com" link | Status, plus a link to the website account page | Status and App Store manage |
| iOS, any other case (flag off, non-US, or unknown storefront) | IAP only | Status, plus **plain text** that it is managed on the website (no link) | Status and App Store manage |
| iOS, IAP not configured | "Purchases are not available in this version" | as above | as above |
| Android shell | Nothing to buy, no links (no Play Billing) | as above | as above |
| Status unknown (loading or error) | **No buy button** | – | – |

An unknown storefront counts as non-US. The plugin version that matches the current Capacitor 6
shell (`@revenuecat/purchases-capacitor@9.2.2`) has no `getStorefront`, so US links cannot appear
until the shell is upgraded. Stripe checkout is never offered inside the app.

---

## 3. Architecture decision: RevenueCat or a raw StoreKit plugin

### What each option involves

**RevenueCat** (chosen)
- Install `@revenuecat/purchases-capacitor` in `ios-app/`.
- Purchases, receipt and transaction validation, renewals, grace periods, billing retry, refunds,
  family sharing, restore and cross-account transfer are handled for us.
- One webhook. Our server re-fetches `GET /v1/subscribers/{id}` (RevenueCat's own recommendation)
  and stores a snapshot.
- Sandbox and App Review purchases work with no extra code.

**Raw StoreKit 2**, through a community Capacitor plugin or our own Swift plugin
- Native purchase code, a `Transaction.updates` listener, `AppStore.sync()` for restore, and an
  `appAccountToken` to map purchases to users.
- Server side:
  - App Store Server Notifications V2, with JWS signature verification against Apple's root
    certificate chain;
  - App Store Server API calls signed with a JWT from an in-app purchase key;
  - our own state machine for renewal, grace, billing retry, refund, revocation and upgrade or
    downgrade within the subscription group;
  - sandbox and production environment routing.

### Cost

RevenueCat's current price: "Pay nothing for up to $2,500 in monthly tracked revenue", then "1% of
what you track" ([pricing](https://www.revenuecat.com/pricing/)). Once over $2,500, the 1% applies
to **all** MTR, not only the excess ("if you earned $2,600 in MTR … a charge of $26"). MTR is gross
revenue before Apple's commission and taxes
([billing docs](https://www.revenuecat.com/docs/welcome/set-up-revenuecat/account-management)).
Webhooks and every SDK are included in the self-serve plan. **We do not connect Stripe to
RevenueCat**, so website revenue is never billed by RevenueCat.

The table estimates MTR per App Store subscriber per month:
- all-monthly: $7.99;
- 50/50 blend: $6.08, averaging annual plans at $49.99 ÷ 12.

Annual renewals arrive as monthly spikes, but the yearly total is the same.

| App Store subscribers | MTR (blend / all-monthly) | RevenueCat fee per month (blend / all-monthly) | Per year (blend) | For scale: Apple's 15% Small Business rate (blend) |
|---|---|---|---|---|
| 100 | $608 / $799 | **$0 / $0** (under $2,500) | $0 | $91 per month |
| 1,000 | $6,078 / $7,990 | **$60.78 / $79.90** | ≈ $729 | $912 per month |
| 10,000 | $60,783 / $79,900 | **$607.83 / $799.00** | ≈ $7,294 | $9,117 per month |

The free tier covers roughly the first 300 to 400 App Store subscribers.

### Decision

**Use RevenueCat.**
- It costs nothing until about 400 App Store subscribers.
- At 1,000 subscribers it costs about $60 to $80 a month. That is much less than building,
  securing and maintaining the server-side App Store verification and state machine, where
  mistakes either grant free access or wrongly cut off paying users.
- It is proven, supports Capacitor, and already handles sandbox and App Review.

**Exit path.**
- RevenueCat is used through only two seams:
  - the Capacitor plugin calls in `iap-bridge.ts`;
  - the snapshot fetch in `store-sync.server.ts`.
- Entitlements live in our own `store_entitlements` table.
- Above about 10,000 subscribers (about $600 to $800 a month), re-evaluate a direct App Store
  Server Notifications V2 integration. That would replace those two files without changing the
  entitlement model, the paywall or the gates.

---

## 4. Entitlement model

### Stripe channel: unchanged

- Rows in `public.subscriptions`, written only by the signed Stripe webhook. That webhook re-fetches
  Stripe state and uses the revisioned atomic `apply_subscription_snapshot` from the November 13
  repair.
- A row grants access when it is:
  - `lifetime`; or
  - `active` or `trialing` with a future period end; or
  - `canceled` but paid through a future date.

  These are the same rules as the voice gate. `past_due`, `unpaid`, `incomplete` and `paused` grant
  nothing.

### Apple channel: new

`public.store_entitlements` holds one row per (user, App Store environment).

How rows are written:
- Writes go only through the service-role function `apply_store_entitlement(jsonb)`.
- Its upsert condition `where snapshot_at <= excluded.snapshot_at` means an older snapshot can never
  overwrite a newer one. Replays and concurrent deliveries are therefore harmless. This was verified
  in PGlite, including 20 shuffled concurrent writes.
- Rows are built from RevenueCat's canonical subscriber record, never from a webhook payload:
  - App Store products `restpilot_monthly` and `restpilot_annual` only;
  - refunded purchases grant nothing;
  - an environment with no subscription writes an empty snapshot, which clears access after a
    restore moves the purchase to another account.
- Users can read their own rows (RLS). Clients cannot write rows or call the function. Rows cascade
  on account deletion.

Two writers:
1. `POST /api/public/iap/revenuecat`. The webhook:
   - returns 404 unless `IAP_ENABLED=true`;
   - returns 503 without secrets;
   - checks the HMAC-SHA256 `X-RevenueCat-Webhook-Signature` over `t.rawBody`, with a 5-minute
     window and a constant-time compare;
   - checks the optional `Authorization` header value;
   - caps the body at 64 KB;
   - is idempotent through `store_webhook_events` (event ID);
   - for each affected user (purchaser, aliases, and both sides of a `TRANSFER`, Supabase UUIDs
     only, capped at 10), fetches the subscriber and applies the snapshot;
   - returns 500 on any failure, so RevenueCat retries 5 times over about 80 minutes. The event is
     recorded only after success.
2. `syncMyStoreEntitlement`. This authenticated server function runs after a purchase or Restore.
   The user ID comes from the verified Supabase session only. It is throttled to once per 10
   seconds per user on each instance.

### Merge

`mergeEntitlements` in `src/lib/entitlements/merge.ts` produces one `Entitlement`:
- `{active, source, plan, state, expiresAt, willRenew, channels[], hasStripe, hasApple, duplicateBilling}`.
- Ranking: lifetime, then paid and renewing, then paid grace, then trial. Ties go to the later
  expiry, then to Stripe.
- `duplicateBilling` is true when two or more channels will renew.
- Stripe rows count only for this deployment's Stripe environment. If none is configured, as on the
  Railway build, **live** rows count, so a paying website customer is never offered an App Store
  subscription.
- Apple rows count only when `IAP_ENABLED=true`, and only production purchases by default.
  Sandbox purchases (App Review, TestFlight, sandbox testers) count only with
  `IAP_HONOR_SANDBOX=true`. App Review buys in the sandbox against the production server, so turn
  it on while a build is in review. Left on in production, it gives every TestFlight tester free
  Premium.
- `getEntitlementStatus` returns the merged entitlement and fails closed: an unreadable status
  becomes an error, never a buy button.

### Gates

- With the flag on, the voice gate (`src/lib/realtime/trial-usage.functions.ts`) includes App Store
  rows. A paid Apple subscriber counts as paid, and an Apple trial is metered like a Stripe trial.
- With the flag off, App Store rows are never read.
- Tests: `tests/iap-voice-gate.test.mjs`.

---

## 5. Double billing, restore, cancel and existing customers

### Preventing double billing

- Any active channel shows status and that channel's manage path, never a buy button.
- The app re-checks status on the server **immediately before** opening the App Store sheet.
- The App Store subscription group contains only Monthly and Annual, so Apple itself prevents two
  concurrent App Store subscriptions. Monthly to annual is an in-group upgrade.
- On the website, App Store subscribers see their status and "Manage in App Store", not Stripe
  checkout. The policy returns this already; the website UI uses it once web checkout is restored
  (follow-up F2).
- **Server-side guard.** `createCheckoutSession` refuses to create a Stripe checkout session for a
  user with an active App Store subscription, and makes no Stripe call. If the App Store status
  cannot be read, it also refuses. The guard lives in `src/lib/entitlements/checkout-guard.ts` and
  runs only when `IAP_ENABLED=true`, so with IAP off the requests sent to Stripe are unchanged.
  When the migration agent restores web checkout on Railway, keep these four lines in
  `billing.functions.ts`.
- A user who still ends up with two renewing subscriptions sees: "You have more than one renewing
  RestPilot subscription. Cancel one of them below so you are not charged twice." Both manage paths
  are shown.
- **Trial overlap (accepted risk).** Apple decides intro-offer eligibility per Apple Account. A
  former Stripe trial user could get one Apple trial. The paywall is hidden for active subscribers,
  so this only affects lapsed users.

### Restore

- **iOS.** The "Restore purchases" button calls RevenueCat `restorePurchases()`, then the server
  sync, then shows the merged status. With RevenueCat's default "transfer to new App User ID"
  behaviour, restoring on a different RestPilot account moves the entitlement. The webhook refreshes
  both accounts, so the old account loses access.
- **Transfer timing.** A restore syncs only the signed-in user. The previous account loses access
  through the `TRANSFER` webhook, which refreshes both accounts. If webhooks are misconfigured, the
  old account keeps access until its stored expiry, at most one period, and nobody is charged twice.
  The F4 reconcile job closes this gap.
- **Web.** Stripe subscribers are recognized from the database. There is nothing to restore.

### Cancel

- **Apple.** "Manage subscription" opens `customerInfo.managementURL`, or
  `https://apps.apple.com/account/subscriptions`, or the user goes to Settings, then their name,
  then Subscriptions. Apple must cancel; we cannot.
- **Stripe.** Use the existing billing portal on the website. In the app this is plain text, or a
  link on the US storefront with the flag on.
- **Account deletion** does not cancel an Apple subscription. Apple's
  [account-deletion guidance](https://developer.apple.com/support/offering-account-deletion-in-your-app/)
  expects the app to explain that billing continues through Apple until the user cancels.

### Existing customers

- Nothing migrates.
- Stripe monthly and annual subscribers keep renewing on Stripe at their current price.
- Lifetime members stay `lifetime`.
- In the app they appear as Premium, "billed through the RestPilot website", with no buy button.
- Nobody is moved to Apple, and no Stripe subscription is touched.

---

## 6. What was built (all inert by default)

### Flags

| Flag | Default | Effect |
|---|---|---|
| `VITE_IAP_ENABLED` | `false` | Shows the in-app subscription screen on `/paywall`, inside the native app only |
| `VITE_REVENUECAT_IOS_API_KEY` | empty | Public Apple SDK key (`appl_…`). IAP stays unavailable without it. |
| `VITE_IAP_US_EXTERNAL_LINK` | `false` | US-storefront link to website purchase and billing (section 2.2) |
| `IAP_ENABLED` | `false` | Server: webhook, restore sync, Apple rows in status and in the voice gate |
| `IAP_HONOR_SANDBOX` | `false` | Server: also honor Apple sandbox purchases (App Review, TestFlight). Turn on in staging and while a build is in review. |
| `REVENUECAT_SECRET_API_KEY`, `REVENUECAT_WEBHOOK_SECRET`, `REVENUECAT_WEBHOOK_AUTHORIZATION` | empty | Secrets, set in Railway only |

### Files

| File | Purpose |
|---|---|
| `src/lib/entitlements/merge.ts` | Pure merge logic, plus the adapter used by the voice gate |
| `src/lib/entitlements/paywall-policy.ts` | Pure surface and storefront decision table |
| `src/lib/entitlements/revenuecat.ts` | Pure: product catalog, subscriber-to-snapshot conversion, affected users, packages |
| `src/lib/entitlements/store-sync.server.ts` | Signature check, webhook handler and sync |
| `src/lib/entitlements/store-db.server.ts` | Service-role database wiring |
| `src/lib/entitlements/checkout-guard.ts` | Website checkout refuses App Store subscribers (only with `IAP_ENABLED=true`); called from `billing.functions.ts` |
| `src/routes/api/public/iap/revenuecat.ts` | Webhook route |
| `src/lib/entitlements/entitlement.functions.ts` | `getEntitlementStatus` and `syncMyStoreEntitlement` |
| `src/lib/entitlements/iap-bridge.ts` | Calls the native plugin through Capacitor's injected `nativePromise`; adds no web dependency |
| `src/components/subscription/AppAwarePaywall.tsx` | Chooses the screen. Renders the existing `AppPreviewAccess` unless the flag is on inside the app. |
| `src/components/subscription/NativeSubscription.tsx` | Status, StoreKit-priced plans, Apple renewal disclosure and legal links, Restore, Manage |
| `supabase/migrations/20261114120000_store_entitlements.sql` | Additive migration |
| `scripts/qa/verify-store-entitlements.mjs` | Checks the migration in PGlite |
| `src/lib/realtime/trial-usage.functions.ts` | Apple rows in the voice gate, flag-gated |

### Tests

| Test file | What it covers |
|---|---|
| `tests/entitlement-merge.test.mjs` | Merge rules |
| `tests/paywall-policy.test.mjs` | Every surface and storefront |
| `tests/revenuecat-sync.test.mjs` | Snapshot parsing; webhook signature, idempotency, retry, transfer and size limits |
| `tests/iap-voice-gate.test.mjs` | Voice gate, flag off and on |
| `tests/app-aware-paywall.test.mjs` | The website screen is unchanged, flags are off, and the app screen cannot reach Stripe |
| `tests/subscription-lifecycle.test.mjs` | Restore, cancellation and duplicate prevention end to end (section 6a) |
| `tests/stripe-checkout-regression.test.mjs` | Pins the exact Stripe requests (below) |

**Website Stripe regression lock.** For `restpilot_monthly` and `restpilot_annual`, the test pins
the exact Stripe calls:
1. `prices.list({lookup_keys:[plan], active:true})`;
2. customer search by `metadata['userId']`;
3. customer creation, or reuse of the owned customer;
4. the exact `checkout.sessions.create` payload: subscription mode, embedded page, `return_url`,
   `metadata`, and `subscription_data.trial_period_days: 14`.

It passes on this branch and on the lifetime-removal branch. Against production `main`, the
**checkout session payload is identical**. The only differences are in the earlier lookups, both
from the November 13 security repair: the `active: true` price filter, and no longer adopting a
customer by email address.

### Native step, for the iOS shell owner

This PR does not edit `ios-app/`, which is owned by the native agent. To make IAP functional:

```sh
cd ios-app
npm install @revenuecat/purchases-capacitor@9.2.2   # last line compatible with Capacitor 6 (peer @capacitor/core ^6)
npx cap sync ios                                     # adds the PurchasesHybridCommon pod (iOS 13+)
```

Then, in Xcode, enable the **In-App Purchase** capability for target `App`. The web code finds the
plugin by name ("Purchases") through `window.Capacitor.PluginHeaders`. Without the plugin, IAP
stays unavailable and the screen says purchases are not available.

After upgrading the shell to Capacitor 8, move to `@revenuecat/purchases-capacitor` 12 or later.
That adds `getStorefront`, which the US-link rule needs.

---

## 6a. Verification

All checks below run in `node --test tests/*.test.mjs` with provider and database IO mocked; there
are no network calls. RevenueCat webhooks use
[RevenueCat's documented body](https://www.revenuecat.com/docs/integrations/webhooks/event-types-and-fields):

```
{api_version, event: {id, type, event_timestamp_ms, app_id, app_user_id, original_app_user_id,
aliases, product_id, period_type, expiration_at_ms, environment, store, cancel_reason or
expiration_reason}}
```

A `TRANSFER` event carries `transferred_from` and `transferred_to` instead. Every fixture is signed
the way RevenueCat signs deliveries: `X-RevenueCat-Webhook-Signature: t=<unix>,v1=<hex
HMAC-SHA256("<t>.<raw body>")>`. Canonical state comes from a mocked `GET /v1/subscribers/{id}` in
RevenueCat's documented response shape.

### (a) Restore (`tests/subscription-lifecycle.test.mjs`, tests prefixed "(a) restore")

| Requirement | Test |
|---|---|
| A restore syncs the signed-in user's Apple entitlement, and the merged status shows it | `(a) restore: the signed-in user restores and their Apple entitlement is synced and returned` |
| Never acts for another user ID, even one supplied by the client | `(a) restore: never acts for another user ID, even if the client sends one` |
| Throttled per user, with an explicit message | `(a) restore: throttled to one RevenueCat lookup per user per 10 seconds, with an explicit message` |
| Inert when IAP is off | `(a) restore: refused when IAP is off; no RevenueCat request` |
| A transfer between accounts updates both | `(a) restore: TRANSFER to another account revokes the old account and grants the new one` |

### (b) Cancellation (tests prefixed "(b) cancellation")

| Requirement | Test |
|---|---|
| Apple cancel keeps access to the end of the period, then revokes | `(b) cancellation: Apple CANCELLATION keeps access to the end of the paid period, then revokes` |
| Apple expiration revokes | `(b) cancellation: Apple EXPIRATION revokes access` |
| Apple refund revokes immediately | `(b) cancellation: Apple refund (CUSTOMER_SUPPORT) revokes immediately` |
| Apple billing grace keeps access, then revokes | `(b) cancellation: Apple billing issue keeps access through Apple grace, then revokes` |
| A late, older snapshot cannot undo a cancel | `(b) cancellation: a late, older webhook snapshot cannot undo a cancellation`, plus the SQL ordering check in `scripts/qa/verify-store-entitlements.mjs` |
| Stripe cancel at period end | `(b) cancellation: Stripe cancel-at-period-end keeps access until the period ends, then revokes` |
| Stripe subscription deleted | `(b) cancellation: Stripe subscription deleted (status canceled) honors the paid-through date, then revokes` |

### (c) Duplicate prevention (tests prefixed "(c) duplicates")

| Requirement | Test |
|---|---|
| A Stripe subscriber in the app sees no buy button | `(c) duplicates: a Stripe-active user in the app sees status, no buy button`; also recognized with no Stripe environment configured |
| An Apple subscriber on the web sees no Stripe checkout | `(c) duplicates: an Apple-active user on the website sees no Stripe checkout` |
| The server refuses Stripe checkout for an Apple subscriber | `(c) duplicates: server guard REFUSES website Stripe checkout for an Apple-active user (no Stripe call)`; it fails closed, proceeds after the Apple subscription expires, and is never reached with IAP off |
| Both channels active are flagged for support | `(c) duplicates: both channels renewing is flagged for support with both manage paths` |
| Status re-checked before the App Store sheet | `(c) duplicates: the app re-checks status on the server right before the App Store sheet` |

Mutation checks (run by hand):
- Making the guard always allow fails the "REFUSES" test.
- Disabling the guard at its call site fails both refusal tests.
- Ignoring Apple grace fails the billing-grace test.

The independent reviewer killed 16 further source mutants against this suite.

### Also verified

| Requirement | Where |
|---|---|
| Apple subscribers get the premium AI token budget: `has_active_subscription`, used by `has_ai_budget`, counts active App Store rows; Stripe rules unchanged | `scripts/qa/verify-store-entitlements.mjs` (PGlite) |
| Buy and Restore wait until the App Store SDK is identified as the signed-in user; a user switch resets it; `identify` is serialized | `tests/app-aware-paywall.test.mjs` |
| The webhook body is capped while streaming, even with no or a false `Content-Length` | `tests/revenuecat-sync.test.mjs` |
| Sandbox purchases are stored only while `IAP_HONOR_SANDBOX=true` | `tests/revenuecat-sync.test.mjs` |

**Unchanged website checkout.** `tests/stripe-checkout-regression.test.mjs` pins the exact Stripe
requests for monthly, annual and the 14-day trial.

**Not verified: live Apple and RevenueCat.** Nothing here has made a real StoreKit purchase, a real
sandbox restore or cancel, or received a real RevenueCat delivery. That is blocked until the owner
completes section 7 steps 1 to 9 and 11 to 13: App Store Connect agreements and products,
RevenueCat project and webhook, secrets, migration, sandbox testers. The native agent also has to
install the plugin (section 6). The staging checklist in step 13 is the live verification plan.

## 7. Owner-only setup, in order

None of these steps can be done by an agent. They need the owner's Apple, bank, tax, RevenueCat or
Stripe identity.

1. **Apple Developer Program.** Account Holder only. Accept the latest Apple Developer Program
   License Agreement in App Store Connect, Business.
2. **Paid Apps Agreement.** App Store Connect, then Business, then Agreements: accept the **Paid
   Applications** agreement.
3. **Banking.** In the same Business section, add a bank account for payouts.
4. **Tax.** Complete the tax forms (W-9 for a US entity) and any regional tax forms Apple asks for.
   IAP products cannot be sold until steps 2 to 4 show "Active".
5. **Small Business Program.** Optional, recommended. Apply at
   [App Store Small Business Program](https://developer.apple.com/app-store/small-business-program/)
   to pay a 15% commission instead of 30%.
6. **Create the subscriptions.** App Store Connect, then the RestPilot app (bundle
   `com.restpilotai.app`), then Monetization, then Subscriptions:
   - Create **one subscription group**, for example "RestPilot Premium".
   - Add **`restpilot_monthly`**: 1 month, price **$7.99** (USD base; let Apple set the other
     storefronts or review them).
   - Add **`restpilot_annual`**: 1 year, price **$49.99**.
   - Rank Annual above Monthly within the group, so changing plans is an upgrade or downgrade, not
     a second subscription.
   - On each product, choose Set up Introductory Offer, then **Free**, then **2 Weeks**, for all
     storefronts. Use no end date, or a far one. Offers cannot be edited, only deleted and recreated.
   - Add localized display names and descriptions, and the review screenshot of the paywall.
   - Product IDs are permanent and can never be reused. Use exactly these two, because the code
     matches them.
7. **RevenueCat account.** Free tier, owner's account:
   - Create a project with an Apple App Store app for `com.restpilotai.app`.
   - Upload an **In-App Purchase key** (`.p8`, from App Store Connect, then Users and Access, then
     Integrations). Give its key ID and issuer ID to RevenueCat.
   - Import the two products. Create entitlement `premium` with both products attached, and an
     offering marked **Current** containing both packages.
   - Keep the default "Transfer to new App User ID" restore behaviour.
   - **Do not connect Stripe to RevenueCat**: website revenue stays outside RevenueCat billing.
8. **Webhook.** In RevenueCat, go to Integrations, then Webhooks:
   - URL `https://<railway host>/api/public/iap/revenuecat`, all events, both environments.
   - Enable **HMAC signing** and confirm deliveries carry
     `X-RevenueCat-Webhook-Signature: t=…,v1=…`. The endpoint refuses unsigned deliveries with
     401. If they are refused, Apple state would only update when a user restores, so check that
     "Send test event" returns 200. Optionally also set an Authorization header value.
9. **Secrets.** Put these in Railway's secure variable editor only, never in chat or git:
   - `REVENUECAT_SECRET_API_KEY` (`sk_…`, project secret key);
   - `REVENUECAT_WEBHOOK_SECRET` (HMAC signing secret);
   - `REVENUECAT_WEBHOOK_AUTHORIZATION` (optional);
   - `VITE_REVENUECAT_IOS_API_KEY` (public `appl_…` key; build-time).
10. **Website Stripe on Railway.** Only if the owner wants the website checkout to keep working
    after cutover. Create a **restricted** Stripe secret key for this account. Set it, plus webhook
    signing secrets, as Railway secrets, and authorize an agent to restore the web checkout UI and
    adapter. Until then, keep production on Lovable `main`, where Stripe works today.
11. **Database.** After a backup, apply `supabase/migrations/20261114120000_store_entitlements.sql`
    to the intended Supabase project, after the three November 13 migrations.
12. **Sandbox testers.** App Store Connect, then Users and Access, then Sandbox: create two sandbox
    Apple Accounts. On the test iPhone, sign in under Settings, then Developer (or App Store), then
    Sandbox Account. Sandbox renewals are accelerated (a 2-week trial lasts minutes).
13. **Turn on in staging first.** Set `IAP_ENABLED=true`, `IAP_HONOR_SANDBOX=true` and
    `VITE_IAP_ENABLED=true` on staging only,
    rebuild, and install the shell with the plugin through TestFlight. Test:
    - purchase monthly and annual;
    - the trial;
    - Restore on a second account (transfer);
    - cancel in Settings;
    - the RevenueCat webhook "Send test event" (expect 200);
    - an existing Stripe test subscriber sees "billed through the website" and no buy button.

    Only then repeat for production.
14. **App Review.** Set `IAP_HONOR_SANDBOX=true` on production while the build is in review, and
    turn it off after approval. Repeat for every later review. **App Review notes.** In App Store Connect, say that subscriptions are sold with IAP, that
    website subscribers can sign in (3.1.3(b)), and provide a demo account. Leave
    `VITE_IAP_US_EXTERNAL_LINK=false` unless the owner decides otherwise after re-checking the US
    rules.

---

## 8. Follow-ups, needed before the flags are turned on in production

- **F1, native.** Add the plugin to `ios-app/` and enable the In-App Purchase capability
  (section 6). This belongs to the native iOS agent.
- **F2, web.** Show the merged status on the website: the profile Premium card should use
  `getEntitlementStatus`, so Apple subscribers see "Billed by Apple" and no Stripe checkout. Today
  the profile reads Stripe rows only, and on the Railway build `getSubscriptionState` returns
  "free" for everyone because payments are not configured. That second point affects existing
  Stripe subscribers' display on staging even without IAP.
- **F2b, legal link.** Inside the app, the Subscription Terms page (`/legal/subscription`) links to
  `/pricing`. That is harmless while `/pricing` is the preview screen. If `/pricing` ever regains
  Stripe checkout on Railway, hide that link in the native shell.
- **F3, account.** Account export should include `store_entitlements`. Account deletion should tell
  Apple subscribers to cancel in Settings (section 5). It cancels Stripe only, and Apple keeps
  billing after the row cascades away.
- **F4, ops.** Alert the owner when the RevenueCat webhook returns 5xx, as the Stripe webhook does.
  Add a periodic reconcile job that calls `syncStoreEntitlement` for rows expiring within 24 hours.
  Both are optional: RevenueCat retries for about 80 minutes. A webhook refreshes at most 10
  affected user IDs per event, so a longer alias list would leave the rest to their next event or
  Restore. That is unlikely with one RestPilot account per Apple purchaser.
