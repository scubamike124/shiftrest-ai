
# Security Hardening — Pre-Launch Audit

**Investigation only.** No code changes will be made until you approve.

## Executive Summary

RestPilot's core auth/payment/data plumbing is solid: Supabase Auth with email verification, RLS on user tables, Stripe webhook signature verification, service-role isolation in server-only modules, bearer-token guards on paid AI endpoints, and honeypot on contact form.

However, several **launch-blocking** gaps exist around abuse prevention:
- **Cron endpoints are effectively unauthenticated** — they use the Supabase publishable/anon key, which is public (shipped in every browser).
- **No rate limiting anywhere.** Any signed-in user can burn AI/TTS budget as fast as they can loop `fetch()`; the AI daily token cap is the only backstop.
- **No bot protection** on signup, contact, or reset password.
- **No security response headers** (CSP, HSTS, X-Frame-Options, etc.).
- **No prompt-injection hardening** on AI intents that ingest user-authored strings.

None of these have been exploited (no evidence in logs), but they should be closed before we drive traffic.

## Findings by Risk

### 🔴 CRITICAL — must fix before launch

| # | Area | Finding |
|---|---|---|
| C1 | Cron auth | `/api/public/hooks/{dispatch-alarms,notify,ai-learn,subscription-lifecycle}` and `/api/public/wearables/cron` gate on `SUPABASE_PUBLISHABLE_KEY`. That key is embedded in the client bundle. Anyone can trigger the dispatchers, replay push sends, force wearable syncs, or fire lifecycle emails. |
| C2 | Rate limiting | No per-user, per-IP, or global rate limits on `/api/ai`, `/api/tts`, `/api/tts-elevenlabs`, `/api/stt`, `/api/brief`, `/api/insights`, `/api/swap`, `/api/coach`, or `/api/public/contact`. A signed-in user (or someone who signs up in <10s) can drain AI credits and rack up ElevenLabs/OpenAI spend. |
| C3 | Bot protection | Signup, password reset, and `/api/public/contact` have no CAPTCHA/Turnstile. Contact has a honeypot only. Enables mass fake accounts → AI abuse and email bombing via signup confirmation emails. |
| C4 | Unauth AI endpoints | `/api/swap` and `/api/insights` do not call `requireUser` — they only require `LOVABLE_API_KEY` on the server. Anyone on the internet can POST arbitrary `context` strings and burn AI credits. |

### 🟠 HIGH

| # | Area | Finding |
|---|---|---|
| H1 | Security headers | No CSP, HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, or Permissions-Policy on any response. Clickjacking + MIME sniffing possible. |
| H2 | Prompt injection | `/api/ai` intents (`adjust_plan.observation`, `coach.messages`, memory extraction) concat user text into system prompts with no delimiters, sanitization, or output validation for hidden instructions. |
| H3 | Account enumeration | Default Supabase signup returns distinguishable errors for existing vs. new emails. |
| H4 | Disposable email | No blocklist on signup or `/api/public/contact`. |
| H5 | Owner alert coverage | Owner is notified of AI/TTS/webhook failures but NOT of: repeated 401s on cron endpoints, Stripe webhook signature failures, auth webhook failures, or dispatch-alarm push-send failures. |

### 🟡 MEDIUM

| # | Area | Finding |
|---|---|---|
| M1 | Session settings | Supabase Auth defaults not audited (JWT expiry, refresh rotation, password-strength policy, HIBP leaked-password check). |
| M2 | Audit log | No append-only audit trail for privileged events (role grants, subscription overrides, admin AI overrides). |
| M3 | Error messages | Some routes leak upstream error strings back to client (`error.message` from Supabase / Stripe). |
| M4 | CORS on public API | No explicit CORS headers on `/api/public/*` — currently same-origin only, fine now, but should be explicit before we ever add cross-origin callers. |
| M5 | STT auth | `/api/stt` accepts anonymous requests (userId is optional; logging only). Should require auth like the other paid AI endpoints. |

### 🟢 LOW / already good

- Stripe webhook: HMAC-SHA256 signature + 5-min timestamp tolerance + timing-safe compare ✅
- Service-role key: server-only, no client leaks found ✅
- RLS: enabled on all user-scoped tables ✅
- Payment idempotency: webhook uses `onConflict: 'stripe_subscription_id'` upsert ✅
- Auth email: on-domain callback, DKIM/SPF via Resend ✅
- Input validation: `/api/public/contact` uses Zod ✅
- Contact honeypot: present ✅
- HTTPS: enforced by Cloudflare edge ✅
- File uploads: none in the app (no attack surface) ✅

## Recommended Fixes — Priority Order

### Batch S-1: Auth & Cron Lockdown (LAUNCH BLOCKER)
1. **Fix C1** — Introduce `CRON_SECRET` (generated 64-char secret). Require it in the `x-cron-secret` header on all 5 public cron/hook routes. Update the 4 pg_cron job SQL definitions to send it via `http_post` `headers` (secret pulled from Vault, matching the existing `email_queue_service_role_key` pattern).
2. **Fix C4** — Add `requireUser` to `/api/swap` and `/api/insights` and record via `logAIRequest`.
3. **Fix M5** — Require auth on `/api/stt`.

### Batch S-2: Rate Limiting (LAUNCH BLOCKER)
4. **Fix C2** — Add a lightweight per-user token-bucket rate limiter backed by a new `api_rate_limits` table (rows: `user_id, bucket, window_start, count`). Wrap AI/TTS/STT/brief/coach/swap/insights with `checkRate(userId, bucket, maxPerMinute)`. Limits: AI text 20/min, TTS 10/min, STT 10/min, contact 3/hour per IP.
5. Extend the existing `checkAIBudget` to also enforce a short-window (5-min) token ceiling for free users.

### Batch S-3: Bot Protection (LAUNCH BLOCKER)
6. **Fix C3** — Add Cloudflare Turnstile to `/auth` (signup + reset flows) and `/contact`. Verify on server via `/api/public/turnstile-verify` before allowing signup email send or contact submission. Requires user to add `TURNSTILE_SITE_KEY` (public) + `TURNSTILE_SECRET_KEY` (secret).
7. **Fix H4** — Ship a disposable-email blocklist check (embedded list, no external calls) in `/api/public/contact` and gate signup via a client-side check on `/auth`.

### Batch S-4: Response Headers (HIGH)
8. **Fix H1** — Add a global response-header middleware in `src/start.ts` that injects: `Strict-Transport-Security`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy: camera=(), microphone=(self), geolocation=()`, and a report-only CSP for one week before enforcement.

### Batch S-5: AI Abuse Hardening (HIGH)
9. **Fix H2** — Wrap all user-supplied strings passed to the AI in explicit `<user_input>...</user_input>` delimiters + a system-prompt instruction to ignore any embedded instructions inside those tags. Truncate `observation`, `context`, message content to hard caps (2000 chars).
10. **Fix H5** — Extend `notifyOwner` calls to Stripe webhook signature failure branch, auth webhook 500 branch, dispatch-alarm push failure branch, and cron 401 burst detection.

### Batch S-6: Auth Config Polish (MEDIUM)
11. **Fix H3 + M1** — Enable leaked-password check (HIBP), enforce 12-char min password, confirm JWT expiry ≤ 1h + refresh rotation, and enable Supabase's built-in signup rate limit + account enumeration protection via `configure_auth`.
12. **Fix M2** — Add `audit_log` table for role grants and admin overrides (append-only, RLS admin-read-only).
13. **Fix M3** — Replace raw `error.message` returns with generic strings; log the detail server-side only.
14. **Fix M4** — Add explicit `Vary: Origin` + no-CORS-headers policy documentation.

## File-by-File Implementation Plan

| File | Change |
|---|---|
| `src/lib/api/cron-auth.server.ts` (new) | `requireCronSecret(request)` helper |
| `src/routes/api/public/hooks/dispatch-alarms.ts` | Swap apikey check → `requireCronSecret` |
| `src/routes/api/public/hooks/notify.ts` | Same |
| `src/routes/api/public/hooks/ai-learn.ts` | Same |
| `src/routes/api/public/hooks/subscription-lifecycle.ts` | Same |
| `src/routes/api/public/wearables/cron.ts` | Same |
| pg_cron migration | Update 4 job definitions to send `x-cron-secret` from Vault |
| `src/lib/api/rate-limit.server.ts` (new) | `checkRate(userId, bucket, maxPerWindow, windowSec)` using new table |
| Supabase migration | `api_rate_limits` table + GRANT + RLS (service_role only) |
| `src/routes/api/ai.ts` | Add rate check after `requireUser` |
| `src/routes/api/tts.ts`, `tts-elevenlabs.ts`, `stt.ts`, `brief.ts`, `insights.ts`, `swap.ts`, `coach.ts` | Add `requireUser` (where missing) + rate check |
| `src/routes/api/public/contact.ts` | Per-IP rate limit + Turnstile verify + disposable-email check |
| `src/lib/turnstile.server.ts` (new) | Turnstile verify helper |
| `src/routes/api/public/turnstile-verify.ts` (new) | Turnstile server verify endpoint (used by client before signup) |
| `src/components/auth/*` | Add Turnstile widget to signup + reset forms |
| `src/start.ts` | Add response-header `requestMiddleware` |
| `src/lib/ai/context.server.ts` + `prompts.server.ts` | Add `<user_input>` delimiters + injection-defense system instruction |
| `src/routes/api/ai.ts` | Truncate user-supplied strings to 2000 chars |
| `src/lib/ops/alert.server.ts` callers | Extend to webhook signature failures, cron 401 bursts, push failures |
| `configure_auth` call | Enable HIBP, set password policy, signup rate limit |
| Supabase migration | `audit_log` table |
| 2 new secrets | `CRON_SECRET` (generate), `TURNSTILE_SECRET_KEY` (user-supplied), `TURNSTILE_SITE_KEY` (user-supplied, public) |

## Effort Estimate

| Batch | Scope | Effort |
|---|---|---|
| S-1 Cron lockdown | 5 routes + 1 migration + secret | 1 turn |
| S-2 Rate limiting | new table + helper + 8 routes | 2 turns |
| S-3 Bot protection | Turnstile plumbing + signup UI + blocklist | 2 turns |
| S-4 Headers | 1 middleware | 1 turn |
| S-5 AI hardening | prompt updates + owner alerts | 1 turn |
| S-6 Auth polish | `configure_auth` + audit_log + cleanup | 1 turn |

**Total: ~8 turns of focused work.**

## Launch Gate

- **BLOCKING (must ship before launch):** Batches S-1, S-2, S-3.
- **STRONGLY RECOMMENDED before public marketing push:** Batches S-4, S-5.
- **Post-launch acceptable:** Batch S-6 (except HIBP toggle — do that now, it's a one-tool call).

## Already Production-Ready

Stripe webhook verification, service-role isolation, RLS coverage, auth-email pipeline, contact honeypot, HTTPS enforcement, JWT-based session model, error boundaries, robots/sitemap, secret separation (runtime vs client vs build).

---

**Awaiting your approval.** Reply with which batches to run and in what order (default recommendation: S-1 → S-2 → S-3 → S-4 → S-5 → S-6, one at a time, verifying build ID between each).
