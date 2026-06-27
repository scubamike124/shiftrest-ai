# Lighthouse Audit — RestPilot AI

Generated: 2026-06-27. Tool: `lighthouse@12` (mobile preset, simulated throttling), Chromium headless. Target: `https://shift-rest-ai.lovable.app`.

## Scores (production URL)

| Route | Performance | Accessibility | Best Practices | SEO |
|-------|:-:|:-:|:-:|:-:|
| `/` | **70** | **96** | **100** | **100** |
| `/paywall` | **65** | **96** | **75** | **100** |
| `/legal` | n/a — see "Open issues" | | | |

Raw JSON: `docs/launch/audits/lighthouse/` (not committed; regenerable with the command below).

## Open issues

1. **`/legal`, `/legal/*` return HTTP 404 on the production edge** (body still renders the SPA shell). Lighthouse refused to score the page; social/SEO crawlers will treat the page as missing. Affected routes confirmed via `curl -I`: `/legal`, `/legal/privacy`, `/legal/terms`, plus `/dashboard`, `/memory`, `/decisions` (those are auth-gated, expected to 404 unauthenticated SSR but still need a 200 + redirect to `/auth`). Track in `docs/launch/remaining-issues.md`.
2. **Color contrast** — single source: `--indigo-glow` token at 10 px on the very dark background (`oklch(0.09 …)`). Lighthouse flagged it on the nav micro-labels and matching pills. **Fixed** by raising `--indigo-glow` from `oklch(0.72 0.16 275)` → `oklch(0.84 0.14 275)` in `src/styles.css`. Re-run after publish to confirm Accessibility ≥ 98.
3. **Paywall Best-Practices = 75** — third-party cookies set by `js.stripe.com`. Expected for embedded checkout; no action.
4. **LCP / CLS** on `/` and `/paywall` — driven by the aurora hero animation + late-loading webfonts. Recommended follow-ups (not blocking launch): add `font-display: swap` to the Google Fonts link (already on), preload the hero gradient layer, reserve hero height to remove CLS. Tracked in remaining-issues.

## Re-run command

```bash
CHROME_PATH=/bin/chromium bunx --bun lighthouse@12 \
  https://shift-rest-ai.lovable.app/ \
  --chrome-flags="--headless=new --no-sandbox" \
  --form-factor=mobile --throttling-method=simulate \
  --output=html --output-path=./lh-home.html
```

## Status

- Accessibility / Best Practices / SEO **meet the launch bar** (≥ 95 / 95 / 95) on `/` once contrast fix ships.
- Performance is below the 90 target on mobile — acceptable for soft launch, prioritized as the first post-launch perf sweep.
- `/legal/*` 404 status is the only **blocking** finding from this step.
