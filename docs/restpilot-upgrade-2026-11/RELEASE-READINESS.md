# RestPilot production release readiness (`main` → restpilotai.com)

_Nov 15 2026. Production is served by Lovable from `main` and changes only when the owner taps **Publish**. Nothing here was published. DNS, Stripe and keys were not touched._

## Status

**STATUS: PENDING #40**. See "Blockers". This section is updated when #40 merges and main's HEAD has been re-verified.

| | |
|---|---|
| Production now | build `b-1786931160964` (built Aug 17 2026). `/pricing` still shows the **$99 lifetime** plan. |
| `main` HEAD | `6b683af` |
| What Publish ships | #2 (robots.txt sitemap) · #19 (lifetime discontinued for new customers) · #38 (wearable OAuth callbacks no longer 500) · #44 (signed wearable OAuth state) · #46 (one lockfile, read-only CI) · **#40 (no purchase inside the iPhone app), once merged** |

## What was tested, with evidence

All browser tests ran against a **local production build** (`NITRO_PRESET=node_server vite build`).
- The server ran with a fake backend: Supabase and the Stripe gateway were stubbed, and every other outbound host was refused, so nothing left the machine.
- Playwright drove the preinstalled Chromium.
- The production CSP was kept. Only the fake Supabase host was added to it.
- Scripts: scratchpad `rel-int/run.mjs`, `oauth.mjs`, `hydra.mjs`, `clientnav.mjs`.

### Install, typecheck, unit tests, build (fresh clone)
`git clone --depth 1` of #46's head (`5ece944`, now squash-merged as `6b683af`):

```
$ bun install --frozen-lockfile   → 1011 packages installed, exit 0
$ bun run typecheck               → tsc --noEmit, exit 0
$ bun run test                    → tests 14, pass 14, fail 0
$ bun run build                   → exit 0 (6 vite environments + nitro)
```
The GitHub Actions run "main checks" was green on the PR head (run 43671789722). It is read-only, and main has no branch protection.

### Website: plans and checkout (main + #40, iPhone Safari 390 and desktop 1280)

| Check | Result |
|---|---|
| `/pricing`, `/`, `/paywall` show **$7.99**, **$49.99** and the **14-day** trial | ✅ all three, both viewports |
| No $99 and no "Founding" anywhere | ✅ |
| "lifetime" wording on `/paywall` | Only in the renewal disclosure: "Existing Lifetime purchases (no longer sold)…". No offer. ✅ |
| Monthly checkout payload sent to Stripe | `mode=subscription`, `price=restpilot_monthly`, `subscription_data[trial_period_days]=14`, `ui_mode=embedded_page`, metadata `userId` + `priceId`, no `payment_intent_data` ✅ |
| Annual checkout payload | Same, with `restpilot_annual` ✅ |
| Stripe call order | `GET /v1/prices?lookup_keys[0]=…` → customer search/list/create → `POST /v1/checkout/sessions` ✅ |

### Website: billing management (Profile)

| Subscriber | Profile shows | Manage subscription → Stripe portal |
|---|---|---|
| Monthly | "Premium · Monthly" | ✅ `POST /v1/billing_portal/sessions customer=… return_url=/profile`; page navigates to billing.stripe.com |
| Annual | "Premium · Annual" | ✅ same |
| Trial | "Premium · Monthly (Free Trial)" | ✅ same |
| Lifetime | "Premium · Lifetime" | No button, by design: there is nothing to bill ✅ |
| Free | "Upgrade to Premium" card | n/a ✅ |

What a subscriber can do inside the portal (cancel, update their card, switch plans) depends on the portal settings in Stripe, which were not inspected here. Post-publish check 3 confirms it opens for a real subscriber; the owner can confirm cancellation is switched on in Stripe → Settings → Billing → Customer portal.

### iPhone app (Capacitor stub + `RestPilotApp/1.0.0` User-Agent)
For free, monthly and lifetime users, across `/paywall`, `/pricing`, `/profile`, `/dashboard`, `/features` and `/`, every trial/upgrade/subscribe/manage button that was present was tapped.

| Check | Result |
|---|---|
| Prices shown | none ✅ |
| Purchase calls to action | none ✅ |
| Server Stripe calls | **0** ✅ |
| Notice on `/paywall` and `/pricing` | "Subscriptions aren't available in the app yet." ✅ |
| Subscribers' plan | Shown: "Your plan: Premium · Monthly", "Your plan: Lifetime access" ✅ |
| Profile billing text | "Billing changes aren't available in the app.", with no portal button ✅ |
| Native header on server-function calls | `x-restpilot-native-app: 1` sent on every call ✅ |

The server refusing checkout/portal for app requests is covered by #40's own tests and by the White Glove attack test.

### Wearable OAuth callbacks (#38, #44)
Tested on both `/api/public/wearables/oura/callback` and `/api/public/wearables/fitbit/callback`:

| State sent | Result |
|---|---|
| Legacy unsigned `<victimId>:x` | **302** → `/profile?error=…&reason=bad_state` ✅ |
| Victim id with a bad signature | 302 `bad_state` ✅ |
| Signed with the wrong key | 302 `bad_state` ✅ |
| Expired | 302 `bad_state` ✅ |
| Signed for the other provider | 302 `bad_state` ✅ |
| Validly signed (token exchange fails offline) | **302** with an error reason, **not 500** ✅ |
| Missing state | 302 `missing_code` ✅ |

No `wearable_connections` write happened for any forged state.

### Console errors and layout (375, 390, 430, desktop 1366)
Pages: `/`, `/pricing`, `/features`, `/science`, `/auth`, `/paywall`, `/profile`, `/dashboard`, `/legal/subscription`. Signed in as a monthly subscriber.

| Mode | Result |
|---|---|
| Website, all four widths | ✅ **0 app console errors, 0 page errors, 0 px horizontal overflow** |
| iPhone app mode | ❌ **React hydration error #418** on the first load of `/pricing`, `/features`, `/science` and `/paywall`. See Blockers. 0 overflow. |

Excluded as test artifacts:
- network errors for the stubbed Supabase, AI and Stripe hosts;
- 406 responses for rows the fake doesn't hold.

## Entitlements

Existing **monthly, annual and lifetime** customers keep Premium:

- **Client** (`src/lib/subscription.ts`): `status='lifetime'` is premium, as are `active`/`trialing` within the period and `canceled` until the period ends. Verified in the browser for monthly, annual, trial and lifetime.
- **Server/SQL** (`has_active_subscription`, which gates the AI budget): the same rules, including `status = 'lifetime'`. It checks whether any row qualifies, so a lifetime row wins over later rows.
- Lifetime rows are never rewritten. The Stripe subscription webhooks only upsert by `stripe_subscription_id`, and lifetime rows use the key `lifetime_<checkout session id>`.

Nothing can create a **new** lifetime:

| Path | Status |
|---|---|
| UI | Every customer-facing screen offers only Monthly and Annual (#19; tested above) |
| Server | `createCheckoutSession` refuses `restpilot_lifetime` and any price outside {monthly, annual} **before any Stripe call**. It also refuses any price that Stripe reports as one-time. Covered by `tests/lifetime-discontinued.test.mjs` |
| Webhook | `checkout.session.completed` writes a lifetime row only for a completed `mode=payment` Checkout Session that carries our `metadata.userId`. Only our checkout server function creates such sessions, and on `main` it can no longer create one |

Residual window: today's unpublished production still sells lifetime. A lifetime session opened just before Publish can still be paid within Stripe's 24-hour session expiry, and it is correctly honored.

Optional hardening for later (non-blocking):
- make the webhook require price `restpilot_lifetime` before writing a lifetime row;
- the owner can archive the lifetime Price in Stripe after Publish.

## Cancellation and billing management

- **Website: reliable.** Profile → **Manage subscription** opens the Stripe Customer Portal for every active, trialing or cancel-at-period-end subscriber (tested above).
  - The Subscription Terms (`/legal/subscription` §4) say "You can cancel any time from your account settings", which matches what the site does.
  - Deleting the account also cancels Stripe subscriptions.
  - Support: support@restpilotai.com.
- **In the app: neutral and compliant.**
  - Subscribers see their plan status and "Billing changes aren't available in the app.", with no link.
  - App Store Guideline 3.1.3(a) expressly allows "account management functionality for existing customers" only for Reader apps, and links are allowed only on the US storefront. Plain status text with no link is the safe form.
  - No copy change is needed for this Publish (`APP-STORE-COMPLIANCE.md` has the details and the recommended copy for the IAP release).
- **Gap (non-blocking): customers whose payment failed.**
  - A `past_due` or `unpaid` subscriber is not premium, so Profile shows "Upgrade to Premium" instead of **Manage subscription**. They cannot open the portal from Profile to fix their card or cancel, and could start a second subscription.
  - Stripe's own failed-payment emails, if they are enabled in the Stripe dashboard, still give them a way to fix it.
  - Suggested small follow-up: show Manage subscription whenever the user has a Stripe customer id.

## App Store

See `APP-STORE-COMPLIANCE.md`.
- **Short version:** Apple IAP **is required** before the app can be submitted, because web subscribers unlock Premium in the app (Guidelines 3.1.1 and 3.1.3(b)). The US link rules allow links but don't remove that requirement.
- After this Publish the app shows no purchase at all. That is fine for internal TestFlight.
- Also open before submission:
  - an explicit consent step for sharing data with third-party AI (5.1.2(i));
  - Sign in with Apple, or hide Google sign-in in the app (4.8).

## Blockers

1. **#40 is not merged yet.** It is awaiting the White Glove attack-test APPROVE; the coordinator merges it.
   - Without #40, the iPhone app shell, which loads restpilotai.com, can open the website Stripe checkout.
   - The website itself is unaffected either way.
2. **#40 hydration error in the app**, found here and posted on #40 with a verified one-line fix (`useSyncExternalStore`).
   - It is not a purchase leak; every purchase check stays closed.
   - It is a console error on four pages inside the app only. The website is clean.
   - The coordinator decides whether to fix it before merge or right after.

Non-blocking findings for later:
- PWA precache warning: `brace-expansion` override → only `/` is precached;
- the past-due portal gap;
- webhook hardening;
- the 5.1.2 and 4.8 App Store items.

## Owner: how to Publish (iPhone)

1. Open the **Lovable** app or lovable.dev in Safari and sign in.
2. Open the **RestPilot** project.
3. **Check the preview first.** The preview builds from `main`. Confirm:
   - `/pricing` shows **Monthly $7.99** and **Annual $49.99** with the **14-day free trial**, and no $99 lifetime;
   - Profile, signed in, shows your plan;
   - `/version` shows a new Build ID.
4. Tap **Publish** (top right).
5. Tap **Update** to push the new version to restpilotai.com.

## After Publish: checks (about 5 minutes)

1. Open `https://restpilotai.com/api/public/version`. The `buildId` must **differ** from `b-1786931160964`, and `builtAt` must be today.
2. On `https://restpilotai.com/pricing`: Monthly $7.99, Annual $49.99, 14-day free trial, **no $99 / lifetime**.
3. Sign in as an existing **monthly or annual** subscriber, then go to Profile:
   - it shows "Premium · Monthly" or "Premium · Annual";
   - tap **Manage subscription**: the Stripe portal opens;
   - close it without changing anything.
4. A **lifetime** account still shows "Premium · Lifetime".
5. Optionally, start a checkout as a free test account: the plan selector and "Start 14-day free trial" open Stripe's embedded checkout. Don't pay.
6. On an installed iPhone home-screen app, open `/version` and pull to refresh once. The service worker picks up the new build.
7. In Lovable, check the logs: no new 500s on `/api/public/wearables/*` or `/api/public/payments/webhook`.

If anything is wrong: in Lovable's version history, restore the previous version and Publish again.
