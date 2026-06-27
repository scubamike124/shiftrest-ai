# Playwright E2E Regression — RestPilot AI

Generated: 2026-06-27. Status: **PARTIAL — blocked on signed-in session.**

## Environment

- Sandbox dev server: `http://localhost:8080` (running).
- `LOVABLE_BROWSER_AUTH_STATUS = signed_out`. The managed Supabase session is **not** injected, so authenticated flows cannot be driven from the sandbox.

## What ran

| Flow | Result | Notes |
|------|:------:|------|
| Marketing surfaces (`/`, `/features`, `/pricing`) load | ✅ | Verified via axe scan navigation + Lighthouse fetch |
| `/auth` renders, signup form labels associated, legal-acceptance checkbox keyboard-reachable | ✅ | axe scan |
| `/paywall` opens, Stripe embedded iframe mounts | ✅ | Verified during Lighthouse run (no JS console errors) |
| Public legal routes render (`/legal/`, `/legal/privacy`, `/safety`) | ✅ | axe scan |
| 404 fallback shows boundary | ✅ | unmatched route at preview returns root not-found UI |

## What did NOT run (blocked)

The following flows require a real Supabase session in the sandbox and were not exercised this turn:

- Account: signup → consent → email verify → login → logout → password reset
- Billing: open paywall as logged-in user, start sandbox checkout end-to-end, upgrade / downgrade / cancel, portal redirect
- Account controls: export data, purge AI memory, delete account
- AI surfaces: Smart Alarm accept/snooze, Right Now feedback chips, Companion Whisper, Long Clock interactions, Tomorrow Preview / Daily Review
- Wearables: Fitbit / Oura OAuth start
- Offline: simulate `context.set_offline(True)` on the dashboard, verify `OfflineBanner` + cached plan, reconnect
- Consent banner persistence across a logged-in session

## How to unblock

In the live preview tab, sign in to RestPilot AI with the test account you want covered. After that, the sandbox env flips `LOVABLE_BROWSER_AUTH_STATUS` to `injected` and the next agent turn can replay every flow above with the session restored. No credentials need to be shared with the agent.

## Status

Public-surface regression: ✅. Authenticated regression: ⏸ pending sign-in.
