# Email System Completion — Investigation Report & Plan

## 0. Important correction upfront

You mentioned Resend, but RestPilot AI is **not** on Resend. The verified domain `notify.restpilotai.com` is delegated to **Lovable Emails** (Mailgun under the hood) via NS records `ns3/ns4.lovable.cloud`. SPF, DKIM, DMARC, and MX are managed automatically inside that delegated subdomain — no Resend account, no Resend API key. This is the correct posture for us; I'll build on Lovable Emails, not migrate to Resend. If you'd rather switch to Resend, that's a different (and larger) project and would require removing the NS delegation first.

Sender address will be: `RestPilot AI <no-reply@notify.restpilotai.com>` with `Reply-To: support@restpilotai.com`.

---

## 1. Current state (verified)

- ✅ Email domain `notify.restpilotai.com` set up (DNS verifying / active).
- ✅ Email queue processor exists at `src/routes/lovable/email/queue/process.ts` (pgmq + pg_cron).
- ✅ `src/start.ts` bypasses `/lovable/*` in the request middleware.
- ❌ **No auth email templates scaffolded** — auth emails still use default Lovable/Supabase templates (still branded "Lovable" in the footer, no RestPilot logo).
- ❌ **No transactional templates or `/lovable/email/transactional/send` route** — nothing in the app currently sends billing, welcome, support, or ops emails.
- ❌ **No owner alert channel** — errors are only logged to console; nothing pages you.
- ❌ **No unsubscribe landing page** (required for transactional footer links).
- ❌ **No branded email components** (logo, header, footer, button).

---

## 2. Root cause / gap analysis

The queue and infrastructure are in place, but every user-facing and ops-facing email is missing. This is a pure "scaffold + wire triggers" job — no architectural changes needed.

---

## 3. Email architecture (target)

```text
                       ┌──────────────────────┐
 Trigger (server fn)   │  enqueue_email RPC   │
 or webhook  ─────────▶│  (pgmq queue)        │
                       └──────────┬───────────┘
                                  │ pg_cron every 5s
                                  ▼
                       ┌──────────────────────┐
                       │  process.ts (queue)  │───▶ Mailgun ──▶ recipient
                       └──────────┬───────────┘
                                  │
                                  ▼
                          email_send_log
                          suppressed_emails
```

Two pgmq queues (already provisioned):
- `auth_emails` — signup, magic link, recovery, invite, email change, reauthentication (routed through Supabase auth hook).
- `transactional_emails` — everything else (billing, welcome, ops alerts, support acks).

---

## 4. Templates to build

Auth (scaffolded by `email_domain--scaffold_auth_email_templates`):
1. `signup` — verify email
2. `recovery` — password reset
3. `magic-link`
4. `invite`
5. `email-change`
6. `reauthentication`

Transactional (scaffolded by `email_domain--scaffold_transactional_email` + custom):
7. `welcome` — sent post-verification
8. `subscription-confirmation`
9. `payment-receipt`
10. `payment-failed`
11. `subscription-renewed`
12. `subscription-canceled`
13. `subscription-expired`
14. `trial-ending` *(only if you use trials — Stripe currently no trials, so skip for v1)*
15. `account-deletion-confirmation`
16. `data-export-ready`
17. `memory-deletion-confirmation`
18. `privacy-request-confirmation`
19. `contact-form-received` (to user)
20. `feedback-received` (to user)
21. `ops-alert` (to owner) — generic alert template with severity, service, error, stack, timestamp

All share a branded layout: RestPilot logo, Aurora accent color, mobile-safe container (600px), single large CTA button, footer with Terms / Privacy / Support / Unsubscribe (transactional only — auth emails omit unsubscribe by design).

---

## 5. Trigger locations

| Email | Trigger site | Notes |
|---|---|---|
| Signup verify | Supabase auth hook → `/lovable/email/auth/webhook` | Scaffolder wires this |
| Password reset | Same auth hook | Same |
| Magic link / email change / reauth | Same auth hook | Same |
| Welcome | `src/routes/auth.tsx` post-verify OR DB trigger on `auth.users` email_confirmed_at | Prefer server fn called from `/dashboard` first-load-once |
| Subscription confirmation | `src/routes/api/public/payments/webhook.ts` on `customer.subscription.created` | |
| Payment receipt | Same webhook on `invoice.payment_succeeded` | |
| Payment failed | Same webhook on `invoice.payment_failed` | |
| Renewal | Same webhook on `invoice.payment_succeeded` (renewal invoice) | |
| Cancellation | Same webhook on `customer.subscription.updated` with `cancel_at_period_end=true` | |
| Expired | Same webhook on `customer.subscription.deleted` | |
| Account deletion | `src/lib/account.functions.ts` (deleteAccount) | |
| Data export | `src/lib/account.functions.ts` (exportData) | |
| Memory deletion | `src/lib/ai-memory.ts` clear ops | |
| Privacy request | New `/api/public/legal/privacy-request` route | Also need the request form |
| Contact form | New `/api/public/support/contact` route | Needs a `/contact` page |
| Feedback | Existing `FeedbackChips` submit path | |
| Owner ops alerts | New `src/lib/ops/alert.ts` helper | Called from error handlers |

---

## 6. Owner alert channel

New helper `notifyOwner({ severity, service, message, meta })` that:
- Enqueues to `transactional_emails` with template `ops-alert` addressed to `OWNER_ALERT_EMAIL`.
- Applies a 5-minute in-memory dedupe key per `(service+message)` to prevent alert storms (Cloudflare Worker instance-local; good enough for v1).
- Called from:
  - `src/start.ts` error middleware (unhandled 500s)
  - `src/routes/api/public/payments/webhook.ts` on signature failure / handler throw
  - `src/routes/api/ai.ts`, `/api/coach`, `/api/tts*`, `/api/brief` — provider failure branches
  - `src/routes/api/public/hooks/dispatch-alarms.ts` — failure branch
  - Queue processor DLQ path (email delivery failure)
- Severity levels: `critical`, `error`, `warning`. `warning` is throttled 1/hr.

Note: a Worker cannot detect its own outage. Real uptime monitoring (Better Stack, UptimeRobot, etc.) is a separate ops tool — I'll flag it in the deliverable but not build it.

---

## 7. Files to add / change

New:
- `src/lib/email-templates/_shared/Layout.tsx` — branded shell (logo, footer)
- `src/lib/email-templates/_shared/Button.tsx`, `Divider.tsx`
- `src/lib/email-templates/<template>.tsx` × 15 (transactional list above)
- `src/lib/email-templates/registry.ts` — updated (scaffolder creates initial)
- `src/lib/email/send.ts` — client helper for authed triggers
- `src/lib/email/send.server.ts` — server-to-server enqueue (bypasses HTTP for webhooks)
- `src/lib/ops/alert.ts` — owner alert helper + dedupe
- `src/routes/lovable/email/auth/webhook.ts` — created by scaffolder
- `src/routes/lovable/email/transactional/send.ts` — created by scaffolder
- `src/routes/lovable/email/transactional/preview.ts` — created by scaffolder
- `src/routes/email.unsubscribe.tsx` — branded unsubscribe page (path returned by scaffolder)
- `src/routes/api/public/support/contact.ts` — public contact form endpoint
- `src/routes/contact.tsx` — public contact page

Changed:
- `src/routes/api/public/payments/webhook.ts` — 6 email triggers
- `src/lib/account.functions.ts` — deletion + export triggers
- `src/lib/ai-memory.ts` — memory deletion trigger
- `src/routes/api/ai.ts`, `/coach.ts`, `/tts.ts`, `/tts-elevenlabs.ts`, `/brief.ts` — ops alerts on provider failure
- `src/routes/api/public/hooks/dispatch-alarms.ts` — ops alert on failure
- `src/start.ts` — ops alert on unhandled 500
- `src/routes/__root.tsx` + `$lang`-style layouts — allow `/email/unsubscribe` public access
- `src/routes/auth.tsx` — trigger welcome email once on first confirmed session

---

## 8. Environment / secrets

Already present, no rotation needed: `LOVABLE_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.

New (I'll ask before setting):
- `OWNER_ALERT_EMAIL` — where ops alerts go (e.g. your personal address)
- `SUPPORT_EMAIL` — reply-to and shown in footers (e.g. `support@restpilotai.com`)

Sender constants (in code, not secrets):
- From: `RestPilot AI <no-reply@notify.restpilotai.com>`
- Reply-To: `support@restpilotai.com`
- Sender domain (API lookup): `notify.restpilotai.com`

---

## 9. Testing plan

End-to-end matrix I'll run after implementation, on Gmail (iOS + web), Apple Mail (iOS + macOS), Outlook (web), Yahoo:

1. New signup → verify email → welcome email arrives, Verify button tappable on Gmail iOS ✅
2. Password reset flow round-trip
3. Live $0.50 subscription → confirmation + receipt
4. Force failed payment via test card `4000000000000341` → payment-failed email
5. Cancel subscription → cancellation email; wait for period end → expired
6. Contact form submission → ack email
7. Account deletion → confirmation email
8. Data export → ready email with download link
9. Force provider failure (bad API key temporarily) → owner alert arrives within 60s
10. `email_send_log` inspected for all above; verify no rows stuck in `pending` > 5 min; verify `suppressed_emails` empty
11. Spam-score check via mail-tester.com (target: 10/10; SPF/DKIM/DMARC all pass)

---

## 10. Missing functionality flagged for launch

- **No `/contact` page today** — needed to satisfy the "Contact form" email trigger and general support surface. Small form, honeypot, rate-limited endpoint.
- **No uptime monitoring** — Worker outages can't be self-reported. Recommend Better Stack (free tier) hitting `/api/public/version` every 60s. Configuration is a one-time UI step, not code.
- **Privacy request form** — legal pages reference "request your data" but there is no submission surface. Small form + endpoint.

---

## 11. Risks

- **DNS verification window** — if `notify.restpilotai.com` is still `awaiting_dns`, scaffolding still works, but real sends fail until verified. I'll scaffold anyway and monitor.
- **Stripe webhook idempotency** — I'll dedupe email sends by `idempotencyKey = event.id + template`, so a Stripe retry doesn't double-email.
- **Owner alert loop** — email delivery failure triggering an owner-alert email that also fails would loop. The DLQ handler skips `notifyOwner` if the failing template is `ops-alert`.
- **Auth hook overwrites** — scaffolder needs `confirm_overwrite: true` only if templates already exist; none exist today, so first-run is safe.

---

## 12. Rollout order (once approved)

1. Scaffold auth templates + brand them.
2. Scaffold transactional infra + build 15 templates + branded layout.
3. Add unsubscribe page + `/contact` + privacy request form.
4. Wire billing triggers in Stripe webhook.
5. Wire account/data/memory triggers.
6. Add `notifyOwner` helper and wire it into all failure paths.
7. Deploy, run the full test matrix, share results.

Awaiting your **approved** to start with step 1. Also please tell me the two email addresses to set as `OWNER_ALERT_EMAIL` and `SUPPORT_EMAIL`.
