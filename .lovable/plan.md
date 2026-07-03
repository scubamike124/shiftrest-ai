# Phase 3 — Production Monitoring & Owner Alerts

Investigation only. No code written yet.

## 1. What already exists

**Owner-alert primitive (solid foundation, don't rebuild)**
- `src/lib/ops/alert.server.ts` — `notifyOwner()` / `notifyOwnerAsync()` with:
  - Sends `ops-alert` React Email template to `OWNER_ALERT_EMAIL` (secret ✅ set).
  - 10-minute in-memory dedupe keyed on `severity:service:message` (prevents burst floods).
  - Per-minute idempotency key for queue-level dedupe.
  - Fire-and-forget wrapper that never throws.
- Email pipeline: pgmq queue → `/lovable/email/queue/process` cron → `email_send_log`.

**Already wired to `notifyOwner`:**
| Area | File | Coverage |
|---|---|---|
| AI Companion / gateway | `routes/api/ai.ts` | 5 call sites (budget, upstream, parse, timeout, unknown) |
| Morning brief AI | `routes/api/brief.ts` | 5 call sites |
| TTS (voice) | `routes/api/tts.ts` | 7 call sites (ElevenLabs + fallback + budget) |
| Payments webhook | `routes/api/public/payments/webhook.ts` | 2 call sites (signature, handler) |
| Subscription lifecycle hook | `routes/api/public/hooks/subscription-lifecycle.ts` | 2 |
| Alarm dispatch cron | `routes/api/public/hooks/dispatch-alarms.ts` | 1 |
| Contact form | `routes/api/public/contact.ts` | 1 |
| Account deletion | `lib/account.functions.ts` | 1 |
| Global server-fn error middleware | `src/start.ts` | 1 (catches every unhandled server-fn throw) |

**Structured log surfaces already available**
- `email_send_log` — every send + DLQ moves (dashboard-ready).
- `ai_log` — per-call `status`, `error`, `latency_ms`, `total_tokens`.
- `notification_log` — push delivery outcomes.
- Cloudflare Worker logs via `stack_modern--server-function-logs`.
- AI Gateway logs via `ai_gateway_logs--list_ai_gateway_requests`.
- Client-side `reportLovableError()` bridge into Lovable's `__lovableEvents.captureException` (runtime-errors panel).

## 2. Gaps

**High-priority gaps**
1. **Auth failures are invisible.** `routes/auth.tsx` and `integrations/supabase/auth-middleware.ts` do not call `notifyOwner`. A broken OAuth config or JWT storm goes unnoticed.
2. **Email pipeline health is unwatched.** `/lovable/email/queue/process` catches errors but never pages. A stuck queue or DLQ surge (including the ops-alert emails themselves) fails silently.
3. **No aggregate alerts.** Every alert today is per-event. There is no "AI error rate > 20% in last 15 min" or "5+ payment webhook failures in 10 min" trigger — the 10-min dedupe hides bursts rather than escalating them.
4. **No persistent alert history.** Alerts live only in the outbound email log; there's no `ops_alert` table to build a dashboard, silence a noisy service, or audit incident timeline.
5. **Uptime/outage detection is external-only.** No self-check pings the app from outside the Worker; a full-app outage means `notifyOwner` itself can't fire.
6. **AI Gateway 402 / credit-exhausted** is not called out separately from generic upstream errors — this is the single most likely launch-day failure.
7. **Smart Alarm** — the `dispatch-alarms` cron alerts on failures, but there is no watchdog for "cron didn't run in N minutes" (silent scheduler failure = missed wakeups, which is the worst possible failure mode for this app).
8. **Client-side runtime errors** are captured by Lovable's overlay but never emailed to the owner.

**Lower-priority gaps**
- Database health: `supabase--cloud_status` is agent-only; no scheduled probe.
- STT (`routes/api/stt.ts`) has no owner alert wiring.
- Performance: no P95 latency alert; `ai_log.latency_ms` is written but not aggregated.

## 3. Recommended alert architecture

```text
                        ┌──────────────────────┐
   per-event errors ───▶│ notifyOwnerAsync()   │──┐
                        └──────────────────────┘  │
                                                  ▼
   aggregate probes  ──▶ every-5-min cron ──▶ ops_alert table (INSERT)
                                                  │
                                                  ├─▶ severity>=error → ops-alert email
                                                  │   (existing template, dedupe)
                                                  │
                                                  └─▶ /admin/alerts dashboard
                                                      (auth-gated, admin role only)
```

- **Keep** the existing `notifyOwner` helper as the single choke point.
- **Add** an `ops_alert` DB table so every fired alert is persisted (source of truth for the dashboard and for cross-request rate-limiting).
- **Add** a 5-minute health cron (`/api/public/hooks/health-probe`) protected by `CRON_SECRET` that aggregates the last window and fires escalation alerts for spikes.
- **Add** an external uptime ping (UptimeRobot / BetterStack — free tier) hitting a lightweight `/api/public/health` returning 200. This is the only reliable way to detect a full outage; internal alerts can't email if the Worker is down.

## 4. Owner-email delivery — best path

Already correct. Keep using `sendTransactionalEmailServer` → `ops-alert` template → pgmq → cron. Reasons: retry + DLQ + suppression + one send path.

Two small hardenings to add later:
- Send critical alerts (`severity: 'critical'`) with an additional `Idempotency-Key` scoped per-hour so a truly repeating issue re-pages after the dedupe window.
- If pgmq itself is degraded, fall back to a direct Mailgun REST call for `severity: 'critical'` (bypasses queue). Optional, small.

## 5. Proposed `ops_alert` table

Persistent alert history + dashboard source.

```sql
CREATE TABLE public.ops_alert (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at   timestamptz NOT NULL DEFAULT now(),
  severity     text NOT NULL CHECK (severity IN ('critical','error','warning','info')),
  service      text NOT NULL,      -- 'ai', 'tts', 'payments', 'auth', 'alarm', ...
  message      text NOT NULL,
  meta         jsonb NOT NULL DEFAULT '{}'::jsonb,
  emailed      boolean NOT NULL DEFAULT false,
  resolved_at  timestamptz
);
GRANT SELECT ON public.ops_alert TO authenticated;
GRANT ALL    ON public.ops_alert TO service_role;
ALTER TABLE public.ops_alert ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins read ops_alert" ON public.ops_alert
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'));
CREATE INDEX ops_alert_recent ON public.ops_alert (created_at DESC);
CREATE INDEX ops_alert_service_recent ON public.ops_alert (service, created_at DESC);
```

## 6. Dashboard

Add `/admin/alerts` route under `_authenticated` layout, gated by `has_role('admin')`. Columns: time, severity badge, service, message, meta expand, resolve button. Filters: severity, service, time range. Follows the same pattern as the email dashboard guidance.

## 7. Files / tables / functions likely touched

- **New:** `src/lib/ops/health-probe.server.ts`, `src/routes/api/public/hooks/health-probe.ts` (cron), `src/routes/api/public/health.ts` (external ping), `src/routes/_authenticated/admin.alerts.tsx`, migration for `ops_alert`.
- **Modified:** `src/lib/ops/alert.server.ts` (write to `ops_alert`, add rate-based escalation), `src/routes/auth.tsx` (report auth exceptions), `src/routes/lovable/email/queue/process.ts` (DLQ + failure alerts), `src/lib/lovable-error-reporting.ts` (optional POST to `/api/public/client-error` for critical client errors).
- **Untouched:** every existing `notifyOwner` call site — signature stays the same.

## 8. Rollout — low-risk, one step at a time

Each step ships alone, is reversible, and adds coverage without changing behavior.

1. **Persist alerts** — create `ops_alert` table + write from `notifyOwner`. No user-visible change. Enables everything below.
2. **Admin dashboard** — `/admin/alerts` list view (read-only). Verifies alerts are flowing.
3. **Fill wiring gaps** — add `notifyOwner` to `auth.tsx`, email queue processor, STT route. Small, targeted edits.
4. **External uptime ping** — add `/api/public/health` (2 lines). User configures UptimeRobot themselves.
5. **Health-probe cron** (5 min) — aggregate `ai_log`, `email_send_log`, `ops_alert` counts, fire escalation alerts for spikes, and watchdog the alarm-dispatch cron ("no run in 15 min → critical").
6. **Client-error reporting** — optional `/api/public/client-error` receiver, called from `reportLovableError()` for boundary crashes.
7. **Resolve/silence UI** — mark resolved, silence a service for N minutes.

## 9. What to do first

Steps 1 + 3 + 4. Together they close the biggest gaps (persistence + auth blind spot + full-app outage detection) with roughly one migration and three small file edits. Everything else builds on the `ops_alert` table.

## 10. Explicit non-goals for Phase 3

- No third-party APM (Sentry, Datadog) — the existing pipeline covers launch needs.
- No SMS/paging — email-only until volume justifies it.
- No changes to any existing `notifyOwner` call site's copy or severity.
- No touching the Smart Alarm flow itself.

Awaiting approval before implementation.
