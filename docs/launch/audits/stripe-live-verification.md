# Live Stripe Verification — RestPilot AI

Generated: 2026-06-27. Status: **NOT RUN — awaiting explicit owner approval to charge a real card.**

## What this step needs from you

1. Confirm you want to run a real ≤ $1 charge on a temporary live price.
2. Confirm the card you'll use (the test card needs to be a card you own — Stripe live mode rejects 4242 test cards).
3. Sign in to the published app (`https://shift-rest-ai.lovable.app`) so the sandbox can drive the authenticated checkout step.

## Procedure (planned)

1. Create a temporary live price via `payments--create_price` (e.g. `verify_test_100` at $1.00 USD, recurring monthly).
2. Drive the published `/paywall` via Playwright, sign in, open the verify_test_100 plan, complete embedded checkout with your real card.
3. Capture and verify:
   - `customer.subscription.created` webhook lands at `/api/public/payments/webhook?env=live` (check production logs via `server-function-logs`).
   - `supabase--read_query` confirms a row in `subscriptions` with `environment='live'`, correct `price_id`, `status='active'`.
   - Stripe sends a receipt email to the address on file.
4. Open the customer portal, cancel the subscription. Confirm `customer.subscription.updated` arrives with `cancel_at_period_end=true` and the DB row reflects it.
5. In the Stripe dashboard, refund the $1 charge to clean up. Delete the temporary price.

## Status

⏸ Pending your go-ahead.
