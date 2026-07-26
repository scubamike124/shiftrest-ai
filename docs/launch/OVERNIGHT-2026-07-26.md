# Overnight pass — 2026-07-26 (RestPilot AI)

## Branding

- No user-facing "ShiftRest" / "Shift Rest" copy remained in `src/` or `public/`.
- Updated leftover `shift-rest-ai.lovable.app` **canonical / OG / production-link** surfaces to `https://restpilotai.com` (`index`, `pricing`, `features`, preview banner, wearable OAuth fallbacks, lab POC links, email preview samples).
- Left legacy localStorage keys (`shiftrest.prefs.*`, `shiftrest.shifts.*`, notification tags) unchanged on purpose.
- `package.json` `"name"` → `restpilot-ai` (was `tanstack_start_ts`).

## Production smoke (`https://restpilotai.com`)

| Route | Status |
| --- | --- |
| `/` | 200 |
| `/auth` | 200 |
| `/plan` | 200 |
| `/pricing` | 200 |
| `/features` | 200 |
| `/legal/privacy` | 200 |
| `/api/public/health` | 200 |

## Code review / fixes

- **MultiDayPlan** — day chips and expanded header showed midnight (`12AM…`) instead of shift start; now formats `shift.start`.
- **plan.tsx** — sunrise/sunset used `today` while browsing other weekdays; now uses `activeDate`. Day-dot indicators and off-day “next shift” voice text are cycle-aware via `shiftsForDate`.
- **SmartAlarmCard / schedule.ts** — no clear breakages found (types, imports, alarm schedule path look sound).

## Build

- `npm run build` — **success** (exit 0).
- **PWA warning still present**: injectManifest glob `**/*.{js,css,html,...}` under `dist/client` matches no files (precache 1 entry / 0.00 KiB). Non-blocking; SW still builds.

## Owner blockers (unchanged)

1. Authenticated E2E regression (sandbox signed out).
2. Live Stripe charge approval.
3. Real-device cross-browser pass.
