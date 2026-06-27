# Beta Test Matrix

## Devices & browsers

| Platform | Browser | Required |
|----------|---------|----------|
| iPhone (iOS 17/18) | Safari | Yes |
| iPhone | Chrome (WKWebView) | Nice-to-have |
| Android (recent) | Chrome | Yes |
| Android | Firefox | Nice-to-have |
| Windows 11 | Edge | Yes |
| Windows 11 | Chrome | Yes |
| Windows 11 | Firefox | Yes |
| macOS | Safari | Yes |
| macOS | Chrome | Yes |
| macOS | Firefox | Nice-to-have |

## Core journeys (run on every required platform)

1. **Signup** — email + Google. Confirm consent checkbox blocks submit until ticked.
2. **Email verification** — open link in same browser; lands on `/dashboard`.
3. **Onboarding** — 4 slides, required consent checkboxes on final slide.
4. **Dashboard arrival** — personalized greeting, circadian dial renders, no horizontal overflow at 375px.
5. **Connect wearable** — Fitbit OAuth round-trip; confirm `?connected=fitbit` redirect.
6. **Smart Alarm + Long Clock** — interact, expand, no crash.
7. **AI Companion (Right Now)** — open, get a tip, react with feedback chip.
8. **Subscribe** — paywall → Stripe Checkout → return → confirm row in `subscriptions`.
9. **Customer portal** — cancel sub, verify `cancel_at_period_end` updates.
10. **Push notifications** — enable, receive a test reminder.
11. **Offline mode** — toggle airplane, confirm `OfflineBanner` + snapshot data.
12. **PWA install** — Add to Home Screen (iOS), Install App (Android), confirm offline launch.
13. **Profile → Export** — download JSON, sanity-check contents.
14. **Profile → Erase AI memory** — confirm prompt, verify memory page is empty.
15. **Profile → Delete account** — confirm prompt with retention disclosure, sign out automatic.

## Regression set

- Cookie banner appears once per device, persists choice.
- Legal acceptance rows appear for signup + onboarding sources.
- Safety notes link to `/safety#…` and scroll to correct section.
- Renewal disclosure visible on paywall + pricing.
- Wearable cron rows appear in `wearable_readings` next morning.
- Nightly `ai-learn` cron produces new `ai_patterns` / `ai_memory` rows.

## Sign-off

Each tester signs off in a shared sheet: platform, browser, journey numbers passed, any defects.
