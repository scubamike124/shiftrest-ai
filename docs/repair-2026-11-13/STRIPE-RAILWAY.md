# RestPilot: website Stripe on Railway (owner setup)

Stripe account: **RestPilot's own Stripe account only**. Production
restpilotai.com and its Lovable checkout stay untouched, and the domain
does not move until Railway passes the end-to-end test and you approve.

## Step 1: Test mode, for staging (do this first)

Use a desktop if you can; the Stripe dashboard works in iPhone Safari, but
it is fiddly. Turn on **Test mode** (the toggle at the top of the Stripe
dashboard).

1. **Create the restricted key.**
   - Go to **Developers → API keys → + Create restricted key**.
   - Name it `restpilot-railway-staging`.
   - Set these permissions and leave everything else **None**:

| Resource | Permission | Why (exact code calls) |
| --- | --- | --- |
| Customers | **Write** | `customers.search`, `customers.retrieve`, `customers.create` (find or create the buyer's customer by user id) |
| Checkout Sessions | **Write** | `checkout.sessions.create` (start checkout) and `checkout.sessions.listLineItems` (webhook) |
| Customer portal | **Write** | `billingPortal.sessions.create` (the "Manage subscription" button) |
| Subscriptions | **Write** | `subscriptions.retrieve` (webhook sync) and `subscriptions.cancel` (when a user deletes their account) |
| Prices | **Read** | `prices.list` by lookup key `restpilot_monthly` / `restpilot_annual` |
| Products | **None** | Not called by the Railway code. Turn on Read only if the test shows a "Products" permission error. |

   - Copy the key. It starts with `rk_test_`.
2. **Create the webhook endpoint.**
   - Go to **Developers → Webhooks → + Add endpoint**.
   - Endpoint URL:
     `https://restpilot-web-staging.up.railway.app/api/public/payments/webhook?env=sandbox`
   - Events, exactly these 6:
     - `checkout.session.completed`
     - `checkout.session.async_payment_succeeded`
     - `customer.subscription.created`
     - `customer.subscription.updated`
     - `customer.subscription.deleted`
     - `invoice.payment_failed`
   - After saving, tap **Reveal** under *Signing secret*. It starts with
     `whsec_`.
3. **Customer portal (Test mode):** open **Settings → Billing → Customer
   portal** and tap **Save**, so the portal is active in Test mode. Allow
   cancellation.
4. **Prices (Test mode):** confirm the test prices exist with these lookup
   keys. If they don't, tell the agent; agents do not create prices.

| Lookup key | Price |
| --- | --- |
| `restpilot_monthly` | $7.99 per month |
| `restpilot_annual` | $49.99 per year |

   No lifetime price is used. The 14-day trial is set by the app at
   checkout, not on the price.
5. **Add the values to Railway** (iPhone Safari is fine).
   - Open [the Railway project](https://railway.com/project/f52e7151-37df-4a2a-9f8b-0a686b031a5c),
     then **staging → restpilot-web → Variables → + New Variable**.
   - Add three variables:

| Variable name (exact) | Value | Test or live |
| --- | --- | --- |
| `STRIPE_SECRET_KEY` | the restricted key from step 1 (`rk_test_…`) | **test** |
| `STRIPE_WEBHOOK_SECRET` | the signing secret from step 2 (`whsec_…`) | **test** |
| `VITE_PAYMENTS_CLIENT_TOKEN` | the Test-mode **publishable** key (`pk_test_…`, under Developers → API keys) | **test** |

   - Railway stages variable changes: tap **Deploy** (top of the canvas)
     to apply them.
   - The agent sets the two non-secret switches on staging itself:
     `PAYMENTS_ENVIRONMENT=sandbox` and `VITE_STRIPE_CHECKOUT_ENABLED=true`.
   - Never paste these values into chat, email or GitHub.

The agent then runs the end-to-end test in Test mode:

- monthly and annual checkout with card 4242 4242 4242 4242;
- confirms the 14-day trial;
- checks webhook delivery and signature verification, and the entitlement
  in the database;
- tests the customer portal and cancellation;
- tests the declined-payment card 4000 0000 0000 0341;
- checks that no lifetime option appears anywhere.

## Step 2: Live mode, for production (only after the staging test passes)

Repeat step 1 with **Test mode off**:

- Use the same permissions, and name the key `restpilot-railway-production`
  (`rk_live_…`).
- **Webhook**: if an endpoint
  `https://restpilotai.com/api/public/payments/webhook?env=live` already
  exists, keep it. It is the one Lovable production uses today, and it
  carries on working through the cutover. Reveal its signing secret.
  Otherwise, create it with the same 6 events.
- Use the live publishable key (`pk_live_…`).
- Add the values to Railway **production** (not staging), using the same
  three names: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` and
  `VITE_PAYMENTS_CLIENT_TOKEN`.
- New live checkouts only start on Railway after you approve
  `VITE_STRIPE_CHECKOUT_ENABLED=true` for production, and the domain moves
  only on your separate cutover approval.

## Safety built into the code

- **Mode lock.** The app refuses to start Stripe if the key's mode
  (`rk_test_` or `rk_live_`), the publishable key's mode and
  `PAYMENTS_ENVIRONMENT` disagree. A webhook for the wrong mode is
  rejected.
- **Restricted keys only.** A full `sk_` secret key is refused.
- **Inert when unset.** With no key, nothing talks to Stripe. With a key but
  no checkout switch, renewals, cancellations and the portal work, but no
  new checkout can start.
- The checkout request is identical to production's: monthly or annual
  only, a 14-day trial, and the same customer ownership checks. This is
  locked by `tests/stripe-checkout-regression.test.mjs`.
- The iPhone app keeps showing the App preview screen. In-app purchase is
  handled separately.
- Agents never issue refunds, create charges, change prices or touch any
  other Stripe account.
