# Launch Performance Polish — Batch 1

## Investigation summary

Static audit of `/` (`src/routes/index.tsx`, 1145 lines), `/paywall` (`src/routes/paywall.tsx`, 346 lines), `__root.tsx`, `vite.config.ts`, `src/styles.css`, `src/router.tsx`, `package.json`, and every top-level import in the shared shell.

### What's already good
- Below-fold home sections are gated behind `requestIdleCallback` (`showBelowFold`) — hero renders alone first.
- All hero art is CSS gradients + inline SVG — no LCP image to optimize.
- No heavy libs (three, drei, recharts, react-markdown, livekit-client, simli-client, embla) are reachable from `/` or `/paywall` — verified via ripgrep.
- PWA app-shell precache is already in place.
- `@fontsource/instrument-serif` + `@fontsource/work-sans` are self-hosted via `src/router.tsx` — the fonts the design system actually uses.
- Marketing surface skips `CompanionDock` / `AppSidebar` / `Onboarding` / `DebugHUD` (`surfaceFor` in `__root.tsx`).

### Root-cause findings (ordered by impact)

1. **DEAD render-blocking Google Fonts stylesheet on every page** — biggest single win.
   `src/routes/__root.tsx` head links inject:
   ```
   https://fonts.googleapis.com/css2?family=Inter:...&family=Space+Grotesk:...&display=swap
   ```
   plus two `preconnect` links to `fonts.googleapis.com` / `fonts.gstatic.com`.
   `Inter` and `Space Grotesk` are **not referenced anywhere** in the codebase (`src/styles.css` sets `--font-display: "Instrument Serif"` and `--font-sans: "Work Sans"`, both loaded from `@fontsource`).
   Impact: one extra render-blocking external CSS request + two preconnects + two font family downloads that no glyph on the page will ever use. Directly hurts FCP and LCP on every route, worst on mobile (extra RTT + DNS).

2. **Stripe SDK statically imported into the paywall chunk** — biggest paywall win.
   `src/routes/paywall.tsx` top-level imports `EmbeddedCheckoutProvider`, `EmbeddedCheckout` from `@stripe/react-stripe-js`, and `src/lib/stripe.ts` statically imports `@stripe/stripe-js` (`loadStripe`). The Stripe React wrappers + `stripe-js` loader shell (~50–70 kB min+gz) ship in the initial `/paywall` bundle before the user even picks a plan, and `loadStripe` isn't strictly necessary until "Start trial" is clicked. Everything above line 120 in `paywall.tsx` is a static plan-selection UI — it doesn't need Stripe.

3. **Supabase SDK eagerly imported on the landing page**.
   `src/routes/index.tsx` line 27 imports `@/integrations/supabase/client` just to call `supabase.auth.getSession()` in a `useEffect` to pick the CTA href. The whole supabase-js SDK lands in the `/` chunk. On the marketing homepage the CTA can safely default to `/auth` and upgrade to `/dashboard` after a deferred check.

4. **Display font is likely the LCP element on `/` but is not preloaded.**
   Hero H1 uses `font-family: var(--font-display)` (`Instrument Serif`). `@fontsource` self-hosts it but doesn't emit a `<link rel="preload" as="font">`. Without a preload, the browser has to discover the font from the CSS request, which delays LCP paint. One targeted preload of the `400` weight woff2 on `/` (leaf-route `head().links`) closes this gap.

5. **`SiteHeader` scroll listener** — attaches a raw scroll listener with an inline setState on every scroll event. Passive is set, but this causes React re-renders on every scroll. Minor, mobile-only impact. Fix with `requestAnimationFrame` throttling — small polish, not urgent.

Non-issues confirmed:
- `defaultBehavior` code splitting works — route components auto-split.
- `ssr.external` isn't set (would break the Worker; it isn't).
- No N+1 or heavy client fetches from `/` or `/paywall`.
- `preview` warning banner, `CookieBanner`, `UpdateBanner`, `Toaster` are tiny.

## Plan

Bundled as one internal-verify batch, no publish until the whole batch is verified with a production build.

### Changes

1. **Remove the dead Google Fonts stylesheet from `src/routes/__root.tsx`.**
   Delete the three head-link entries for `fonts.googleapis.com` / `fonts.gstatic.com` preconnects and the `Inter + Space Grotesk` stylesheet. Fonts stay self-hosted via existing `@fontsource` imports in `src/router.tsx`.

2. **Preload the display font on `/` (leaf route only).**
   In `src/routes/index.tsx` `head().links`, add:
   ```
   { rel: "preload", as: "font", type: "font/woff2",
     href: "<@fontsource/instrument-serif 400 woff2 URL>",
     crossOrigin: "anonymous" }
   ```
   Resolve the exact URL from the installed `@fontsource/instrument-serif` package files (Vite serves them from `/assets/...`); use the same URL the CSS already references so the browser dedupes.

3. **Lazy-load Stripe on the paywall.**
   - In `src/routes/paywall.tsx`, remove the static `@stripe/react-stripe-js` import.
   - When `clientSecret` becomes non-null, dynamically `import("@stripe/react-stripe-js")` and render its exports inside a small local component (React `lazy` + `Suspense` fallback = existing skeleton).
   - In `src/lib/stripe.ts`, keep `getStripe()` returning `loadStripe(...)`; because it's called inside `startCheckout()` (event handler), `stripe-js` no longer lands in the initial chunk when we remove the top-level import from `paywall.tsx` (the `getStripe` call path is only reached after the user clicks).

4. **Defer the Supabase session check on the landing page.**
   In `src/routes/index.tsx`:
   - Default `ctaHref` to `/auth` at render (0 layout shift — SiteHeader already handles signed-in redirect via `__root`).
   - Move the supabase import inside the `useEffect` as `const { supabase } = await import("@/integrations/supabase/client")`, still inside the existing effect so the CTA upgrades to `/dashboard` when a session exists.
   - Keeps the same UX; removes supabase-js from the marketing `/` chunk.

5. **rAF-throttle `SiteHeader` scroll handler.**
   In `src/components/site/SiteHeader.tsx`, wrap the scroll listener in a single-frame `requestAnimationFrame` guard so `scrolled` state updates at most once per frame. Small perf polish, cheap edit, in-scope for this batch.

### Explicitly out of scope
- AI edge rate limiting (next batch).
- Image transformer / new `og:image` generation.
- Any route architecture changes.
- Any changes under `/dashboard`, `/companion`, or `agent-worker/`.

### Verification (internal, before any publish)
1. `bun run build` — confirm build succeeds; inspect emitted chunk sizes and confirm:
   - `/` chunk no longer contains `@supabase/*` code.
   - `/paywall` chunk no longer contains `@stripe/*` code (should appear only in a separately-emitted async chunk).
2. Grep the dev server response headers / `HeadContent` on `/` and `/paywall` to confirm no `fonts.googleapis.com` link remains and the Instrument Serif preload is present on `/`.
3. Playwright smoke: load `/`, click "Start free" → lands on `/auth`; load `/paywall`, click a plan + "Start 7-day free trial" → embedded checkout still mounts (fallback shown briefly). Screenshot both.
4. Playwright Lighthouse (mobile emulation) against local `bun run preview` — capture before/after Performance scores for `/` and `/paywall` and record in `docs/launch/performance-report.md`.

### Publish
Only after all four verification steps pass. Single publish for the whole batch.

## Technical details
- Font preload URL: read the exact woff2 filename `@fontsource/instrument-serif` ships (e.g. `.../files/instrument-serif-latin-400-normal.woff2`) and import it as `?url` from the route file so Vite emits a hashed asset URL that matches what the runtime CSS request will hit — guarantees the preload is used, not duplicated.
- Dynamic Stripe import wrapper: `const Stripe = React.lazy(() => import("@stripe/react-stripe-js").then(m => ({ default: (props) => <m.EmbeddedCheckoutProvider {...props}><m.EmbeddedCheckout /></m.EmbeddedCheckoutProvider> })));` — one code-split boundary, Suspense fallback keeps the existing "Back to plans" affordance visible.
- Landing supabase deferral: move both the import and the call into the effect body; no functional change to the CTA behavior, just tree-shaken out of the marketing chunk.

Approve and I'll implement all five changes, run the verification steps, and publish once the batch is green.
