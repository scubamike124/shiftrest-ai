# Cross-Device Test Summary — RestPilot AI

Generated: 2026-06-27. Status: **partial — desktop + mobile public surface covered; authenticated flows pending sign-in.**

## Emulated viewports verified (public routes only)

| Device | Viewport | `/` | `/auth` | `/paywall` | `/legal/privacy` |
|--------|---------|:-:|:-:|:-:|:-:|
| Mobile (Pixel-class, Lighthouse mobile preset) | 360×640 | ✅ | ✅ | ✅ | ✅ |
| Desktop (Chromium headless) | 1280×1800 | ✅ | ✅ | ✅ | ✅ |

Assertions per viewport: no horizontal scroll, primary CTA tappable (≥ 44 px), forms submit (validation messages render), nav reachable, no JS console errors in `networkidle` window.

## Engines

- Chromium (current): ✅ via Playwright headless + Lighthouse.
- WebKit / Firefox: NOT executed in this turn — Playwright's WebKit/Firefox binaries are not pre-installed in the sandbox runtime. The framework supports them; running locally is the next step before launch announcement.

## Real-device checklist (owner to complete)

Recommended pre-announcement sweep on physical hardware — minimum 5 minutes per device:

- iPhone Safari (iOS 17+): sign-in, open `/paywall`, complete sandbox checkout, install to home screen (PWA), trigger Smart Alarm screen.
- Android Chrome: same flow, plus push-notification permission grant.
- iPad Safari: dashboard split layout, long-clock interactivity.
- Desktop Safari: PWA install banner, embedded Stripe checkout.
- Desktop Firefox: legal pages, account export download.
- Desktop Edge: end-to-end signup → consent → dashboard.

Record any issues in `docs/launch/remaining-issues.md`.

## Status

Headless cross-engine coverage limited to Chromium this turn. Public-surface layouts pass at mobile + desktop. Real-device pass is the user's go/no-go gate before public announcement.
