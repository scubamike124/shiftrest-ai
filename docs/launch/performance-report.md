# Performance Report

## Static-audit findings

- **Bundling** — Vite 7 + TanStack Start v1; PWA app-shell via `vite-plugin-pwa` in `injectManifest` mode. No `ssr.external` overrides.
- **Streaming AI** — `/api/coach` streams SSE; `/api/brief` and `/api/ai` return JSON quickly. TTS streams MP3 via passthrough.
- **React Query** — used as the canonical loader read shape. Queries on heavy AI surfaces set `staleTime` to avoid storms (review case-by-case if Lighthouse flags refetch).
- **Caching** — PWA service worker caches the app shell. Authenticated data is never cached server-side.
- **CDN** — handled by Lovable's edge.
- **Image handling** — no large hero images outside `src/assets`; landing-page art uses CSS gradients (aurora).

## Batch 1 shipped (Launch Performance Polish)

Applied 2026-07-04:

1. Removed dead render-blocking Google Fonts stylesheet + preconnects from `src/routes/__root.tsx`. `Inter` and `Space Grotesk` were never referenced — the app uses `Instrument Serif` + `Work Sans` self-hosted via `@fontsource`. One external CSS request + two DNS preconnects removed from every page.
2. Preloaded the Instrument Serif 400 woff2 on `/` only (LCP font) via the leaf route's `head().links`.
3. Code-split `@stripe/react-stripe-js` on `/paywall`. Initial `paywall-*.js` chunk is now ~10 KB; Stripe wrappers ship as an async `react-stripe.esm-*.js` (17 KB) fetched only when the user starts checkout. `getStripe` / `loadStripe` continues to defer Stripe.js iframe until click.
4. Deferred `@supabase/supabase-js` on `/` — dynamic-imported inside the CTA effect so the marketing chunk no longer eagerly pulls the SDK.
5. rAF-throttled the `SiteHeader` scroll listener to at most one `setState` per frame.

### Verification
- `bun run build` — succeeded; chunk sizes confirmed above.
- Grepped served HTML: 0 `googleapis` references, Instrument Serif preload link present on `/`.
- Paywall renders unchanged; Suspense fallback appears briefly on first checkout open while the Stripe async chunk loads.

## Recommended follow-ups (post-launch tuning)

1. Run Lighthouse (mobile + desktop) against `/`, `/dashboard`, `/paywall`, `/pricing` on the published URL. Target ≥ 90 Performance.
2. Bundle visualizer — inspect for any surprise regressions.
3. DB indexes — confirm via `supabase--read_query`:
   - `ai_log(user_id, created_at desc)`
   - `ai_recommendations(user_id, status, created_at desc)`
   - `shifts(user_id, starts_at)`
   - `notification_log(user_id, scheduled_for desc)`
   - `wearable_readings(user_id, date desc)`

Performance work post-launch is acceptable; current architecture has no known blocking bottleneck.
