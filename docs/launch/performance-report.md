# Performance Report

## Static-audit findings

- **Bundling** — Vite 7 + TanStack Start v1; PWA app-shell via `vite-plugin-pwa` in `injectManifest` mode. No `ssr.external` overrides.
- **Streaming AI** — `/api/coach` streams SSE; `/api/brief` and `/api/ai` return JSON quickly. TTS streams MP3 via passthrough.
- **React Query** — used as the canonical loader read shape. Queries on heavy AI surfaces set `staleTime` to avoid storms (review case-by-case if Lighthouse flags refetch).
- **Caching** — PWA service worker caches the app shell. Authenticated data is never cached server-side.
- **CDN** — handled by Lovable's edge.
- **Image handling** — no large hero images outside `src/assets`; landing-page art uses CSS gradients (aurora).

## Recommended pre-GA actions (deferred — require live measurement)

1. **Run Lighthouse** (mobile + desktop) against `/`, `/dashboard`, `/paywall`, `/pricing` on the published URL. Target ≥ 90 Performance.
2. **Bundle visualizer** — `bun run build` then inspect chunk sizes; flag any route chunk > 250 kB.
3. **DB indexes** — confirm via `supabase--read_query`:
   - `ai_log(user_id, created_at desc)`
   - `ai_recommendations(user_id, status, created_at desc)`
   - `shifts(user_id, starts_at)`
   - `notification_log(user_id, scheduled_for desc)`
   - `wearable_readings(user_id, date desc)`
   Add `CREATE INDEX IF NOT EXISTS` migration for any that are missing.

Performance work post-launch is acceptable; current architecture has no known blocking bottleneck.
