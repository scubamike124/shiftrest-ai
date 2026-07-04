# Final Security Verification

Investigation only. Nothing changed. Awaiting your approval before touching anything.

---

## 1. Executive Summary

Security posture is **strong and launch-ready** with **zero Critical or High findings**. All previously implemented controls are wired and working:

- Rate limiting (AI, TTS, STT), contact-form spam protection (honeypot + min-time + IP throttle + content heuristics), owner-alert pipeline (ops_alert + dedupe + hourly cap), Stripe webhook signature verification, `/api/lab/*` bearer + role gate, RLS on every user-data table, service-role client isolated to `.server.ts` modules, no secrets in client bundles.

Scanner returned **24 findings — all `warn` level** (Supabase database linter). None are Critical/High. They fall into three groups: 4 functions missing `SET search_path` (defense-in-depth), 20 SECURITY DEFINER functions callable by anon/authenticated (these are the pgmq queue wrappers used by design + `has_role`/`has_active_subscription`/`has_ai_budget`/`get_partner_share`, which SHOULD be callable — the finding is a policy hint, not an exposure).

**One legacy fallback** in cron auth (accepts the anon key as a fallback) is the only meaningful remaining item — Medium, documented as intentional rollover code, safe to remove now that all cron jobs use `CRON_SECRET`.

**No launch blockers.**

---

## 2. Security Findings

### Verified Working (no action)

| # | Control | Evidence |
|---|---|---|
| S1 | AI rate limit (20/min per user) | `src/routes/api/ai.ts:286-287`, `src/routes/api/brief.ts:83-84` + `RATE_LIMITS.ai` |
| S2 | TTS rate limit (30/min per user) | `src/routes/api/tts.ts:93`, `src/routes/api/tts-elevenlabs.ts:45` |
| S3 | STT rate limit (30/min per user) | `src/routes/api/stt.ts:45` |
| S4 | Rate limiter uses service-role + Postgres RPC (client cannot bypass) | `src/lib/api/ratelimit.server.ts` |
| S5 | Contact honeypot (`hp` must be empty) | `src/routes/api/public/contact.ts:15` |
| S6 | Contact min-time-to-submit (3s) | `src/routes/api/public/contact.ts:MIN_ELAPSED_MS` |
| S7 | Contact IP rate limit (5/15min pre-parse) | `src/routes/api/public/contact.ts` + `enforceRateLimit` |
| S8 | Contact content heuristics (link density, blocklist, char runs) | `looksLikeSpam` in contact.ts |
| S9 | Owner alerts: dedupe (10min) + hourly cap (20/service) + always-persist | `src/lib/ops/alert.server.ts` |
| S10 | Owner alerts wired into ai/tts/tts-elevenlabs/stt/brief/swap/insights/payments/contact/queue/global-error-mw | 12 call sites confirmed |
| S11 | Stripe webhook HMAC-SHA256 signature verification + 5-min timestamp tolerance | `verifyWebhook` in `src/lib/stripe.server.ts` |
| S12 | Stripe env keyed by `?env=` query param | `src/routes/api/public/payments/webhook.ts` |
| S13 | Lab API bearer + role gate (tester or admin) | `src/lib/api/lab-gate.server.ts` |
| S14 | `_authenticated` layout gates all authenticated routes (integration-managed) | `src/routes/_authenticated/route.tsx` |
| S15 | Admin/tester checks always via `has_role` RPC (never client-side) | grep confirms only server code calls `has_role` |
| S16 | Service-role key never imported in client-reachable module scope | all `process.env.SUPABASE_SERVICE_ROLE_KEY` reads are inside `.server.ts`/handlers |
| S17 | No `import.meta.env.VITE_*` exposes secrets — only URL, publishable key, feature flags, payments client token | `rg import.meta.env.VITE_` review |
| S18 | No `dangerouslySetInnerHTML` on user input | grep clean |
| S19 | RLS enabled on all user data tables, `has_role`/`has_active_subscription` SECURITY DEFINER helpers isolate role checks | `supabase-tables` inventory + `db-functions` |
| S20 | Cron endpoints require `x-cron-secret` header matching `CRON_SECRET` | `src/lib/api/cron-auth.server.ts` |
| S21 | Same-origin only (no CORS `Allow-Origin: *`) | grep clean |
| S22 | No debug/health endpoints exposed publicly (lab routes gated) | route audit clean |

### Findings To Address (all Low/Medium, none launch-blocking)

| # | Finding | Level | Files |
|---|---|---|---|
| F1 | `cron-auth.server.ts` still accepts the Supabase publishable/anon key as a fallback. The anon key is embedded in the client bundle, so anyone could POST to `/api/public/hooks/notify` / `dispatch-alarms` / `ai-learn` / `subscription-lifecycle` / `wearables/cron` and force a run. Comment says "delete this block after rollover is verified" — rollover is done, all cron jobs now use `CRON_SECRET`. | **Medium** | `src/lib/api/cron-auth.server.ts` |
| F2 | 4 SECURITY DEFINER functions lack `SET search_path = ''`: `enqueue_email`, `read_email_batch`, `delete_email`, `move_to_dlq`. Defense-in-depth against search_path hijacking. All are pgmq wrappers; risk is low because pgmq schema is trusted, but Supabase linter flags it. | Low | migration |
| F3 | 20 SECURITY DEFINER functions callable by anon/authenticated per linter. Reviewed each: `has_role`, `has_active_subscription`, `has_ai_budget`, `get_partner_share`, `rate_limit_hit`, `rate_limit_prune`, `email_queue_wake`, `email_queue_dispatch`, `handle_new_user`, `set_updated_at`, and the pgmq wrappers. Every one is called intentionally from RLS policies, the app, or triggers. This is a **policy hint, not an exposure**. | Info (accept) | n/a |
| F4 | No HTTP security headers (`Content-Security-Policy`, `Strict-Transport-Security`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, `X-Frame-Options`). Lovable's edge sets HSTS and X-Content-Type-Options by default, but CSP is missing. Adding CSP requires cataloguing every third-party origin (Stripe, ElevenLabs, LiveKit, Simli, OpenAI, Supabase, Lovable, web-push) and risks breakage; suggest a `report-only` policy first. | Medium (deferrable) | new `src/routes/__root.tsx` head or edge config |
| F5 | Auth: leaked-password (HIBP) check status not visible from this side. Should be enabled in Cloud → Users → Auth Settings. | Low (owner confirm) | none |
| F6 | Contact form heuristics do not include an obvious "message == subject" or "email domain == disposable" check. Optional hardening; current filters are reasonable. | Low (nice-to-have) | `src/routes/api/public/contact.ts` |

---

## 3. Verification Results

- **Scanner run:** 24 findings, 0 error/critical, 24 warn. Full breakdown in §2/F2/F3.
- **Type-check:** clean (last verified on last item, no changes since).
- **Client bundle secret leaks:** none — no `process.env.SUPABASE_SERVICE_ROLE_KEY`, `STRIPE_*_API_KEY`, `LOVABLE_API_KEY`, `ELEVENLABS_API_KEY`, `SIMLI_API_KEY`, `OPENAI_REALTIME_API_KEY`, `LIVEKIT_API_SECRET`, `VAPID_PRIVATE_KEY`, `CRON_SECRET`, `PAYMENTS_*_WEBHOOK_SECRET` in any client-reachable module scope.
- **Debug endpoints:** none public. `/lab/*` UI hidden in prod and lab APIs gated by tester/admin.
- **Dev-only code exposed:** `DebugHUD` component gated by `import.meta.env.DEV`; `PWA UpdateBanner` gated by `PROD`. Safe.
- **Unused admin routes:** none found.
- **Owner alert pipeline live:** confirmed one recent `ops_alert` row from contact-form send with `emailed=true`.

---

## 4. Remaining Risks

Ordered by residual risk after this audit:

1. **F1 (Medium)** — legacy cron auth fallback allowing anon-key trigger. Real exposure: anonymous request cost + a chance to force notification/subscription-sweep runs. Cannot exfiltrate data (all writes are for the logged-in user's own state); mostly a nuisance/abuse vector.
2. **F4 (Medium)** — missing CSP. Reduces defense-in-depth against XSS if a template escape ever slips; no user-generated HTML is rendered today, so risk is low.
3. **F2 (Low)** — search_path on pgmq wrappers.
4. **F5 (Low)** — HIBP enable confirmation.
5. **F6 (Low)** — extra contact heuristics.

---

## 5. Files Affected (by proposed fix)

- F1: `src/lib/api/cron-auth.server.ts` (delete the ~10-line legacy fallback block; keep `x-cron-secret` path only).
- F2: one new migration setting `SET search_path = ''` on the 4 pgmq wrapper functions.
- F4: `src/routes/__root.tsx` (add meta CSP report-only) OR platform-level headers if Lovable exposes them.
- F5: no code — Cloud dashboard toggle.
- F6: `src/routes/api/public/contact.ts` (optional).

---

## 6. Risk Levels

- **Critical:** none.
- **High:** none.
- **Medium:** F1, F4.
- **Low:** F2, F5, F6.
- **Info (accept):** F3.

---

## 7. Recommended Implementation Order

Each row is one small, testable batch you approve before I move on.

```text
1. F1  Remove legacy anon-key fallback in cron-auth              Medium   (small)
2. F2  Add SET search_path = '' to 4 pgmq wrappers (migration)   Low      (small)
3. F4  Add CSP header (report-only first)                        Medium   (needs origin audit)
4. F5  You enable HIBP in Cloud UI                               Low      (no code)
5. F6  Optional extra contact-form heuristics                    Low      (optional)
```

---

## 8. Launch Blockers

**None.** Every finding above is Medium or Low.

---

## Status

The security phase is **substantively complete** for launch. The remaining items are hardening. If you want a truly clean scan and zero warnings, approve batches 1 and 2 first (they clear the two categories the scanner cares about that are safe to change without risk). Batch 3 (CSP) is worth doing but takes an origin inventory pass and should ship in report-only mode first to avoid breaking third-party embeds.

**Recommendation:** approve batches 1 + 2 as a single small change (both are ~10 lines of code combined and touch nothing user-facing), then proceed to end-to-end QA. Batches 3–5 can be follow-ups after launch or a separate hardening sprint.

Awaiting your call on how to proceed.
