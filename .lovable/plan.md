# Legal & Compliance Phase 2 — Plan

Extends the existing `/legal/*` package with the new mandatory categories. Investigation done — every item below maps to either an existing doc that needs a new section, or a new route. No code until approved.

---

## Investigation findings

Current shipped surface (Phase 1, rollouts 1–3):
- 12 docs live under `/legal/*` with shared `LegalLayout`, `LEGAL_DOCS` registry, draft banner, footer, redirects from `/terms` + `/privacy`.
- AI disclaimers exist at `/legal/disclaimers` but do **not** yet cover: AI may be outdated, AI should be independently evaluated, AI is not guaranteed correct (only general "informational" language).
- `/legal/terms` covers IP, indemnification, arbitration, force majeure — but **no UGC clause** (RestPilot today doesn't accept photos/videos/voice uploads; user-generated content is shifts, prefs, notes, and AI text). The new requirement future-proofs for uploads.
- `/legal/third-parties` lists wearable + AI vendors but doesn't state device/sensor accuracy limits or sync-delay risks as a user-facing disclosure.
- No Safety Center route. Safety-sensitive language is only a section in `/legal/disclaimers`.
- No Open-Source Notices page; `package.json` has 100+ deps, none surfaced.
- No Electronic Consent / E-SIGN clause.
- Age requirement in ToS = 16. New requirement adds parental-consent language for minors below adult age where permitted.
- Feedback clause exists in ToS §10 but is one sentence — needs a dedicated "Feedback License" section.
- Service-changes language exists in ToS §18 (Terms changes) but **not** for the Service itself (feature add/remove, AI model swap, provider swap, pricing change, sunset notice).
- International compliance: Privacy mentions CCPA/GDPR placeholders but no regional disclosure surface.
- Consistency: marketing copy, onboarding, settings, paywall all reference features ("Smart Alarm", "Long Clock", "Companion", "AI Decision Center", "Memory", "Wearable Sync") — Phase 2 includes a sweep so legal vocabulary matches in-product vocabulary exactly.

---

## Deliverables

### 1. Expand existing legal documents (no new routes)

| Doc | New section(s) |
|---|---|
| `/legal/terms` | **User-Generated Content** (photos / video / voice / docs / AI-generated artifacts — ownership retained by user, limited license to RestPilot to host/process/display, user represents rights, user remains responsible). **Service Availability & Changes** (modify, add, discontinue features; swap AI models / TTS / wearable providers; pricing changes with notice; sunset of legacy functionality). **Account Security** (strong password, device protection, breach reporting via `security@restpilot.ai`, responsibility until reported). **Feedback License** (voluntary, no compensation, irrevocable). **Electronic Consent / E-SIGN** (electronic acceptance binding; electronic records satisfy legal requirements). **Age & Minor Consent** (16+ baseline, parent/guardian consent where local law sets a higher age of digital consent, no use by those unable to enter binding agreements). |
| `/legal/privacy` | Add UGC paragraph (today: text only — shifts, prefs, voice TTS output is server-rendered, not user voice uploads); future-proof clause for uploads. Add **Account Security** responsibility line. Add **International** subsection pointing to regional addenda. |
| `/legal/disclaimers` | Rewrite **AI Output Limitations** section: may be inaccurate, may be incomplete, may be outdated, must be independently evaluated, not guaranteed correct. Add **Device & Sensor Limitations** section (wearables may fail, sensors may be inaccurate, third-party integrations may go offline, sync delays, internet outages affect recommendations, no guarantee of accuracy/availability/timeliness). Add deep-linkable IDs: `#ai-output`, `#device-sensor`, `#driving`, `#emergency`, `#companion`. |
| `/legal/acceptable-use` | Add UGC enforcement clause (no illegal/infringing/harmful uploads, no impersonation, no scraping AI output for competing models). |
| `/legal/third-parties` | Add a "Service-availability note" header stating third-party providers may change without notice; data accuracy depends on the third party. |
| `/legal/subscription` | Add "Price & Plan Changes" section: we may modify pricing/plans with notice; renewals at new price after notice period; right to cancel before change takes effect. |
| `/legal/security` | Add user-side **Account Security Responsibilities** mirror block (password hygiene, device protection, report unauthorized access). |
| `/legal/license` | Add Open-Source attribution block referencing `/legal/open-source`. |

### 2. New routes

- `/legal/open-source` — Open-Source Software Notices. Auto-generated table sourced from `package.json` (name, version, license, link). Built once at compile time via a small script that reads `node_modules/<pkg>/package.json` for each top-level dep and outputs `src/lib/legal/open-source.generated.ts`. The legal page just renders the array. Includes the "we honor open-source licenses and preserve required notices" statement.
- `/legal/electronic-consent` — Electronic Consent & E-SIGN Disclosure (standalone for jurisdictions that require it to be presented separately at acceptance time).
- `/legal/regional` — International / Regional Disclosures hub: EU/EEA + UK (GDPR rights, DPO contact placeholder, EU withdrawal 14-day), California (CCPA/CPRA rights, "Do Not Sell or Share" — we don't sell), Canada (PIPEDA), Australia (Privacy Act + APPs), Brazil (LGPD). Each as a section with anchor IDs.
- `/safety` — **Risk & Safety Center** (top-level, not under `/legal` because we want it discoverable from the app shell and onboarding). Sections, each with anchor IDs: AI limitations, Health limitations, Driving safety (don't use Smart Alarm while operating a vehicle; don't follow Right Now recommendations while driving), Companion AI limitations (not a clinician, not crisis support, lists 988/911), Emergency procedures, Device limitations, User responsibilities, Safe-use recommendations. Plain language, large type, links into `/legal/disclaimers` for the legal text. Surfaced from:
  - Footer (new "Safety" link in Resources column)
  - `AppSidebar` user menu ("Safety Center")
  - Onboarding final step ("Before you start — read the Safety Center")
  - `SmartAlarmCard` + `RightNowCard` "Safety" inline link (already planned in Phase 1 step 7 — re-target to `/safety#driving` instead of `/legal/disclaimers#safety-sensitive`).
  - Companion Whisper footer mini-link to `/safety#companion`.

### 3. Registry + footer + sidebar updates

- Extend `LEGAL_DOCS` in `src/lib/legal/meta.ts` with the 3 new legal routes (`open-source`, `electronic-consent`, `regional`).
- Add `SAFETY_LINK` constant alongside (Safety Center is not a legal doc, so it stays separate).
- `SiteFooter`: add Safety Center under Resources; new legal docs listed under Legal.
- `AppSidebar`: add Safety Center to user menu under "Legal & Privacy".
- `Onboarding`: add a final consent step that surfaces Terms + Privacy + Disclaimers + Safety Center together with one combined checkbox (acceptance persisted to the `legal_acceptances` table planned in Phase 1 step 4).

### 4. Consistency sweep

A one-time pass across the codebase to make terminology identical to legal docs. Target files:
- `src/routes/index.tsx` (marketing landing) — feature names, "AI" wording.
- `src/routes/features.tsx`, `pricing.tsx`, `paywall.tsx` — match Subscription terms (auto-renew, refund, cancellation copy).
- `src/components/Onboarding.tsx` — make every claim about the product literally true (no "we predict your sleep perfectly", etc.).
- `src/components/AssistantSettings.tsx`, `NotificationsSection.tsx`, `WearableCard.tsx` — match Privacy + Third-Parties wording.
- `src/components/CompanionWhisper.tsx`, `SmartAlarmCard.tsx`, `RightNowCard.tsx` — match Safety Center wording and link targets.
- Add a short `docs/legal-vocabulary.md` (internal-only, not shipped to users) listing the canonical names so future edits stay consistent: **RestPilot AI**, **Smart Alarm**, **Long Clock**, **Right Now**, **Tomorrow Preview**, **Daily Review**, **Companion**, **AI Decision Center**, **AI Memory**, **Wearable Sync**, **Recovery Playbooks**, **Pattern Alerts**.

### 5. Pre-launch verification matrix

Add to `.lovable/plan.md` a checklist verifying every claim resolves to actual product behavior:

| Claim | Verified against |
|---|---|
| "We delete X on account deletion" | Phase 1 step 5 deletion endpoint expansion |
| "We let you export your data" | Phase 1 step 5 `exportAccountFn` |
| "We use these subprocessors" | `package.json` + `src/lib/wearables/*` + `src/routes/api/*` |
| "AI may be inaccurate" | Now in `/legal/disclaimers` AI Output Limitations |
| "Device data may be inaccurate" | Now in `/legal/disclaimers` Device & Sensor Limitations |
| "We may change features / models / providers" | Now in `/legal/terms` Service Availability |
| "Auto-renew + cancel anytime" | `/legal/subscription` + Stripe portal link in `/profile` |
| "Safety Center exists & is reachable" | New `/safety` route + footer + sidebar + card links |
| "Open-source notices are honored" | Generated `/legal/open-source` table |

### 6. Out of scope (explicit)

- No legal advice. Documents remain "Draft — pending attorney review" until the external counsel gate.
- No new AI features, no new product features. UGC clauses are forward-looking; we do not enable photo/video/voice uploads as part of this phase.
- No new payment flows. Subscription doc updates only refine wording.
- No analytics added. Cookie banner already covers consent toggle.

---

## Rollout order (once approved)

1. `meta.ts` registry extension + footer + sidebar links (scaffold only; pages stub-render so links resolve).
2. Build `/safety` (Risk & Safety Center) — highest user-visible value.
3. Expand `/legal/disclaimers` (AI Output Limitations + Device & Sensor Limitations) + retarget existing in-product safety links to `/safety`.
4. Expand `/legal/terms` (UGC, Service Availability, Account Security, Feedback License, E-SIGN summary, Age & Minor Consent).
5. New `/legal/electronic-consent` + `/legal/regional`.
6. Open-source generator script + `/legal/open-source` route.
7. Smaller expansions: `/legal/privacy`, `/legal/acceptable-use`, `/legal/third-parties`, `/legal/subscription`, `/legal/security`, `/legal/license`.
8. Consistency sweep across product surfaces + `docs/legal-vocabulary.md`.
9. Verification matrix run; mark "Ready for legal review".
10. External attorney review → remove draft banner, set final effective dates.

Awaiting approval. Want all 10 rollouts in order, or prioritize 1–3 (Safety Center + AI/device disclaimers — the highest-exposure items) as the first slice?
