# Remaining Pre-Launch Issues — RestPilot AI

Updated: 2026-07-26 (overnight RestPilot pass). See also `docs/launch/OVERNIGHT-2026-07-26.md`.

## Blocking

1. **Authenticated E2E regression not executed** — sandbox `LOVABLE_BROWSER_AUTH_STATUS=signed_out`. Owner needs to sign in to the live preview to inject a managed Supabase session.
2. **Live Stripe charge not executed** — requires explicit owner approval (real card, real money).
3. **Real-device cross-browser pass** — iOS Safari, Android Chrome, iPad, Safari/Firefox/Edge desktop. Owner-driven.

## Overnight 2026-07-26 (cleared / verified)

- Branding: package name `restpilot-ai`; public canonical/OG/production links → `restpilotai.com`. Legacy `shiftrest.*` localStorage keys kept.
- Production smoke: `/`, `/auth`, `/plan`, `/pricing`, `/features`, `/legal/privacy`, `/api/public/health` all HTTP 200.
- Planner fixes: MultiDayPlan shift-start display; plan sunrise/`activeDate` + cycle-aware day dots.
- Build green; PWA injectManifest empty-glob warning still present (non-blocking).

## Non-blocking (post-launch hardening)

- **Performance on `/` and `/paywall`** — mobile Lighthouse was 70 / 65. Mitigations applied 2026-07-24: paywall loads `@stripe/stripe-js` only after Checkout starts (`stripe-config` split); home hero aurora layers given fixed min-heights for CLS. Re-measure Lighthouse after publish.
- **WebKit / Firefox headless Playwright runs** — binaries not pre-installed in sandbox. Run locally before public announcement.
- **Native wearable wrappers** (Apple Health / Garmin) — still "coming soon".
- **Color-contrast fix** (`--indigo-glow` brightened) needs publish + re-run of Lighthouse to confirm Accessibility ≥ 98.
- **ESLint** — 2026-07-24 Amber pass: **0 errors**; remaining warnings are react-refresh export notes + a few hook dependency nits. Timeline `total` dep and automations `devices` memo stabilized.

## Resolved

- **Rate limiting on `/api/coach`, `/api/ai`, `/api/tts`** — `/api/coach` forwards to `/api/ai`; `/api/ai` and `/api/tts` enforce per-user `enforceRateLimit` (token bucket via `rate_limit_hit` RPC) on top of `has_ai_budget`.
- **`region` axe moderate finding (footer nav microcopy)** — footer link columns wrapped in `<nav aria-label>` landmarks; copyright strip labeled `contentinfo` (2026-07-23 autonomous pass).
- `/legal/*` 404 on production edge — cleared. Custom domain (`https://restpilotai.com/legal/*`) returns HTTP 200; `shift-rest-ai.lovable.app` 302-redirects to the custom domain by design.
- `landmark-no-duplicate-main` / `landmark-main-is-top-level` on legal routes — switched `LegalLayout` + `legal.index` from `<main>` to `<section aria-label>`.
- Color contrast on `--indigo-glow` — token brightened in `src/styles.css`.
- LiveKit Realtime Companion cloud deploy — moved to the deferred final-launch-phase section of the launch checklist; not a feature-work blocker.
