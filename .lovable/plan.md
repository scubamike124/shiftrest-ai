# Phase 1 Remaining Work — Priority Audit

Snapshot after Batches A + B verified in production (Build `b-1782952743743`). Smart Alarm stays disabled for Phase 1.

---

## 1. Remaining Launch Blockers (must ship before public launch)

| # | Item | Why it blocks |
|---|---|---|
| B1 | **Robots + sitemap** — add `public/robots.txt` and `public/sitemap.xml` covering only shippable Phase 1 routes (index, pricing, features, legal/*, auth). Exclude `/qa.*`, `/lab.*`, `/version`, `/debug`. | Without these, crawlers index dev/QA routes and rank the wrong pages. |
| B2 | **Noindex the dev/QA routes** — add `robots: "noindex"` meta to `qa.smart-alarm.tsx`, `qa.voice.tsx`, `lab.avatar-poc*.tsx`, `version.tsx`. | Defense-in-depth if robots.txt is ignored. |
| B3 | **Global error + 404 boundaries** — verify `__root.tsx` has `notFoundComponent`, router config has `defaultErrorComponent`, and top-level routes with loaders have both. | A single loader throw currently white-screens users. |
| B4 | **Stripe live-mode sanity** — confirm `STRIPE_SECRET_KEY` in production is `sk_live_*`, webhook endpoint points at production URL, and one real $0.50 test purchase completes end-to-end then refunded. | Payment failure at launch is unrecoverable brand damage. |
| B5 | **Auth flow smoke on production** — sign-up, email confirm, sign-in, password reset, sign-out, session persistence across refresh, all from an incognito device. | Batches A/B changed auth guards; needs one manual pass. |

---

## 2. Nice-to-have Polish (ship if cheap, otherwise defer)

| # | Item |
|---|---|
| P1 | Favicon + apple-touch-icon set derived from the new aurora OG cover. |
| P2 | `/pricing` and `/features` meta descriptions audit — currently generic. |
| P3 | JSON-LD `Organization` + `WebSite` on `__root.tsx`; `Product` on `/pricing`. |
| P4 | Consistent empty states on `/inbox`, `/decisions`, `/memory` (some show blank cards). |
| P5 | Loading skeletons on `/dashboard` and `/companion` first paint. |
| P6 | `/legal/index` landing polish — currently a bare link list. |

---

## 3. Wait Until After Launch (Phase 2)

- Smart Alarm re-enable (flag flip + push backstop verification).
- Wearable OAuth expansion (Apple Health, Garmin, Whoop).
- Native iOS/Android wrappers.
- Partner Mode multi-user invites.
- Shift Swap Copilot marketplace.
- AI voice cloning per user.
- Web Push notifications beyond alarms.
- Team/employer admin dashboard.

---

## 4. Recommended Batch C Scope (small + focused)

**Ship only B1 + B2 + B3.** These are pure static/config additions with near-zero regression risk and cover the biggest remaining SEO + reliability gaps.

Leave B4 (Stripe live test) and B5 (auth smoke) as **operator checklist items** — they are manual verification, not code changes, and can run in parallel to Batch C.

Explicitly excluded from Batch C: any polish item (P1–P6), any Phase 2 work, any Smart Alarm changes, any refactors.

---

## 5. Estimated Effort

| Item | Effort |
|---|---|
| B1 robots + sitemap | ~15 min — two static files |
| B2 noindex dev routes | ~10 min — add one meta entry per file |
| B3 error/404 boundaries audit + fix | ~20 min — one root check, spot-fix loaders that lack boundaries |
| **Batch C total** | **~45 min of edits + 1 verification pass** |
| B4 Stripe live test | ~15 min operator time (no code) |
| B5 Auth smoke | ~10 min operator time (no code) |

---

## 6. Files Likely to Change (Batch C only)

**New files**
- `public/robots.txt`
- `public/sitemap.xml`

**Edited files (meta additions only, no logic changes)**
- `src/routes/qa.smart-alarm.tsx`
- `src/routes/qa.voice.tsx`
- `src/routes/lab.avatar-poc.tsx`
- `src/routes/lab.avatar-poc.index.tsx`
- `src/routes/lab.avatar-poc.debug.tsx`
- `src/routes/lab.avatar-poc.simli.tsx`
- `src/routes/version.tsx`

**Audited, edited only if missing**
- `src/routes/__root.tsx` (confirm `notFoundComponent` present)
- `src/router.tsx` (confirm `defaultErrorComponent` present)
- Any route with a loader that lacks `errorComponent` / `notFoundComponent`

No touches to: `src/lib/flags.ts`, Smart Alarm code, Companion, auth middleware, Stripe routes, DB migrations, or any Phase 2 feature.

---

## Verification (post-Batch C)

1. `bunx tsgo --noEmit` clean.
2. `curl https://shift-rest-ai.lovable.app/robots.txt` returns expected rules.
3. `curl https://shift-rest-ai.lovable.app/sitemap.xml` returns valid XML.
4. `curl https://shift-rest-ai.lovable.app/qa.smart-alarm | grep noindex` present.
5. Build ID rotated.
6. Manual: force-throw in one loader confirms error boundary renders.

Stop after Batch C. B4 + B5 operator checks run separately.
