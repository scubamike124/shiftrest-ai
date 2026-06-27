# Legal & Compliance Phase — Investigation & Plan

Goal: ship a complete, consistent, in-product legal package before launch. No attorney-substitute claims — the agent drafts review-ready templates clearly marked **"Draft — pending attorney review"** and wires them into the app. Final sign-off is gated on a qualified attorney's review (outside this scope).

---

## Investigation Findings (current state)

Already in the project:
- `src/routes/privacy.tsx` — short Privacy Policy (effective June 2026). Mentions location, shifts, notifications, account deletion. Does **not** cover: cookies, third-party processors, wearables, AI, retention windows, international transfers, children > 13 (only mentions <13), CCPA/GDPR rights.
- `src/routes/terms.tsx` — short ToS. Covers subscriptions (monthly/annual/lifetime), auto-renewal, lifetime definition, medical disclaimer, limitation of liability. Missing: arbitration, governing law, IP, indemnification, force majeure, cancellation/refund mechanics, free trial terms, promo pricing, acceptable use detail, DMCA.
- `src/components/site/SiteFooter.tsx` — links to Privacy + Terms only. No Cookie Policy / AUP / Accessibility / Disclaimers.
- `src/routes/profile.tsx` — has Delete Account flow (verified earlier).
- `src/lib/account.functions.ts` — cascades shifts, employers, prefs, coach_messages, then deletes auth user. **Gap:** does not delete `ai_memory`, `ai_log`, `ai_recommendations`, `ai_feedback`, `user_events`, `trips`, `tz_events`, `subscriptions`, push subscriptions, wearable tokens. Must be expanded for "right to deletion" claims to be truthful.
- Wearables: Fitbit + Oura OAuth live; Apple Health / Health Connect / Garmin / WHOOP listed as "coming soon" → disclosures must say *integrations available* vs *planned*.
- AI: Lovable AI Gateway (Gemini), OpenAI TTS, AI memory + recommendations + feedback + patterns. No AI disclosure surface exists yet beyond the medical line in ToS.
- Payments: Stripe web billing (monthly / annual / lifetime). App-store-specific copy is no longer relevant — web billing terms govern.
- Push: VAPID web push subscriptions table exists.

So the work is part **new content**, part **expanding existing routes**, part **wiring consent + disclosures into product surfaces**, part **making the deletion endpoint match the privacy promise**.

---

## Deliverables

### 1. Legal document set (new + rewritten routes)

Each is a standalone route with proper `head()` (title, description, canonical, og), a "Last updated" date, a "Draft — pending attorney review" banner until sign-off, and a shared `<LegalLayout>` wrapper for consistent typography and a sidebar TOC.

| Route | Status |
|---|---|
| `/legal` | New index page linking every document with one-line summaries |
| `/legal/terms` | Rewrite of current `/terms` — full ToS (acceptable use, IP, indemnification, force majeure, governing law, dispute resolution + arbitration + class-action waiver placeholder, warranty disclaimer, no guarantee of outcomes, termination, changes, contact). Old `/terms` redirects. |
| `/legal/privacy` | Rewrite of current `/privacy` — full Privacy Policy (collection, use, legal bases, retention table, deletion, export, third parties, international transfers, children, CCPA/CPRA, GDPR/UK, contact / DPO). Old `/privacy` redirects. |
| `/legal/cookies` | Cookie Policy — what we set (auth session, theme, offline cache, `rp_last_visit`, push), categories, no third-party ad cookies, how to clear, link to cookie banner controls |
| `/legal/acceptable-use` | AUP — prohibited content/conduct, automated abuse, enforcement, reporting |
| `/legal/accessibility` | Accessibility Statement — WCAG 2.1 AA target, known limitations, feedback channel |
| `/legal/copyright` | DMCA / copyright complaint policy + designated agent placeholder |
| `/legal/trademark` | "RestPilot AI", logo marks, permitted/forbidden use, request process |
| `/legal/license` | EULA — limited personal license, restrictions (reverse-engineer, scrape, resell), open-source notices section |
| `/legal/subscription` | Full subscription terms: monthly/annual/lifetime, billing cycle, auto-renew, cancellation, refunds (incl. statutory EU 14-day withdrawal language placeholder), free trial terms, promo pricing, price changes notice, taxes |
| `/legal/disclaimers` | Master disclaimers page (AI, health & wellness, not-a-medical-device, no doctor-patient relationship, informational only, recommendation accuracy, user responsibility, emergency 911, safety-sensitive activities) — each as a labeled section so we can deep-link `/legal/disclaimers#safety-sensitive` from in-product surfaces |
| `/legal/security` | Security practices summary + Responsible Disclosure + vulnerability reporting (`security@restpilot.ai`) + breach notification commitment |
| `/legal/third-parties` | Subprocessors & integrations table: Lovable Cloud (hosting/auth/db), Stripe (billing), OpenAI (TTS), Lovable AI Gateway / Google Gemini (text), Fitbit, Oura, Open-Meteo (weather), BigDataCloud (reverse geocode), Web Push (browser vendors). For each: data shared, purpose, jurisdiction placeholder, link to their policy. "Planned" integrations (Apple Health, Health Connect, Garmin, WHOOP, calendar/traffic/maps) listed separately as not yet active. |

All routes share:
- `<LegalLayout>` component in `src/components/legal/LegalLayout.tsx` (sidebar TOC desktop, accordion on mobile, "Print" button, "Effective" + "Last updated" dates, draft banner).
- `src/lib/legal/meta.ts` exporting a single `LEGAL_DOCS` array — title, slug, summary, effective date — consumed by `/legal` index, footer, and sitemap. Single source of truth.

### 2. In-product disclosures (surfaces that change)

- **Sign-up / `/auth`**: required checkbox "I agree to the [Terms](/legal/terms), [Privacy Policy](/legal/privacy), and acknowledge the [AI & Health Disclaimers](/legal/disclaimers)." Blocks submit when unchecked. Persist acceptance row in new `legal_acceptances` table (`user_id`, `doc_slug`, `version`, `accepted_at`, `ip` optional).
- **First wearable connect** in `WearableCard`: modal showing what data Fitbit/Oura returns and a link to `/legal/third-parties`. Acceptance also persisted.
- **First push opt-in** in `NotificationsSection`: short consent line + link to Cookie Policy / Privacy.
- **Smart Alarm + Right Now cards**: a small "Safety" note + `<WhyButton>`-style link to `/legal/disclaimers#safety-sensitive` so the safety-sensitive disclaimer is one tap from any actionable recommendation. Plain copy, not a popup wall.
- **Paywall**: append concise auto-renew + refund summary block under the plan grid linking to `/legal/subscription`. Pre-checkout checkbox already required for sub purchase confirmation.
- **Offline banner**: tiny "Stored on this device — see [Privacy](/legal/privacy#local-storage)" tooltip.
- **Cookie/consent banner**: minimal first-visit banner (Accept / Essential only). Essential-only mode skips non-essential storage (none today, but the switch is wired so future analytics respects it). Choice cached in `localStorage` + mirrored to `user_prefs.consent_json` once signed in.
- **Footer**: expand `SiteFooter` "Company" column → full legal menu (Terms, Privacy, Cookies, AUP, Accessibility, Disclaimers, Subscription, Security, Third Parties, License, Copyright, Trademark) and add "Last updated" stamp.

### 3. Data deletion endpoint — make truthful

Expand `deleteAccountFn` to also remove rows in: `ai_memory`, `ai_log`, `ai_recommendations`, `ai_feedback`, `user_events`, `trips`, `tz_events`, `subscriptions` (cancel active Stripe subs first, then delete), `push_subscriptions`, wearable token rows (`wearable_connections` / equivalent). Add a new `exportAccountFn` returning a JSON archive of all user-owned data so the Privacy Policy's "data export" promise is truthful. Add `purgeAiMemoryFn` separately so users can wipe AI memory without nuking the account (link from `/memory` page).

### 4. Schema additions (one migration)

- `legal_acceptances(user_id, doc_slug, version, accepted_at, ip_hash nullable, ua nullable)` with RLS (`user_id = auth.uid()` for select/insert; service_role full). GRANTs for `authenticated` + `service_role` per project rule.
- `user_prefs.consent_json jsonb` column (cookie/marketing toggles).

No new AI tables, no new edge functions.

### 5. SEO + discoverability

- Add every legal route to the future sitemap (route metadata exported via `LEGAL_DOCS`).
- Each legal route gets unique title + description (avoid duplicate-title SEO findings later).
- Canonical tags on every legal route.
- `/legal` linked from footer and the user-menu in `AppSidebar` ("Legal & Privacy").

### 6. App Store compliance (kept as a future-ready checklist)

We are web-first. The plan documents — but does not implement — App Store / Play-specific surfaces. The Subscription doc + Disclaimers doc are written so they can be reused inside a future iOS/Android wrapper with no rewrites. Apple-specific clauses (e.g. "billed via Apple ID") are excluded today and noted as TODO for when native ships.

### 7. Review & sign-off gates (process, not code)

Two manual gates before launch:
1. **Internal pass** — verify every document matches actual product behavior (deletion really deletes, retention numbers match what the DB does, "we use X" matches `package.json` + integrations list).
2. **Attorney pass** — external counsel reviews the full set, fills in jurisdiction-specific blanks (governing law, arbitration venue, refund windows per region, DPA template if needed). Draft banner is removed only after this.

Both gates are tracked in `.lovable/plan.md` so we don't ship with the draft banner still on.

---

## Out of scope (explicit)

- No legal advice. Documents are review-ready drafts only.
- No new AI features, no marketing redesign, no payment flow changes beyond appending the legal summary block.
- No native app code.
- No analytics / tracking pixels added (cookie banner is wired for future use).

## Verification

- `tsgo` clean after route + component additions.
- Playwright at 390×844 and 1280×800: every `/legal/*` route loads, sidebar TOC scrolls, footer links all resolve, sign-up checkbox blocks submit when unchecked, paywall shows renew block.
- Manual: run `deleteAccountFn` against a seeded test user, confirm zero rows remain across all listed tables; run `exportAccountFn`, confirm archive contains every category the Privacy Policy lists.
- Cross-check: every claim in `/legal/privacy` retention table maps to a real table; every entry in `/legal/third-parties` maps to a real dependency or wearable adapter; remove anything we don't actually use.

---

## Suggested rollout order (once approved)

1. Shared `<LegalLayout>` + `LEGAL_DOCS` registry + `/legal` index + footer rewrite.
2. Rewrite `/legal/terms`, `/legal/privacy`, redirects from old paths.
3. New documents: cookies, AUP, accessibility, copyright, trademark, license, subscription, disclaimers, security, third-parties.
4. `legal_acceptances` migration + sign-up checkbox + first-connect modals.
5. Deletion + export endpoint expansion.
6. Cookie consent banner.
7. In-product safety links (Smart Alarm, Right Now, Paywall renew block, Offline tooltip).
8. Internal QA pass → mark documents "Ready for legal review" (draft banner stays).
9. Attorney review (external) → remove draft banner, set final effective dates.

Awaiting approval before any code is written. Want me to proceed with all 9 rollouts, or trim to a smaller first slice (e.g. steps 1–3 only)?
