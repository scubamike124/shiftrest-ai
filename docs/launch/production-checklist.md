# Production Checklist

## Environment

- [x] `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY` configured.
- [x] `STRIPE_LIVE_API_KEY` + `STRIPE_SANDBOX_API_KEY` configured (connector-managed).
- [x] `PAYMENTS_LIVE_WEBHOOK_SECRET` + `PAYMENTS_SANDBOX_WEBHOOK_SECRET` configured.
- [x] `LOVABLE_API_KEY` configured.
- [x] `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` configured.
- [x] `.env` contains only publishable keys.

## Database

- [x] All 18 migrations applied.
- [x] RLS enabled on every public table.
- [x] Phase 1 security migration applied (server-only writes for `ai_log`, `notification_log`, `wearable_connections`).
- [ ] Run `supabase--linter` immediately before publish — confirm only the two known advisories remain.

## Stripe

- [x] Live webhook endpoint configured at `https://shift-rest-ai.lovable.app/api/public/payments/webhook?env=live`.
- [x] Webhook signature verification via `verifyWebhook` (HMAC + tolerance window).
- [ ] Run a live test charge on a $1 product before announcing.
- [ ] Confirm customer portal cancellation propagates through `customer.subscription.updated` webhook.

## Auth

- [x] Email/password + Google OAuth via Lovable broker.
- [x] No anonymous sign-ups.
- [x] Email confirmation enabled.
- [x] Protected subtree gated by `_authenticated/route.tsx`.

## Domain & SSL

- [x] `shift-rest-ai.lovable.app` live; SSL via Lovable edge.
- [ ] (Optional) attach custom domain via project settings.

## Monitoring

- [x] `reportLovableError` wired in root error boundary.
- [x] `ai_log`, `notification_log`, `legal_acceptances` provide audit coverage.
- [ ] Manually verify push delivery on iOS Safari + Android Chrome after install.

## Backups & Recovery

- Lovable Cloud manages daily Supabase backups automatically; PITR available.
- `exportAccountFn` provides user-initiated data portability.

## Final go/no-go gates

1. Phase 1 security findings — **CLEAR**.
2. Legal & consent flows — **CLEAR** (see privacy verification report).
3. Live Stripe charge — **PENDING manual test**.
4. Lighthouse + axe sweeps — **PENDING**.
