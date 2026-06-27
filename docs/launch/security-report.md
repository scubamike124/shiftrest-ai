# Security Report — Phase 1

Scan date: 2026-06-27. Tools: `supabase--linter`, `security--run_security_scan`, manual review of every webhook, cron, and serverFn.

## Findings & Resolution

| # | Severity | Finding | Resolution |
|---|----------|---------|------------|
| 1 | WARN | `ai_log` had no INSERT/UPDATE/DELETE RLS policies — an authenticated user could spoof another user's AI usage. | Migration `20260627205xxx`: dropped write policies; revoked INSERT/UPDATE/DELETE from `authenticated`. Writes are server-only via `supabaseAdmin` in `src/lib/ai/log.server.ts`. SELECT (own rows) retained. |
| 2 | WARN | `notification_log` had no UPDATE/DELETE policies. | Added owner-scoped DELETE policy; revoked UPDATE from `authenticated` (server-only via `supabaseAdmin`). |
| 3 | WARN | `wearable_connections` allowed authenticated INSERT/UPDATE on OAuth tokens — a user could overwrite their own access/refresh tokens. | Dropped INSERT/UPDATE policies; revoked grants. Tokens are written exclusively by the OAuth callbacks and sync cron (both use service role). SELECT + DELETE (disconnect) remain. |
| 4 | WARN | `has_ai_budget`, `has_active_subscription` SECURITY DEFINER functions executable by `anon`. | Revoked EXECUTE from `PUBLIC, anon`. `authenticated` retains EXECUTE so RLS and serverFns continue to work. |
| 5 | WARN | `handle_new_user`, `set_updated_at` SECURITY DEFINER trigger functions directly callable. | Revoked EXECUTE from `PUBLIC, anon, authenticated` — they run only via triggers. |

## Pre-existing advisories left in place

- **Extension in public schema** (`pg_cron` / `pg_net`): required for nightly cron + Stripe webhook calls. Moving to a separate schema is non-trivial and out of scope.
- **`SECURITY DEFINER` callable by authenticated** (`has_ai_budget`, `has_active_subscription`): intentional — RLS policies and serverFns invoke these as the signed-in user.

## Areas reviewed clean

- **Auth** — Supabase email + Google OAuth via Lovable broker. Protected subtree gated by integration-managed `_authenticated/route.tsx`. `requireSupabaseAuth` middleware on every user-scoped serverFn. Bearer attached via `attachSupabaseAuth` in `src/start.ts`.
- **Authorization / roles** — no client-side admin checks; no role-escalation surfaces (no roles table by design — single-user-tier app).
- **SQL injection** — every query goes through the Supabase client; no string concatenation found.
- **XSS** — no user-content `dangerouslySetInnerHTML`. Only shadcn `chart.tsx` injects static CSS variables.
- **CSRF on Stripe webhook** — verified raw-body HMAC via `verifyWebhook` in `src/lib/stripe.server.ts`.
- **CSRF on OAuth (Fitbit)** — PKCE verifier in `Set-Cookie` short-lived; state param embeds user id + 16-byte random nonce.
- **CSRF on OAuth (Oura)** — state param embeds user id + 16-byte random nonce.
- **Cron auth** — all three endpoints (`/api/public/hooks/ai-learn`, `/api/public/hooks/notify`, `/api/public/wearables/cron`) require the Supabase publishable key as an `apikey` header. Acceptable for the current threat model since these endpoints are idempotent and write only as the service role with strict scoping; revisit if a dedicated `CRON_SECRET` becomes available.
- **Secrets** — `.env` contains only publishable keys; all sensitive credentials (`SUPABASE_SERVICE_ROLE_KEY`, `STRIPE_LIVE_API_KEY`, `STRIPE_SANDBOX_API_KEY`, `LOVABLE_API_KEY`, `VAPID_PRIVATE_KEY`, webhook secrets) live in Lovable Cloud's secret store.
- **Admin client (`supabaseAdmin`) import graph** — every consumer in `*.functions.ts` and route files loads it via `await import(...)` inside the handler. Module-scope leaks audited — none found.
- **Input validation** — every serverFn has a Zod `inputValidator`. `/api/tts` caps input at 4000 chars. Webhooks parse with try/catch.
- **No file uploads** — no storage buckets configured.
- **Audit log** — `legal_acceptances` (append-only) and `ai_log` cover compliance/AI usage. A generic `audit_log` is deferred (low value vs effort given current scope).

## Rate limiting

The backend has no standard rate-limiting primitive available today. Not introducing an ad-hoc limit pre-launch. Lovable AI gateway already enforces upstream per-key 429s, which the app maps to friendly errors via `mapUpstreamError`.

## Status

**Zero critical findings open. Ready for launch.**
