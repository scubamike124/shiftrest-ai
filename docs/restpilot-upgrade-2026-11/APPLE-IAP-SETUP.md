# Apple In-App Purchase on `main`: what is built and the owner's setup steps

_Nov 15 2026. Owner decision: RestPilot sells new subscriptions through Apple's App Store (In-App Purchase, through RevenueCat) instead of Stripe. Monthly $7.99 and Annual $49.99 stay, each with a 14-day free trial. There is no lifetime plan. Existing Stripe monthly, annual, past-due and lifetime customers keep working unchanged._

Nothing here was published or activated. Nothing called Stripe, RevenueCat or Apple. The database migration has **not** been applied.

## 1. What is on `main` (all inert until you switch it on)

| Piece | Where | What it does |
|---|---|---|
| Website checkout switch | `VITE_WEB_CHECKOUT_ENABLED`, in `src/lib/billing-flags.ts` | **Off by default.** The website shows plans and "Subscribe in the RestPilot iPhone app". There is no Stripe checkout and no start-trial button, and the server refuses new Stripe purchases. |
| App paywall | `src/components/subscription/AppSubscriptionScreen.tsx`, `NativeSubscription.tsx` | Inside the iPhone app it shows: Monthly and Annual from StoreKit with the 14-day trial, **Restore purchases**, **Manage App Store subscriptions**, Apple's renewal terms, and links to Terms, Privacy and Subscription Terms. Until everything is ready (key, plugin, server), it shows the existing neutral "Subscriptions aren't available in the app yet." screen. |
| Native bridge | `src/lib/entitlements/iap-bridge.ts` | Talks to `@revenuecat/purchases-capacitor` in the app shell, which the native agent adds on the Railway branch. It identifies the purchaser as the signed-in RestPilot user. |
| Entitlement merge | `src/lib/entitlements/merge.ts` | One Premium answer from Stripe (active, trialing, canceled-but-paid, lifetime) plus Apple (active, trial, billing grace). It also flags Stripe `past_due` / `unpaid` and double billing. |
| RevenueCat webhook | `POST /api/public/iap/revenuecat` | Returns 404 unless `IAP_ENABLED=true`. It checks the HMAC signature (and the optional Authorization header), caps the body at 64 KB and is idempotent per event ID. It never trusts the payload: it re-fetches the subscriber from RevenueCat. Older snapshots never overwrite newer ones. |
| Restore / sync | `syncMyStoreEntitlement` in `src/lib/entitlements/entitlement.functions.ts` | Signed-in user only; the user ID always comes from the session. Throttled to one call per 10 s. |
| Duplicate-billing guards | merge + `paywall-policy.ts` + `checkout-guard.ts` | **No Apple purchase** for a Stripe subscriber who is active, trialing, canceled-but-paid, lifetime, past_due or unpaid. Status is re-checked right before the App Store sheet. **No Stripe checkout** for an active Apple subscriber (server refusal). |
| Profile | `src/routes/profile.tsx`, `src/lib/subscription.ts` | Apple subscribers see their plan and "Manage in App Store subscriptions". Stripe subscribers keep "Manage subscription". Past-due subscribers get **"Manage billing"**. The account-deletion prompt warns that deleting the account does not cancel an App Store subscription. |
| Voice trial meter | `src/lib/realtime/trial-usage.functions.ts` | App Store free-trial users get the same voice cap as Stripe trial users (with IAP on). |
| Database migration | `supabase/pending-migrations/20261115120000_store_entitlements.sql` | **Not applied**, and deliberately kept outside `supabase/migrations/`. It adds `store_entitlements`, `store_webhook_events` and `apply_store_entitlement()`. It extends `has_active_subscription` (the AI budget) so active Apple rows count, keeping the Stripe rules word for word. |

**Without the migration, nothing breaks:**
- the webhook answers 503 (RevenueCat retries later);
- restore says "In-app purchases are not available yet.";
- the app keeps the neutral screen;
- Stripe status and Profile work as before;
- one warning line goes to the server log.

### Flags and defaults

| Name | Where you set it | Default | Effect |
|---|---|---|---|
| `VITE_WEB_CHECKOUT_ENABLED` | `.env.production` (build time) | unset = **off** | `"true"` turns website Stripe checkout and the trial buttons back on |
| `VITE_REVENUECAT_IOS_API_KEY` | `.env.production` (build time, public `appl_…` key) | unset = **inert** | Lets the app load the App Store paywall |
| `IAP_ENABLED` | Lovable Cloud → Secrets | unset = **off** | Server: webhook, restore, Apple rows in status and in the guards |
| `IAP_HONOR_SANDBOX` | Lovable Cloud → Secrets | unset = off | Counts sandbox and TestFlight purchases. **Needed for App Review**, but it also gives every TestFlight tester free Premium |
| `REVENUECAT_SECRET_API_KEY` | Lovable Cloud → Secrets | unset | Server reads subscribers from RevenueCat |
| `REVENUECAT_WEBHOOK_SECRET` | Lovable Cloud → Secrets | unset | Webhook HMAC secret |
| `REVENUECAT_WEBHOOK_AUTHORIZATION` | Lovable Cloud → Secrets | unset (optional) | Exact Authorization header RevenueCat must send |

**The app offers a purchase only when all of these are true:**
- the key is set;
- the app has the Purchases plugin;
- `IAP_ENABLED=true`;
- both RevenueCat secrets are set;
- the migration is applied.

This way nobody can be charged by Apple without the server being able to record it.

## 2. ⚠️ Web-checkout switch timing (revenue risk)

With `VITE_WEB_CHECKOUT_ENABLED` off, which is the default on `main`, **the website stops selling at the next Publish**. Until the App Store app is live with IAP approved, **nobody can start a new paid subscription anywhere**. Existing subscribers keep paying and keep Premium.

Choose one:
- **A. Keep selling on the web until the app is live.** Before Publishing, ask Lovable: *"In `.env.production`, add the line `VITE_WEB_CHECKOUT_ENABLED="true"`."* Then Publish. When the App Store version is live, remove the line and Publish again.
- **B. Stop web sales now.** Publish as is. Accept no new revenue until the app is approved.

## 3. Your setup steps, in order (iPhone-friendly)

Tip: for App Store Connect and RevenueCat on iPhone, use Safari, then **aA → Request Desktop Website**.

### Step 1. App Store Connect: agreements (once)
appstoreconnect.apple.com → **Business** (or Agreements, Tax, and Banking):
- **Paid Apps** agreement: Active;
- bank account and tax forms complete.

IAP products cannot be sold or tested in TestFlight without this.

### Step 2. App Store Connect: the two subscriptions
1. **Apps** → RestPilot (bundle `com.restpilotai.app`) → **Monetization → Subscriptions**.
2. Create a subscription group, for example **RestPilot Premium**.
3. Add two auto-renewable subscriptions. The product IDs are permanent, so type them exactly:

| Reference name | Product ID | Duration | Price |
|---|---|---|---|
| RestPilot Monthly | `restpilot_monthly` | 1 month | $7.99 (USD base; let Apple fill other storefronts) |
| RestPilot Annual | `restpilot_annual` | 1 year | $49.99 |

4. For **each** product:
   - **Subscription Prices → Introductory Offers → +**, Free, **2 weeks**, all storefronts, new subscribers;
   - add a display name and description (English);
   - add a review screenshot of the in-app paywall (take it once Step 8 works).
5. **App Information → App Store Server Notifications:** paste the **Production** and **Sandbox** URLs that RevenueCat shows you in Step 3 (Version 2).
6. **Users and Access → Integrations → In-App Purchase** (API key): generate a key, download the `.p8` **once** and note the Key ID and Issuer ID. RevenueCat needs it.

### Step 3. RevenueCat project
app.revenuecat.com → create the project **RestPilot**.
1. **Apps → + App Store app:**
   - bundle ID `com.restpilotai.app`;
   - upload the In-App Purchase key (`.p8`, Key ID, Issuer ID) from Step 2.6;
   - copy the **App Store Server Notifications URL** into Step 2.5.
2. **Products:** import `restpilot_monthly` and `restpilot_annual`.
3. **Entitlements → +** `premium`, and attach both products.
4. **Offerings:** the **default** offering (current) with packages **Monthly** (`$rc_monthly` → `restpilot_monthly`) and **Annual** (`$rc_annual` → `restpilot_annual`).
5. **API keys:**
   - copy the **public Apple SDK key** (starts with `appl_`);
   - create a **secret API key** (v1, starts with `sk_`). Keep it private. Do not paste it into chats, tickets or this repo.
6. **Integrations → Webhooks → +:**
   - URL `https://restpilotai.com/api/public/iap/revenuecat`, environment **Both**;
   - optional: an **Authorization header value** (a long random string);
   - turn on **signing** and copy the signing secret. The endpoint **refuses unsigned deliveries** with 401. If your RevenueCat plan shows no signing option, stop here and tell engineering before Step 4; do not switch IAP on.

### Step 4. Lovable Cloud secrets
Lovable → project → **Cloud → Secrets** (server-only, never in the website bundle):
- `REVENUECAT_SECRET_API_KEY` = the `sk_…` key
- `REVENUECAT_WEBHOOK_SECRET` = the webhook signing secret
- `REVENUECAT_WEBHOOK_AUTHORIZATION` = the Authorization header value, if you set one
- `IAP_ENABLED` = `true`
- `IAP_HONOR_SANDBOX` = `true` while testing and during App Review. Afterwards decide: on means TestFlight testers get Premium free.

### Step 5. Approve the database migration (production change, your decision)
In Lovable chat, send:

> Create a new database migration whose SQL is exactly the contents of `supabase/pending-migrations/20261115120000_store_entitlements.sql`. Do not change anything else.

Read the approval card Lovable shows and approve it. Then check, read-only, in **More → Database → Manage → SQL editor**:

```sql
select to_regclass('public.store_entitlements') as entitlements,
       to_regclass('public.store_webhook_events') as webhook_events;
```

Both columns must show a name (not empty). The migration is additive. Its only change to an existing object is `has_active_subscription`, which gains "or an active App Store row".

### Step 6. The public key in the app build
In Lovable chat:

> In `.env.production`, add `VITE_REVENUECAT_IOS_API_KEY="appl_…"` (paste the public key).

It is public by design. Then **Publish** (you decide when; see section 2).

### Step 7. The iPhone app build
This is the native agent's work on `codex/restpilot-railway-migration`:
- `@revenuecat/purchases-capacitor@9.2.2`;
- the **In-App Purchase** capability in Xcode;
- a new TestFlight build.

The app shell loads restpilotai.com, so the paywall itself comes from `main` after your Publish.

### Step 8. Sandbox testers and the purchase test (on your iPhone)
- **Easiest: TestFlight.** Purchases in TestFlight builds are free sandbox purchases with your normal Apple Account, and renewals run fast: a month passes in minutes.
- **Or a sandbox tester:**
  1. App Store Connect → **Users and Access → Sandbox → Test Accounts → +**, using an email you don't use for a real Apple Account.
  2. On the iPhone: **Settings → Developer → Sandbox Apple Account** (or **Settings → App Store → Sandbox Account**), and sign in there only.

Use a test RestPilot account, **not** the shared production test account.

Then check each item:
1. **Purchase:**
   - Open the app, sign in, then Profile → Upgrade (or /paywall).
   - You should see Monthly $7.99 and Annual $49.99 with "14-day free trial for eligible new subscribers".
   - Tap Annual and confirm the Apple sheet. Expected: "Thank you — RestPilot Premium is active."
   - Profile shows "Premium · annual (free trial)".
   - In Safari, restpilotai.com → Profile shows the same plan with "Manage in App Store subscriptions".
2. **Webhook:**
   - RevenueCat → Customers → your user ID: the events show **Delivered 200**.
   - Lovable logs: no errors on `/api/public/iap/revenuecat`.
3. **Restore:** delete and reinstall the app, sign in, then tap **Restore purchases**. Expected: "Purchases restored." and Premium again.
4. **Cancellation:**
   - Tap **Manage App Store subscriptions** (or Settings → your name → Subscriptions) and cancel.
   - The app keeps Premium, with "Access continues until …". After the sandbox period ends, Premium goes away.
5. **No double billing:**
   - Sign in with an account that has an active **website** subscription. The app shows its plan and "billed through your RestPilot web account", with no buy buttons.
   - With website checkout on, an Apple subscriber who opens the website paywall is refused ("You already have RestPilot Premium through the App Store…").
6. **Account deletion:** the prompt warns that an App Store subscription must be cancelled in Settings.

### Step 9. App Review
Submit the products together with the build. In the review notes, add:
- a **free** demo account, so the reviewer sees the paywall;
- "Subscriptions are sold with In-App Purchase. Website subscribers keep access (3.1.3(b))."

`IAP_HONOR_SANDBOX` must be `true` while in review. Also close the other gaps in `APP-STORE-COMPLIANCE.md`: Sign in with Apple or hide Google sign-in in the app (4.8), and AI data-sharing consent (5.1.2). The `/legal/subscription` page still describes Stripe billing; ask counsel to add App Store billing wording.

## 4. Rollback (any time)
- **App back to the neutral screen:** remove `VITE_REVENUECAT_IOS_API_KEY` and Publish, or set `IAP_ENABLED` to anything but `true`.
  - Existing Apple subscribers are still billed by Apple. Their rows still count for the AI budget (`has_active_subscription`), but the app and Profile stop showing them as Apple Premium while IAP is off.
- **Website selling again:** `VITE_WEB_CHECKOUT_ENABLED="true"` and Publish.

## 5. Verification done offline by engineering, and what still needs you

**Ran (no network):**
- `bun run test`: 172 tests. They include signed RevenueCat webhook fixtures and the real server functions with the database and RevenueCat mocked, covering:
  - purchase, restore and transfer;
  - cancellation to end of period, expiry, refund and billing grace;
  - duplicate prevention both ways, including past_due;
  - lifetime honored;
  - past_due portal;
  - web checkout refused when off;
  - existing Stripe webhooks still processed through the real signature check;
  - the missing-table behaviour.
- PGlite (in-memory Postgres) run of the pending migration on top of the original subscriptions migration, covering:
  - snapshot ordering and concurrency;
  - validation;
  - `has_active_subscription` for Apple, lifetime and the unchanged Stripe rules;
  - row-level security and privileges;
  - deletion cascade.
- Playwright on a local production build with the network faked: the website with checkout off, Profile past_due/monthly/lifetime, and native-stub app screens.

**Not possible without you:**
- a real StoreKit purchase, restore, cancellation and renewal;
- RevenueCat webhook delivery and signing;
- App Review.

These need Steps 1–8: App Store Connect products and agreements, the RevenueCat project, the secrets, the migration, and a sandbox tester or TestFlight.
