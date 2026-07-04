# Final Legal, Compliance & Communications Audit

Investigation only. Nothing has been changed. Each finding is scoped to a small, testable follow-up you approve one at a time.

---

## 1. Executive Summary

Coverage is broad: 15 legal documents, a Safety Center, AI + health disclaimers, a Subscription Terms doc that matches pricing, transactional/auth email infrastructure, and an owner-alert pipeline (ops_alert + dedupe + hourly cap + email).

The most important issue is **contact-email domain drift**. Every legal page and the Safety Center list contact addresses at `@restpilot.ai`, but the operational domain is `restpilotai.com` and the verified sender domain is `notify.restpilotai.com`. If `restpilot.ai` is not owned by you, users emailing `legal@restpilot.ai`, `security@restpilot.ai`, `privacy@restpilot.ai`, `billing@restpilot.ai`, `copyright@restpilot.ai`, `brand@restpilot.ai`, `safety@restpilot.ai` reach either a bounce or a third party. That is a launch-blocking legal, privacy, and security-disclosure risk.

Everything else is polish: an owner-alert email that reads like a raw JSON dump, a couple of missing standard clauses (arbitrage/class-action language, DPA reference, cookie-consent UI), and a footer that omits Safety Center + Contact.

**No critical implementation bugs found. One launch blocker (contact domain). The rest are High/Medium quality items.**

---

## 2. Legal Findings

| # | Finding | Risk | Files |
|---|---|---|---|
| L1 | Contact addresses use `restpilot.ai`, not the operational domain `restpilotai.com`. Bounces or delivery to a third party for legal, privacy, security, billing, DMCA, brand, safety inbound mail. | **Critical** | `src/routes/legal.*.tsx`, `src/routes/safety.tsx`, `src/components/legal/LegalLayout.tsx`, `src/lib/push/web-push.server.ts` |
| L2 | Terms of Service has no explicit **class-action waiver / jury-trial waiver** and no clear **binding-arbitration** clause. Prompt asks for "Arbitration (if applicable)". Adds real litigation exposure in the US. | High | `src/routes/legal.terms.tsx` |
| L3 | No standalone **Cancellation Policy** / **Refund Policy** page. Terms are inside `legal.subscription.tsx` only. App-store-style buyers and card issuers look for a discrete policy link. | Medium | `src/routes/legal.subscription.tsx` |
| L4 | No **DPA (Data Processing Addendum)** offered — required by many EU/UK B2B buyers even for consumer apps once one business account is created. | Medium | new `src/routes/legal.dpa.tsx` |
| L5 | Terms references governing law/venue only in section text — not surfaced in a summary box. Confirm actual jurisdiction is what you intend (currently reads as Delaware/US; verify or update). | Medium | `src/routes/legal.terms.tsx` |
| L6 | Trademark notice says "brand@restpilot.ai" — see L1; also missing a short "not affiliated with" disclaimer for third-party marks (Stripe, ElevenLabs, OpenAI, Supabase). | Low | `src/routes/legal.trademark.tsx`, `src/routes/legal.third-parties.tsx` |
| L7 | Open-source notices page exists but no build-time verification that `package.json` matches the listed licenses; risk of stale attributions after dependency changes. | Low | `src/routes/legal.open-source.tsx` |

---

## 3. Compliance Findings

| # | Finding | Risk |
|---|---|---|
| C1 | **Cookie consent UI** is not present. Cookie Policy exists but there is no banner/preference center. Required for EU/UK visitors under ePrivacy + GDPR; California CPRA also expects a "Do Not Sell or Share" opt-out link if analytics/ads cookies run. Confirm what non-essential storage runs before deciding scope. | High |
| C2 | **CAN-SPAM footer** — transactional emails include unsubscribe (good). Marketing emails are not sent (confirmed by policy). No action if that stays true; explicitly document it in Subscription Terms / Privacy. | Low |
| C3 | **COPPA** — Terms set age ≥16 but signup flow does not visibly gate age. Add an age-attestation checkbox on `/auth` signup for defensibility. | Medium |
| C4 | **GDPR/CCPA data-subject requests** — Privacy page names `privacy@restpilot.ai` (see L1) and describes rights, but there is no in-app "Download my data" / "Delete my account" surfaced link. `account.functions.ts` has deletion flow — expose it in `/profile`. | High |
| C5 | **Third-party subprocessors list** exists — verify current list matches actual integrations (Stripe live+sandbox, ElevenLabs, OpenAI Realtime, Simli, LiveKit, Supabase/Lovable Cloud, web-push). Missing any = privacy-notice inaccuracy. | High |
| C6 | **Data retention specifics** — Privacy Policy mentions retention but does not state a concrete window for `ai_log`, `ai_memory`, `notification_log`, `email_send_log`. Concrete numbers reduce regulator risk. | Medium |
| C7 | **Health disclaimer placement** — disclaimers page is thorough, but nothing in-app reminds users at first AI recommendation. A one-time modal on first `/coach` or `/pilot` use is defensible and easy. | Medium |

---

## 4. Owner Email Improvement Recommendations

Current `ops-alert.tsx` renders severity as a plain colored heading, then raw `JSON.stringify(meta, null, 2)` at the top of the body. Users approved a professional redesign. Targets:

1. **Severity badge**: pill component with the Critical / High / Medium / Low labels the human sees, mapped from internal `critical/error/warning/info`. Color-coded.
2. **Header line**: `[Critical] payments-webhook — signature verification failed` (severity, service, one-sentence summary).
3. **Local timestamp**: show ISO in UTC plus a human line (e.g. `Fri Jul 4, 2026 · 22:14 UTC`). Full local conversion requires recipient TZ; UTC is acceptable and consistent.
4. **Human-first explanation**: 1–2 sentences describing what happened and typical cause, derived from `service` + `message`.
5. **Action hint**: for well-known services (payments-webhook, tts, ai, contact-form, email-queue) surface a "What to check first" line.
6. **Diagnostics section**: horizontal rule, collapsed-looking monospace card with the `meta` JSON. Also include `at`, `severity`, `service` fields so the email is self-contained.
7. **Consistent branded footer**: no unsubscribe link (already correct — `showUnsubscribe={false}`), link to `/legal/security` and `mailto:security@restpilotai.com`.
8. **Subject-line normalization**: `[RestPilot AI · CRITICAL] payments-webhook · signature verification failed` (add human severity label, dot separator).

Scope of the actual change: **`src/lib/email-templates/ops-alert.tsx` only** (template) + **`src/lib/ops/alert.server.ts`** to also pass `humanSeverity` and a short `hint` when known. No caller changes.

---

## 5. Missing Protections

- Class-action waiver / arbitration clause (L2).
- Standalone cancellation + refund pages (L3).
- DPA (L4).
- Cookie consent banner (C1).
- Age-attestation at signup (C3).
- In-app data export/deletion surface (C4).
- First-use AI/health reminder (C7).
- Contact-email domain fix (L1).

---

## 6. Files Affected (by finding)

- L1: `src/lib/legal/meta.ts` (no change), `src/routes/legal.*.tsx` (13 files, mailto rewrites), `src/components/legal/LegalLayout.tsx`, `src/routes/safety.tsx`, `src/lib/push/web-push.server.ts`.
- L2, L5: `src/routes/legal.terms.tsx`.
- L3: `src/routes/legal.cancellation.tsx` (new), `src/routes/legal.refund.tsx` (new), `src/lib/legal/meta.ts`, `src/components/site/SiteFooter.tsx`.
- L4: `src/routes/legal.dpa.tsx` (new), `src/lib/legal/meta.ts`.
- L6: `src/routes/legal.trademark.tsx`, `src/routes/legal.third-parties.tsx`.
- L7: `src/routes/legal.open-source.tsx` (verification note only).
- C1: new `src/components/consent/CookieBanner.tsx`, `src/routes/__root.tsx`, `src/lib/consent/`.
- C3: `src/routes/auth.tsx`, `src/lib/legal/acceptance.ts` (or existing acceptance system in `legal_acceptances` table).
- C4: `src/routes/profile.tsx`, wire existing `account.functions.ts` deletion + a new export server fn.
- C5: `src/routes/legal.third-parties.tsx` (verify + revise).
- C6: `src/routes/legal.privacy.tsx`.
- C7: new `src/components/safety/FirstUseAiNotice.tsx`, `src/routes/coach.tsx`, `src/routes/pilot.tsx`.
- Owner email: `src/lib/email-templates/ops-alert.tsx`, `src/lib/ops/alert.server.ts`.
- Footer: `src/components/site/SiteFooter.tsx` (add Safety + Contact).

---

## 7. Risk Level per Finding

- **Critical**: L1.
- **High**: L2, C1, C4, C5.
- **Medium**: L3, L4, L5, C3, C6, C7, Owner-email redesign.
- **Low**: L6, L7, C2, footer-link additions.

---

## 8. Recommended Implementation Order

Each row is one small, testable batch you approve before I move on.

```text
1.  L1  Contact email domain fix               Critical    (blocks launch)
2.  Owner-email redesign (ops-alert)          Medium      (polish, user-requested)
3.  L2  Arbitration + class-action + jury      High
4.  C4  In-app data export & delete            High
5.  C1  Cookie consent banner + preferences    High
6.  C5  Subprocessors accuracy review          High
7.  C3  Age-attestation at signup              Medium
8.  L3  Cancellation + Refund pages            Medium
9.  L5  Governing-law confirmation             Medium
10. C6  Concrete retention windows             Medium
11. C7  First-use AI/health notice             Medium
12. L4  DPA page                               Medium
13. L6  Trademark + third-party marks note     Low
14. Footer: add Safety Center + Contact links  Low
15. L7  Open-source verification note          Low
```

---

## 9. Estimated Effort

- Batches 1, 2, 3, 6, 7, 9, 13, 14, 15 — each ~1 small change, 1 verification cycle.
- Batches 4, 5, 8, 10, 11, 12 — each ~1 change with slightly more code (2–4 files) plus verification.
- No schema changes required for any batch (deletion + acceptance tables already exist).
- No new secrets required.
- No new third-party services introduced.

---

## 10. Launch Blockers

- **L1** (contact email domain). Everything else is strongly recommended but not blocking on the same level.

---

## Notes / Assumptions I need you to confirm

1. **Do you own `restpilot.ai`?** If yes, L1 becomes "add MX/forwarding for those aliases" (out of code scope) instead of a rewrite. If no, we rewrite all mailtos to `@restpilotai.com`.
2. **Governing law / venue** for Terms (currently reads US/Delaware) — confirm before L5.
3. **Cookie/analytics inventory** — before C1 I will grep for any analytics/marketing pixels. If only strictly-necessary storage is used, C1 shrinks to a plain notice.
4. **Subprocessor list** — confirm the current active list matches Stripe (live+sandbox), ElevenLabs, OpenAI Realtime, Simli, LiveKit, Lovable Cloud/Supabase, web-push VAPID.

Waiting for your approval and answers to the four questions above before implementing item #1.
