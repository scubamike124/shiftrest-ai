# RestPilot AI — Legal & Compliance Verification Matrix

_Last updated: 2026-06-27_

This matrix maps each legal document and in-product disclosure to its
location, user action required, backend storage, current test status,
and remaining risk.

| # | Document / Disclosure | Where it appears | User action | Backend record | Test status | Remaining risk |
|---|---|---|---|---|---|---|
| 1 | Terms of Service | `/legal/terms`, footer, `/auth` signup, paywall | View, accept on signup | `legal_acceptances` row w/ doc=`terms` | Manual: smoke-tested signup flow | Need attorney pass on wording |
| 2 | Privacy Policy | `/legal/privacy`, footer, `/auth`, paywall | View, accept on signup | `legal_acceptances` doc=`privacy` | Manual | Expand sub-processor list when adding vendors |
| 3 | Cookie Policy | `/legal/cookies`, footer, banner link | Accept / reject / manage via banner | `localStorage` `cookie-consent-v1` | Manual: banner renders on first visit | Server-side mirror not implemented |
| 4 | Acceptable Use Policy | `/legal/acceptable-use`, footer | View | n/a | Manual | UGC moderation policy not productized |
| 5 | AI & Health Disclaimers | `/legal/disclaimers`, signup, onboarding, paywall, SafetyNote links on cards | Accept on signup + onboarding | `legal_acceptances` doc=`disclaimers` | Manual | Wording sweep still ongoing |
| 6 | Subscription Terms | `/legal/subscription`, paywall `RenewalDisclosure`, profile billing portal link | View | n/a (Stripe records billing) | Manual | Lifetime “lifetime of service” language to be confirmed |
| 7 | Refund Policy | `/legal/refunds`, paywall footer | View | n/a | Manual | Regional refund regs (EU/UK) need attorney pass |
| 8 | Subprocessors / Third Parties | `/legal/third-parties` | View | n/a | Manual | Update on every vendor change |
| 9 | Security Policy | `/legal/security` | View | n/a | Manual | Pen-test report not yet linked |
| 10 | Accessibility Statement | `/legal/accessibility` | View | n/a | Manual | Live WCAG audit pending |
| 11 | Copyright / DMCA | `/legal/copyright` | View | Counter-notice via email | Manual | Designated agent registration pending |
| 12 | Trademark Notice | `/legal/trademark` | View | n/a | Manual | — |
| 13 | Software License Agreement | `/legal/license` | View | n/a | Manual | Confirm open-source notices completeness |
| 14 | Open-Source Notices | `/legal/open-source` | View | n/a | Manual | Re-generate on every dep change |
| 15 | Electronic Consent | `/legal/electronic-consent` | Accept on signup + onboarding | `legal_acceptances` doc=`electronic-consent` | Manual | — |
| 16 | Safety Center | `/safety`, SafetyNote on each card, onboarding, offline banner | View / acknowledge | `legal_acceptances` doc=`safety` | Manual | Add SafetyNote to any new feature surface |
| 17 | Cookie / Consent Banner | All pages, first visit | Accept / reject / manage | `localStorage` | Manual | — |
| 18 | Onboarding consent (6 ack items) | `Onboarding` modal pre-first use | Required checkboxes | `legal_acceptances` doc=`onboarding-ack` + `user_prefs.consent_json.onboarding_ack` | Manual | — |
| 19 | Push notification first-connect modal | `NotificationsSection` enable flow | Accept | `user_prefs.consent_json.push` | Pending wire-up to `ConsentModal` | TODO: integrate `ConsentModal` |
| 20 | Wearable first-connect modal | `WearableCard` connect flow | Accept | `user_prefs.consent_json.wearables` | Pending wire-up to `ConsentModal` | TODO: integrate `ConsentModal` |
| 21 | Paywall renewal disclosure | `paywall` page | View | n/a | Manual | — |
| 22 | Offline mode disclosure | `OfflineBanner` (visible offline) | View | n/a | Manual | — |
| 23 | Account deletion | `/profile` → Delete account | Confirm + type "DELETE" | `deleteAccountFn` (purges 16 tables; Stripe cancel attempted; retains subscriptions/legal_acceptances) | Manual e2e | Document Stripe retention in policy more clearly |
| 24 | Data export | `/profile` → Export my data | Click | `exportAccountFn` returns JSON | Manual | Large accounts may need async export |
| 25 | AI memory purge | `/profile` → Erase AI memory | Confirm | `purgeAiMemoryFn` clears 4 tables | Manual | — |
| 26 | Memory management UI | `/memory` | View / edit / delete individual memories | `ai_memory` | Manual | — |

## Remaining global risks

1. **Wording sweep** — global pass to remove any “guarantee / will / ensures” language across UI strings is not complete.
2. **Push & wearable consent modals** — `ConsentModal` component exists but is not yet wired into the enable buttons.
3. **Attorney review** — every document above is engineer-drafted and needs a qualified attorney pass before public launch.
4. **Regional law variance** — GDPR / UK GDPR / CCPA / CPRA / Quebec Law 25 specifics need review.
5. **Children** — we require 16+ on signup; no parental-consent flow exists.
6. **Stripe tax & invoice records** — retained under Stripe’s rules; user-facing copy now states this.
7. **Aggregate operational logs** — `ai_log`, `notification_log` are retained short-term; documented but not yet auto-pruned by cron.
