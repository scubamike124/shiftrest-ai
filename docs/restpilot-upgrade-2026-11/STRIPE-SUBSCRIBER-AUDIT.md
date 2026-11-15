# Stripe subscriber audit kit (read-only)

_Nov 15 2026. Owner decision: new purchases move to Apple's App Store subscriptions. **Before any Stripe billing code, secret, webhook or setting is switched off, count the existing Stripe subscribers and keep everything they need running.** This kit only reads. Nothing in it cancels, refunds, changes or emails anyone._

Who runs it: the owner. The engineering agents have no database or Stripe access, and did not run any of it.

## What you get from this audit

| Question | Where the answer comes from |
|---|---|
| How many people pay through Stripe today, on which plan and status (active, trialing, past due, canceled, lifetime)? | Step 1, query 1 (database) and Step 2 (Stripe) |
| How many of them still have Premium right now? | Step 1, query 2 |
| Does anyone have two renewing Stripe subscriptions? | Step 1, query 3 |
| Do the database and Stripe agree? | Step 3 (compare the two counts) |

The counts tell you how long the Stripe pieces in section (c) must keep running. They must keep running **until the last Stripe subscription has ended**, whatever the counts say. Lifetime members never end: their access must be honored for good.

---

## (a) Step 1: the database counts (Lovable SQL editor)

Open it on iPhone: Lovable → your RestPilot project → **More** (⋯) → **Database** → **Manage** → **SQL editor**. Paste one query at a time, then tap **Run**.

Each query below only reads (`select`). None of them shows an email, a name, a user ID or a Stripe ID. They return counts.

### Query 1: subscriptions by environment, plan and status

```sql
-- READ-ONLY. Counts only, no personal data.
select
  environment,                                   -- 'live' = real money, 'sandbox' = test
  price_id,                                      -- restpilot_monthly / restpilot_annual / restpilot_lifetime
  status,                                        -- active, trialing, past_due, unpaid, canceled, incomplete, lifetime, ...
  case
    when status = 'lifetime'          then 'lifetime (never ends)'
    when current_period_end is null   then 'no period end'
    when current_period_end > now()   then 'period still running'
    else 'period ended'
  end                                            as period,
  count(*) filter (where cancel_at_period_end)   as set_to_cancel_at_period_end,
  count(*)                                       as subscriptions,
  count(distinct user_id)                        as people
from public.subscriptions
group by 1, 2, 3, 4
order by 1, 2, 3, 4;
```

How to read it:
- Look at the `live` rows. `sandbox` rows are tests.
- `active` / `trialing` with "period still running": paying (or in a free trial) and renewing, unless `set_to_cancel_at_period_end` counts them.
- `past_due` / `unpaid`: Stripe could not charge their card and is retrying. They are still Stripe customers and can still be charged when they fix the card. **They are the people the Profile "Manage billing" fix (section c) is for.**
- `canceled` with "period still running": canceled but paid through the end of the period; access continues until then.
- `lifetime`: one-time $99 purchases. No longer sold, honored forever.

### Query 2: who has Premium right now (same rule as the app)

```sql
-- READ-ONLY. Same access rule as public.has_active_subscription().
select
  environment,
  case
    when status = 'lifetime' then 'lifetime'
    when status in ('active', 'trialing')
         and (current_period_end is null or current_period_end > now()) then status
    when status = 'canceled'
         and current_period_end is not null and current_period_end > now() then 'canceled, paid through period end'
    else 'no access from this row'
  end                     as access,
  count(distinct user_id) as people
from public.subscriptions
group by 1, 2
order by 1, 2;
```

### Query 3: possible double billing inside Stripe

```sql
-- READ-ONLY. People with more than one Stripe subscription that can still charge them.
select environment, count(*) as people_with_2_or_more
from (
  select environment, user_id
  from public.subscriptions
  where status in ('active', 'trialing', 'past_due', 'unpaid', 'incomplete')
    and cancel_at_period_end is not true
  group by environment, user_id
  having count(*) > 1
) dup
group by environment;
```

No rows back means nobody. If there are some, look them up in Stripe (Step 2) before deciding anything; do not cancel from the database.

### Optional, only if you choose to see who they are

The queries above are deliberately anonymous. If you decide you need to contact or look up the past-due customers, this one lists their Stripe customer IDs (search them in Stripe). It still shows no email. Add `, u.email` and `join auth.users u on u.id = s.user_id` yourself only if you want emails on screen; treat the result as personal data and do not paste it into chats or tickets.

```sql
-- READ-ONLY. Shows Stripe customer IDs: personal data, owner's choice.
select s.stripe_customer_id, s.price_id, s.status, s.current_period_end
from public.subscriptions s
where s.environment = 'live' and s.status in ('past_due', 'unpaid', 'incomplete')
order by s.current_period_end nulls last;
```

## (b) Step 2: the Stripe counts (Stripe dashboard on iPhone)

The Stripe account is the one connected to Lovable Payments. Use Safari at **dashboard.stripe.com** (the Stripe iPhone app shows subscriptions but cannot export). Make sure the **Test mode** switch is **off**, so you see live data.

1. Tap the menu (☰) → **Billing** → **Subscriptions**. (In newer layouts: **Product catalog / Billing** → **Subscriptions**.)
2. Tap the **Status** filter and pick one status at a time, writing down the total shown at the bottom of the list:
   - **Active**
   - **Trialing**
   - **Past due**
   - **Unpaid**
   - **Canceled** (optionally narrow with the **Created** or **Canceled** date filter)
   - **Incomplete** / **Incomplete expired** (abandoned checkouts; normally no access)
   - **Paused**, if it appears
3. Optional per plan: add the **Price** or **Product** filter (RestPilot Monthly, RestPilot Annual) to split each count.
4. **Lifetime members are not subscriptions.** They were one-time payments. Find them under **Payments** → filter **Status: Succeeded**, search "Lifetime" or filter by the lifetime product/price. Their count should match the `lifetime` rows of query 1.
5. **Export:** on the Subscriptions list tap **Export** (top right; on a phone, Safari's **aA** → **Request Desktop Website** shows it). Choose **All** (or the current filter), the default columns, and **Export**. Stripe emails or downloads a CSV. The file contains customer emails: keep it in your Files app or iCloud Drive, do not share it.
6. Optional check of the renewal setting, **without changing it**: **Settings** → **Billing** → **Subscriptions and emails** → **Manage failed payments**. Note what happens after the last retry (cancel, mark unpaid, or leave past due). This decides how long past-due customers stay past due.
7. Optional check of the Customer Portal, **without changing it**: **Settings** → **Billing** → **Customer portal**. It must stay **active** and allow **update payment method**, **cancel subscription** and **view invoices**, because Profile → "Manage subscription" / "Manage billing" opens it.

## Step 3: compare

- Database query 1 (`live`, per status) and Stripe Step 2 should match within a few rows.
- A Stripe subscription with no database row usually means a webhook delivery failed. Check **Developers** → **Webhooks** → the RestPilot endpoint → **Failed** deliveries, and resend from there (resending is safe: our webhook upserts by subscription ID).
- Record the counts and date in this file or in a private note. They are the baseline for the cut-over.

---

## (c) What must stay running for existing Stripe subscribers

Removing Stripe from **new** purchases does not stop Stripe billing **existing** customers. Stripe keeps renewing them on its own schedule. RestPilot's job is to keep their status in sync, let them manage or cancel, and honor lifetime. All of this stays in the code and must stay configured:

| Piece | Where | Why it must stay |
|---|---|---|
| **Stripe webhook route** | `src/routes/api/public/payments/webhook.ts` → `POST /api/public/payments/webhook?env=live` (and `?env=sandbox`) | The only path that records renewals, cancellations, payment failures and plan changes in `public.subscriptions`. Without it, a renewed customer's period end stops moving and they **lose Premium while still paying**. |
| Its handlers | same file: `customer.subscription.created`, `customer.subscription.updated` (renewals, `past_due`, cancel-at-period-end, plan changes), `customer.subscription.deleted` (final cancel), `checkout.session.completed` (lifetime rows), `invoice.payment_failed` (failed-payment email + owner alert) | Renewal/cancel sync and dunning emails. |
| Webhook signature check | `verifyWebhook` in `src/lib/stripe.server.ts` with the `PAYMENTS_LIVE_WEBHOOK_SECRET` / `PAYMENTS_SANDBOX_WEBHOOK_SECRET` secrets | Rejects forged events. |
| The Stripe endpoint itself | Stripe → Developers → Webhooks: the RestPilot endpoint (`…/api/public/payments/webhook?env=live`) and its events | Stripe must keep delivering. |
| **Customer Portal from Profile** | `createPortalSession` in `src/lib/billing.functions.ts`; Profile button | Lets existing subscribers update their card, see invoices and cancel. |
| **Past-due fix** (shipped with the web-checkout PR) | `src/routes/profile.tsx`, `src/lib/subscription.ts` | Before: a `past_due` / `unpaid` subscriber was not "Premium", so Profile showed **"Upgrade to Premium"** (a path to a *second* subscription) and **no way to fix the card or cancel**. After: they see their plan with **"Payment problem"** and a **"Manage billing"** button into the Stripe portal. |
| Daily lifecycle sweep | `src/routes/api/public/hooks/subscription-lifecycle.ts` (pg_cron) | Trial-ending and access-ended emails for Stripe rows. |
| **Account deletion's Stripe cancel** | `attemptStripeCancel` in `src/lib/account.functions.ts` | Deleting an account must stop Stripe charging that person. Without it, a deleted user keeps being billed. |
| Premium checks that read Stripe rows | `public.has_active_subscription` / `has_ai_budget` (SQL), `getSubscriptionState` (`src/lib/subscription.ts`) | How Stripe subscribers (and lifetime members) get Premium. |
| Secrets and build values | `STRIPE_LIVE_API_KEY`, `STRIPE_SANDBOX_API_KEY`, `LOVABLE_API_KEY` (Stripe goes through Lovable's gateway), `PAYMENTS_LIVE_WEBHOOK_SECRET`, `PAYMENTS_SANDBOX_WEBHOOK_SECRET`, and `VITE_PAYMENTS_CLIENT_TOKEN` in `.env.production` | The portal, deletion cancel and webhook need the keys. The publishable token is also how the site knows which Stripe environment to read: **without it every Stripe subscriber, lifetime included, shows as Free and "Manage subscription" fails.** |
| Table | `public.subscriptions` | The record of every Stripe customer's access. |

## (d) What NOT to disable, delete or change

Until the last Stripe subscription has ended (lifetime: never):

- **Do not** cancel, pause or migrate any Stripe subscription, and do not change prices or products that existing subscribers are on. (Archiving a price stops *new* sales only, but there is no need: the website flag already stops new purchases.)
- **Do not** delete or disable the Stripe webhook endpoint, remove its events, or rotate its signing secret without updating `PAYMENTS_LIVE_WEBHOOK_SECRET` at the same moment.
- **Do not** remove `STRIPE_LIVE_API_KEY`, `LOVABLE_API_KEY`, the webhook secrets, or `VITE_PAYMENTS_CLIENT_TOKEN`.
- **Do not** disconnect Stripe from Lovable Payments or deactivate the Stripe account.
- **Do not** turn off the Stripe Customer Portal or remove "update payment method" / "cancel" from it.
- **Do not** delete or rewrite rows in `public.subscriptions` (lifetime rows especially: they are the only record of a lifetime purchase).
- **Do not** remove `src/routes/api/public/payments/webhook.ts`, `src/lib/stripe.server.ts`, `createPortalSession`, `attemptStripeCancel` or the lifecycle sweep.
- **Do not** change "Manage failed payments" / Smart Retries in Stripe as part of this switch.
- It is fine to leave `createCheckoutSession` in the code: with `VITE_WEB_CHECKOUT_ENABLED` off it refuses every new purchase on the server before any Stripe call.

### When Stripe can finally be retired (later, owner decision)

Only when query 2 shows **no** `live` monthly/annual access, Stripe shows **0** Active / Trialing / Past due / Unpaid, and you have a plan for lifetime members that does not depend on Stripe (their access is the `lifetime` row in `public.subscriptions`, which needs no Stripe call to keep working). Even then, keep the webhook endpoint for a while to record late refunds or disputes.
