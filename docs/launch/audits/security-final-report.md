# Final Security Verification — RestPilot AI

Generated: 2026-06-27.

## Automated scans

- **`supabase--linter`** — 2 WARN advisories remain, both intentional and documented:
  1. `Extension in Public` — `pg_cron` lives in the `public` schema. Moving it requires Supabase support and is unsupported on Lovable Cloud. No app exposure.
  2. `Signed-In Users Can Execute SECURITY DEFINER Function` — `has_active_subscription` and `has_ai_budget`. Both are read-only existence checks scoped to the calling `user_uuid`; required for RLS evaluation in server functions. Documented in the Phase 1 report.
- No new CRITICAL or ERROR findings since Phase 1 hardening.

## RLS / DB permissions spot-check

- Every public table has RLS enabled (verified via `SELECT relrowsecurity FROM pg_class WHERE relnamespace='public'::regnamespace` during Phase 1, unchanged).
- Phase 1 lockdowns still in place: `ai_log`, `notification_log`, `wearable_connections` writes are server-only; `has_ai_budget` / `has_active_subscription` no longer EXECUTE-able by `PUBLIC` / `anon`; trigger helpers EXECUTE removed.

## Webhooks

- `src/lib/stripe.server.ts::verifyWebhook` unchanged: HMAC-SHA256 over `t.body`, 5-minute timestamp tolerance, supports multi-`v1=` signatures during rotation. Verified by reading the file this turn.
- Wearable OAuth callbacks under `src/routes/api/public/wearables/*/callback.ts` still enforce state nonce / PKCE — not modified since Phase 1.

## Service-role usage

- `supabaseAdmin` is imported only via the lazy `await import('@/integrations/supabase/client.server')` pattern inside server-route handlers, or at module scope of other `*.server.ts` files. No client-bundle exposure.

## Secrets inventory

Matches Phase 1 expected set: `LOVABLE_API_KEY`, `PAYMENTS_LIVE_WEBHOOK_SECRET`, `PAYMENTS_SANDBOX_WEBHOOK_SECRET`, `STRIPE_LIVE_API_KEY` (connector-managed), `STRIPE_SANDBOX_API_KEY` (connector-managed), `VAPID_*`, `SUPABASE_*`. No extra secrets, no unexpected service tokens.

## Rate limiting

Not currently enforced on `/api/coach`, `/api/ai`, `/api/tts`. Risk is mitigated by the per-user `has_ai_budget` token cap (60k tokens / 24 h via `user_prefs.ai_daily_token_cap`), which blocks runaway costs. Adding an edge-layer rate limit (token bucket keyed by `userId`) is tracked in `remaining-issues.md` as a post-launch hardening item; not a blocker.

## Status

Production security posture **unchanged and acceptable** from Phase 1. No regressions introduced this phase. Two advisory warnings remain intentional.
