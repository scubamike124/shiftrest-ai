# Pre-Launch Hardening — Investigation Report

Investigation only. No code changes. Findings sorted by category with risk, files, and effort. Recommended implementation order at the end.

---

## 1. Executive Summary

RestPilot is functionally launch-ready. Public surface, legal, RLS baseline, Stripe webhook, and observability primitives (`ops_alert`, `notifyOwner`, `reportLovableError`) are already in place. The gaps that remain are **hardening**, not features:

- **No per-user rate limiting** on the expensive AI/TTS/STT endpoints. `has_ai_budget` (60k tokens / 24h) is the only ceiling — a signed-in user can still burst hundreds of requests/min.
- **No bot protection** on the public contact form beyond a honeypot; auth pages have no captcha.
- **No uptime monitor**. `notifyOwner` fires from inside the app — if the app is down, no alert.
- **No auth-failure or error-rate alerting**. `ops_alert` records but nothing escalates on spikes.
- **Console noise + a few dead deps** in the client bundle.
- **Admin surface**: `has_role` exists in DB but no UI/route gate uses it yet (there is no admin dashboard route to protect — becomes relevant only once an owner dashboard is built, see §2).

None of the findings below are launch-blockers on their own. The highest-value pre-launch batch is: **rate limit AI endpoints + external uptime monitor + auth-failure alerts + console cleanup**. Everything else is post-launch-safe.

---

## 2. Findings

### A. Security Hardening

| # | Finding | Risk | Files | Fix |
|---|---|---|---|---|
| A1 | **No rate limiting on AI endpoints.** `/api/ai`, `/api/brief`, `/api/coach`, `/api/insights`, `/api/tts`, `/api/tts-elevenlabs`, `/api/stt`, `/api/swap` all fall through to `has_ai_budget` only. A user can burn 60k tokens in seconds and cost real money on the gateway. | **High** | `src/routes/api/{ai,brief,coach,insights,tts,tts-elevenlabs,stt,swap}.ts` | Add a shared token-bucket in `src/lib/ratelimit.server.ts` keyed by `userId` (fallback IP) backed by a `rate_limit_bucket` Postgres table (upsert + window). Return HTTP 429 with `Retry-After`. |
| A2 | **Public contact form has honeypot only.** Determined bots trivially bypass. | Medium | `src/routes/api/public/contact.ts` | Add Cloudflare Turnstile (free, privacy-friendly). Site key public, secret via `add_secret`. Verify token server-side before enqueueing email. |
| A3 | **Auth pages have no bot protection.** Credential-stuffing risk on `/auth`. | Medium | `src/routes/auth.tsx` | Turnstile on signup + password-reset only (not on returning-user login to keep UX; add if abuse observed). Enable Supabase HIBP + leaked-password check via `configure_auth`. |
| A4 | **No Supabase leaked-password (HIBP) check.** | Low | Supabase Auth config | `supabase--configure_auth { password_hibp_enabled: true }`. |
| A5 | **API key exposure audit.** Publishable keys in `.env` / `.env.production` are correct (`VITE_*`, `pk_live_*`). No service keys leak to client bundle. `LOVABLE_BROWSER_*` variables not referenced from client code. | Low — confirmed clean | `.env`, `.env.production` | None. |
| A6 | **RLS + GRANT baseline.** Phase 1 migration applied per launch checklist. No obvious tables missing RLS in `types.ts` search. Recommend running `security--run_security_scan` before launch as a final check. | Low | — | Run scan; address anything new. |
| A7 | **Admin route protection.** `has_role` DB helper exists; no admin route currently. If an owner dashboard is added (§B4), it MUST live under `_authenticated/_admin/` with a `beforeLoad` gate calling `has_role`. | Low (not-yet-a-surface) | future `_authenticated/_admin/*` | Enforce at both route gate AND server-fn (defence in depth). |
| A8 | **Stripe webhook.** `verifyWebhook` uses HMAC-SHA256 timing-safe compare with 5-min replay window, per-env secrets, and `env=` query switch. Solid. `notifyOwner` on failure. | Low — confirmed clean | `src/routes/api/public/payments/webhook.ts` | None. |
| A9 | **Production env config.** Secret inventory (from `<secrets>`) is complete; publishable client token is `pk_live_*`. `.env.production` present. | Low | — | None. |
| A10 | **`/api/lab/simli/*` shipped to production.** Lab endpoints are prototype paths; if they're not needed for launch they're extra attack surface. | Low | `src/routes/api/lab/simli/{session,speak}.ts`, `src/routes/lab.*.tsx`, `src/routes/_authenticated/lab.pilot-realtime.tsx` | Gate behind `has_role('tester')` or a build-time `VITE_ENABLE_LAB` flag. |
| A11 | **CORS / origin lock on public webhooks.** Wearable OAuth callbacks under `/api/public/wearables/*` accept from any origin. Signature/state-nonce verification is the correct control (confirm each handler validates `state`). | Medium (worth spot-check) | `src/routes/api/public/wearables/{fitbit,oura}/callback.ts`, `src/routes/api/public/wearables/cron.ts` | Verify OAuth `state` nonce is compared and single-use; wearable cron requires `CRON_SECRET` bearer. |

### B. Production Monitoring & Alerts

Existing primitives:
- `ops_alert` table with in-memory 10-min dedupe (`src/lib/ops/alert.server.ts`).
- `notifyOwner` sends the `ops-alert` transactional email to `OWNER_ALERT_EMAIL`.
- `reportLovableError` posts client errors to `window.__lovableEvents`.
- Server-side `errorMiddleware` in `src/start.ts` already pages on unhandled 500s.
- Stripe webhook + AI endpoints call `notifyOwnerAsync` on failure.

| # | Gap | Risk | Recommendation | Effort |
|---|---|---|---|---|
| B1 | **No external uptime monitor.** If the Worker is down, `notifyOwner` can't fire. | High | Register **UptimeRobot** (free, 5-min interval) or **Better Stack Uptime** (free tier, 3-min) against `https://restpilotai.com/api/public/health` and `/api/public/version`. Alert to `OWNER_ALERT_EMAIL`. Zero code — external config only. | 15 min |
| B2 | **No auth-failure alerts.** Failed logins/signups aren't recorded or escalated. | Medium | Add a `notifyOwner('warning','auth.failed', ...)` call on repeated failures. Ideally a nightly query summarising `auth.audit_log_entries` events for the last 24h and paging if count > threshold. | 1 h |
| B3 | **No error-rate / spike detection.** `ops_alert` has per-key dedupe but no aggregate escalation. | Medium | Add a Supabase cron (`pg_cron`) that runs every 5 min and calls a public route (`/api/public/hooks/ops-monitor` with `CRON_SECRET`) which counts recent `ops_alert` rows by service and pages `critical` if a service exceeds N alerts / 15 min. | 2 h |
| B4 | **No owner dashboard.** Currently the owner has to read email to know what's happening. | Medium | Add `/_authenticated/_admin/ops` route gated by `has_role('admin')` listing recent `ops_alert`, `email_send_log` (already deduped by `message_id`), `ai_log` totals, and Stripe subscription state. Ship this AFTER §A1/A7. | 4 h |
| B5 | **AI provider / TTS / STT / Voice-provider failures** already flow through `notifyOwnerAsync` — good. Verify Smart Alarm dispatch path (`/api/public/hooks/dispatch-alarms.ts`) also pages. Confirmed: it does. | Low — confirmed | — | None. |
| B6 | **Storage failures / DB failures.** Supabase managed backups + platform-level DB monitoring exist; app-level surface via `notifyOwner('critical','db.*', ...)` in privileged paths where writes could silently fail. Spot-check `subscriptions`, `email_send_log`, `alarm_*` upserts. | Low | Add `.throwOnError()` where safe and wrap in `try/notifyOwnerAsync`. | 1 h |
| B7 | **Alert cooldowns / escalation.** 10-min per-key dedupe is fine for now. Add a `severity=critical` bypass (already partially bypassed since `ops_alert` row is written regardless), and a second escalation address for `critical` after the app has 24h of real production traffic. | Low | Add `OWNER_ALERT_ESCALATION_EMAIL` optional secret. | 30 min |
| B8 | **Alert history**: `ops_alert` rows exist; §B4 exposes them. | — | Covered by B4. | — |

**Recommended provider stack (cheapest, no new deps):**
- Uptime: **UptimeRobot free** (external ping, email alert).
- App-internal alerts: existing `ops_alert` + `notifyOwner` + `pg_cron` monitor route.
- Client-side error capture: existing `__lovableEvents` from the Lovable runtime — no Sentry needed for launch.

### C. Production Cleanup

| # | Finding | Impact | Files | Fix |
|---|---|---|---|---|
| C1 | **Console noise in production code.** ~15 `console.log/debug/info` calls in client-reachable paths (`src/lib/pwa/register.ts`, `src/routes/lovable/*`, `src/routes/api/*`, `src/routes/api/lab/simli/session.ts`, `src/lib/alarm/foreground.ts`). Server-side logs are fine; client-side ones bloat bundles and pollute DevTools. | Low (perf) / Medium (polish) | see rg output | Replace client-side `console.log` with `import.meta.env.DEV` guards or delete. Keep `console.error/warn`. |
| C2 | **`react-email` + `@react-email/components`** are dev-time template authoring tools — verify they don't ship in the runtime bundle. | Low | `package.json` | Confirm via `bun run build` chunk inspection; move to `devDependencies` if only used in Node scripts. |
| C3 | **`simli-client`, `@react-three/*`, `livekit-client`** are used in `/lab.*` routes only. If lab routes are gated per A10, these become admin-only chunks (they already code-split via route boundary, verify). | Low (already lazy) | route bundles | Verify with build; no action if already isolated. |
| C4 | **Dead lab pages** (`lab.avatar-poc.*`, `lab.pilot-realtime`) if not part of launch — remove or gate. | Low | see A10 | Tied to A10. |
| C5 | **Build / TS / lint warnings** — run `bun run build` + `bun run lint` and address any warnings. Baseline unknown until run. | Low | — | Run and triage. |
| C6 | **Duplicate SDK usage patterns**: several routes create their own `createClient(url, service_role)` inline rather than importing `supabaseAdmin` from `client.server`. Not a bug but drifts from convention. | Low | `src/routes/api/tts.ts`, `src/routes/api/stt.ts`, `src/routes/api/public/payments/webhook.ts` | Consolidate later; not a launch item. |
| C7 | **AI endpoint `ai.ts` at 712 lines.** Maintainability, not perf. | Low | `src/routes/api/ai.ts` | Post-launch refactor into per-intent handlers. |

### D. Deployment Readiness

| # | Item | Status | Notes |
|---|---|---|---|
| D1 | Legal 404 blocker | Cleared | Custom domain returns 200. |
| D2 | Performance batch 1 | Shipped | Awaiting owner acceptance. |
| D3 | Authenticated E2E regression | Pending | Requires owner sign-in (blocking per `remaining-issues.md`). |
| D4 | Live Stripe verification | Pending | Requires owner approval. |
| D5 | Real-device cross-browser | Pending | Owner-driven. |
| D6 | LiveKit Cloud deploy | Deferred | Non-blocking. |
| D7 | Rate limiting (A1) | Not started | **Recommended before launch.** |
| D8 | Uptime monitor (B1) | Not started | **Recommended before launch.** |
| D9 | Turnstile on contact form (A2) | Not started | Recommended; low effort. |
| D10 | HIBP toggle (A4) | Not enabled | 30-second toggle. |
| D11 | Console cleanup (C1) | Not started | Cosmetic; nice-to-have. |
| D12 | Lab surface gate (A10) | Not started | Do before launch if lab pages aren't intended for public. |

---

## 3. Recommended Implementation Order

Each numbered item is a self-contained, testable change. Verify → publish → confirm before starting the next.

1. **A4** — Enable Supabase HIBP leaked-password check. *(2 min, config only.)*
2. **A1** — Rate limiting on AI/TTS/STT endpoints. Shared `ratelimit.server.ts` + `rate_limit_bucket` migration. Return 429. *(3–4 h.)*
3. **B1** — Register UptimeRobot against `/api/public/health` on the production custom domain. *(External; 15 min, no code.)*
4. **A2** — Cloudflare Turnstile on `/contact`. Add site key (public) + `TURNSTILE_SECRET_KEY` (add_secret). *(1.5 h.)*
5. **A10** — Gate lab routes behind `has_role('tester')` or `VITE_ENABLE_LAB`. *(1 h.)*
6. **A11** — Spot-audit wearable OAuth `state` nonce + cron auth. *(30 min.)*
7. **B2 + B3** — Auth-failure summariser + `ops_alert` spike monitor via pg_cron + `/api/public/hooks/ops-monitor`. *(3 h.)*
8. **C1** — Console cleanup (client-side only). *(30 min.)*
9. **A6** — Run `security--run_security_scan` as a final gate; fix anything new. *(15 min + triage.)*
10. **B4** *(post-launch)* — Owner ops dashboard under `_authenticated/_admin/ops`. *(4 h.)*

**Launch-blocking subset**: 1, 2, 3, 9. Everything else can ship in the first post-launch week without meaningful risk.

---

## 4. Effort Rollup

| Batch | Wall time | Notes |
|---|---|---|
| Pre-launch batch (1, 2, 3, 9) | ~5 h + external monitor setup | Ships together. |
| Anti-bot + lab gate (4, 5, 6) | ~3 h | Second batch. |
| Monitoring depth (7, 8) | ~3.5 h | Third batch. |
| Owner dashboard (10) | ~4 h | Post-launch. |

---

## 5. Blockers

None discovered. Owner-side blockers (E2E sign-in, live Stripe charge, real-device pass) remain per `docs/launch/remaining-issues.md`.

---

Awaiting approval. On approval, I will implement item **1** first, verify, publish, and wait for your confirmation before starting item **2**.
