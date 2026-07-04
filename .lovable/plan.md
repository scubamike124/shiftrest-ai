# Production Monitoring & Owner Alerts — Plan

## Investigation Findings

Most of the requested foundation is **already built and shipping**:

- `public.ops_alert` table (severity + service + message + meta + emailed + resolved_at, indexes, admin-only RLS).
- `notifyOwner` / `notifyOwnerAsync` helper (`src/lib/ops/alert.server.ts`) with:
  - 10-minute in-memory dedupe per `severity:service:message`.
  - Persists **every** alert to `ops_alert` (dashboard/history).
  - Emails `OWNER_ALERT_EMAIL` via the branded `ops-alert` template through the app-email queue.
- `OWNER_ALERT_EMAIL` secret configured.
- Already wired: global TSS request-error middleware (`src/start.ts`), `/api/ai`, `/api/tts`, `/api/stt`, `/api/brief`, `/api/public/contact`, `/api/public/payments/webhook`, `/api/public/hooks/subscription-lifecycle`, `/api/public/hooks/dispatch-alarms`, `/lovable/email/queue/process`, `account.functions.ts`.

So the "foundation" line item is essentially done. What's missing is **coverage gaps** and a couple of small hardening items.

## Coverage Gaps (what this task will close)

1. **`/api/tts-elevenlabs`** — no `notifyOwner` on provider_failure / network errors.
2. **`/api/coach`, `/api/insights`, `/api/swap`** — need audit; add alerts on 5xx / unhandled paths if any.
3. **Auth failure spikes** — no alert when password-reset / login endpoints repeatedly 401. Cheap add: count 401s from Supabase Auth via a lightweight rate check in a `notifyOwner` wrapper is out of scope for a small change; instead, log a **weekly digest** SQL view for now and add real spike detection in a follow-up.
4. **Email delivery DLQ** — the queue processor already alerts on send failure; verify it also alerts when a message hits DLQ after max attempts.
5. **Severity normalization** — helper accepts `critical | error | warning`; user requirement calls for `Critical / High / Medium`. Add a mapping layer so external labels match the user's taxonomy without breaking existing call sites.
6. **Cooldown for equal-severity floods across different messages of the same service** — current dedupe key includes `message`. Add a secondary per-service circuit breaker (e.g. max 20 emails/hour per service) to guarantee no email flood.

## Scope for THIS Change (small, testable)

Only the truly straightforward, low-risk items:

1. Add `notifyOwnerAsync` to `/api/tts-elevenlabs` provider_failure + network branches (mirrors `/api/tts`).
2. Audit `/api/coach`, `/api/insights`, `/api/swap` and add alerts on 5xx / catch-all error branches only (no logic changes).
3. Add a per-service hourly cap (max 20 emails/hour/service) inside `alert.server.ts` — persistence still happens, just email gets suppressed with `emailed=false` + a note in `meta`.
4. Add a public severity alias in the helper: accept `'high'` → `'error'`, `'medium'` → `'warning'` (backward compatible).

Explicitly **out of scope** (queued for follow-ups, will confirm before touching):

- Uptime pinger / heartbeat monitor.
- Client-side error → server alert bridge (would need a new public endpoint + abuse protection).
- Auth-failure spike detector (needs a scheduled job).
- Admin dashboard UI for `ops_alert` history.
- Stripe live-mode webhook signature drift monitor.

## Files to Change

- `src/lib/ops/alert.server.ts` — add severity alias + per-service hourly cap.
- `src/routes/api/tts-elevenlabs.ts` — add `notifyOwnerAsync` on failure branches.
- `src/routes/api/coach.ts`, `src/routes/api/insights.ts`, `src/routes/api/swap.ts` — add alerts on error branches only (after read-through).

No schema changes. No new secrets. No new routes. No client-code changes.

## Verification Plan

- `tsgo --noEmit` clean.
- Invoke each touched route with a forced failure locally (mock upstream 500) and confirm one `ops_alert` row per failure and one email enqueued.
- Fire 30 rapid failures against one service and confirm exactly 20 emails and 30 rows.
- Confirm existing wired routes still emit correctly (regression: send one failing `/api/ai` request).

## Deliverables After Implementation

Files changed, build status, verification results, test results, the alert workflow diagram (route → notifyOwnerAsync → ops_alert insert + dedupe/cap check → app-email queue → OWNER_ALERT_EMAIL inbox), and the remaining-recommendations list above (uptime pinger, dashboard, spike detector, client-error bridge).

Stopping here for your approval before implementing.
