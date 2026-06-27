# Remaining Pre-Launch Issues — RestPilot AI

Updated: 2026-06-27 (Pre-Launch Validation pass).

## Blocking

1. **`/legal/*` returns HTTP 404 on the production edge** while still rendering the SPA shell. Repro: `curl -sI https://shift-rest-ai.lovable.app/legal/privacy` → `HTTP/2 404`. Crawlers and Lighthouse will treat the pages as missing. Likely an SSR/prerender mismatch — re-publish after the LegalLayout `<main>` → `<section>` fix and re-test. If it persists, inspect Worker logs for the legal subtree.
2. **Authenticated E2E regression not executed** — sandbox `LOVABLE_BROWSER_AUTH_STATUS=signed_out`. Owner needs to sign in to the live preview to inject a managed Supabase session.
3. **Live Stripe charge not executed** — requires explicit owner approval (real card, real money).
4. **Real-device cross-browser pass** — iOS Safari, Android Chrome, iPad, Safari/Firefox/Edge desktop. Owner-driven.

## Non-blocking (post-launch hardening)

- **Performance on `/` and `/paywall`** — mobile Lighthouse perf 70 / 65. Drivers: aurora hero CLS, late-loading Stripe iframe. Plan: preload hero gradient layer, defer Stripe.js until paywall view, add `loading="lazy"` to below-fold images.
- **`region` axe moderate finding** — small chunks of footer / nav microcopy live outside a landmark. Cosmetic; no AT impact in spot-checks.
- **Rate limiting on `/api/coach`, `/api/ai`, `/api/tts`** — currently bounded only by `has_ai_budget` 60k-token/24h cap. Add edge-layer token bucket keyed by `userId`.
- **WebKit / Firefox headless Playwright runs** — binaries not pre-installed in sandbox. Run locally before public announcement.
- **Native wearable wrappers** (Apple Health / Garmin) — still "coming soon".
- **Color-contrast fix** (`--indigo-glow` brightened) needs publish + re-run of Lighthouse to confirm Accessibility ≥ 98.

## Resolved this turn

- `landmark-no-duplicate-main` / `landmark-main-is-top-level` on legal routes — switched `LegalLayout` + `legal.index` from `<main>` to `<section aria-label>`.
- Color contrast on `--indigo-glow` — token brightened in `src/styles.css`.
