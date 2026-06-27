# Accessibility Audit — RestPilot AI

Generated: 2026-06-27. Tool: `axe-core@4.10` injected via Playwright (Chromium headless, viewport 1280×1800). Target: `http://localhost:8080` (current preview build).

## Routes scanned (public)

`/`, `/auth`, `/paywall`, `/legal/`, `/legal/privacy`, `/safety`, `/pricing`, `/features`.

Authenticated routes (`/dashboard`, `/memory`, `/decisions`, `/profile`) require a signed-in Supabase session. They are NOT covered in this run — see "Outstanding work" below.

## Findings summary

| Severity | Rule | Affected routes | Status |
|----------|-----|----------------|--------|
| Serious | `color-contrast` | all 8 | **Fixed** — `--indigo-glow` brightened in `src/styles.css` |
| Moderate | `landmark-no-duplicate-main` | `/legal/`, `/legal/privacy` | **Fixed** — `LegalLayout` + `legal.index` now use `<section aria-label>` (root already provides `<main>`) |
| Moderate | `landmark-main-is-top-level` | `/legal/`, `/legal/privacy` | **Fixed** — same change |
| Moderate | `landmark-unique` | `/legal/*` | **Fixed** — collapsed duplicate main |
| Moderate | `region` (non-landmark content) | `/`, `/safety`, `/legal/*`, `/paywall`, `/features`, `/pricing` | **Open** — small chunks of footer/nav copy sit outside any landmark; cosmetic, no AT impact in spot-checks. Tracked. |

Critical violations: **0**.

## Manual spot-checks

- Keyboard nav: tab order on `/`, `/auth`, `/paywall` is linear and visible. Skip-link present in root.
- Focus rings: rendered via the Tailwind `focus-visible:ring` defaults. Visible on Chromium.
- Heading order: every audited page has exactly one `h1`; no skipped levels in spot-checks.
- Form labels on `/auth`: every input has an associated `<label>`; checkbox for legal acceptance is keyboard-reachable.
- ARIA on custom widgets: cookie banner, consent modal, dialogs — all use Radix primitives; ARIA correct out of the box.

## Re-run command

```bash
python3 /tmp/browser/axe/run.py   # script committed under docs/launch/audits/scripts/axe-scan.py
```

## Outstanding work

1. **Authenticated routes** (`/dashboard`, `/memory`, `/decisions`, `/profile`, `/coach`, `/plan`, `/playbooks`, `/swap`, `/share`, `/events`) — require a Supabase session to scan. Will be covered in the Playwright E2E sweep (Step 3) once the project owner signs in via the preview so `LOVABLE_BROWSER_AUTH_STATUS` flips to `injected`.
2. `region` landmark moderates — re-evaluate after wrapping orphan microcopy in `<aside>` / `<footer>`. Non-blocking.

## Status

Critical: 0. Serious: 0 remaining after fixes. Moderate: 1 class remaining (`region`), tracked. **Public-route accessibility meets launch bar.**
