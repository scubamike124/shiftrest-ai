# RestPilot iPhone app: architecture and native features

**Dated 14 Nov 2026.** Owner authorization of 14 Nov ("a real iPhone app, not a simulator showing a website"). Everything here was built and tested in the free iOS **simulator** on GitHub's macOS runners. **Nothing has been tested on a physical iPhone, signed, uploaded or submitted.**

## 1. Decision: keep loading restpilotai.com, add native features around it

The app is the White Glove Treatment Capacitor 6 shell in `ios-app/`. It loads `https://restpilotai.com` with Capacitor `server.url`. I evaluated bundling the built web assets into the app instead. **Decision: keep `server.url`.** The native value comes from features the website cannot have, not from where the HTML files live.

| Question | Remote `server.url` (chosen) | Bundled web assets |
|---|---|---|
| Fits TanStack Start? | Yes, unchanged. SSR and server functions run on Railway as today. | Needs SPA mode and a client-only build. The app calls **55 server functions in 20 files**, **22 server API routes** and **20 relative `fetch("/api/…")` calls**. Each would have to be pointed at an absolute API origin, with CORS (or CapacitorHttp) on every route. High regression risk. |
| Updates | A web deploy reaches the app at the next launch. The team ships several changes a day. | Every web change needs a new App Store build and review, or a paid live-update service (excluded: no paid services). The app and the site would drift. |
| Auth | Supabase stores the session in the page's `localStorage` and sends bearer tokens; there are no auth cookies. It persists in the app's WebKit data store. | Same tokens, but every request becomes cross-origin. |
| Offline | Native offline screen (shipped in the app) with the saved plan; see §3. | Full UI offline, but the server functions still fail offline. |
| App Review 4.2 | 4.2 is about what the app does, not where its files live. Native reminders, Apple Health, the offline plan and notification deep links are the native value. | No difference on its own. |

**Not chosen:** a new framework (React Native, Swift UI rewrite). No demonstrated benefit over Capacitor for this scope, and it would leave Amber's White Glove pipeline.

**Re-evaluate if** App Review rejects under 4.2 despite the native features, or if offline use of the full UI becomes a requirement.

## 2. Native features built

| Feature | How | Status |
|---|---|---|
| **Reminders on the phone** | `@capacitor/local-notifications` 6.1.3. The site plans the next 7 days from the same `buildMultiDayPlan()` the dashboard shows: upcoming shift (lead time 15–120 min), bedtime, wind-down, shift-pattern change (the day before a switch between day, evening and night), recovery. Each kind can be switched off; quiet hours move an upcoming-shift or shift-change reminder to their end when that is still before the shift (others are dropped); nothing fires inside a planned sleep window (an upcoming-shift or shift-change reminder that would is moved to wake-up if that is still before the shift, otherwise dropped); daily cap (1–8, the highest-priority kinds win); same-kind reminders within 30 min are merged; stable ids, so re-planning replaces instead of duplicating; at most 48 pending (iOS keeps 64). Re-planned on every schedule or settings change and every return to the app. Known limit: the shift-change heads-up is planned for noon (or wake-up) the day before; a change added to the schedule after that moment gets no heads-up. They fire with no signal and with the app closed. | Simulator-tested end to end (§5) |
| **Permission in context** | The iOS notification alert appears only when the person turns reminders on (Profile → Reminders on this iPhone). If they refused, the card says so and opens the app's page in Settings. | Simulator-tested |
| **Offline screen** | `ios-app/www/offline.html`, shown by Capacitor (`server.errorPath`) when the site cannot load, instead of a blank WebView. It shows the next 7 days of shifts and sleep windows that the site last saved on the phone (Capacitor Preferences, i.e. iOS UserDefaults in the app sandbox). It retries by itself when the connection returns, on return to the app and every 15 s, and has a Try again button. | Simulator-tested end to end (§5) |
| **Notification taps and universal links open the right page** | `@capacitor/app` `appUrlOpen` and the notification tap event route to the in-app page. Only `https://restpilotai.com`, `www.restpilotai.com` and same-site paths are followed (`src/lib/native/links.ts`, unit-tested). | Notification tap: simulator-tested. Universal links: code ready, **owner-blocked** (§4). |
| **Launch screen** | New launch image; `@capacitor/splash-screen` keeps it up until the page is ready (hidden by the site, 3 s cap), on the same `#0b1020` background as the WebView, so there is no white flash. | Built in the simulator lane |
| **Sign-out and account deletion** | Pending reminders and the saved offline plan are removed when the person signs out (this includes Delete account, which signs out), and on any launch with nobody signed in. A sync still running at sign-out undoes itself. | Clear function simulator-tested; the race is unit-tested; the sign-out event wiring itself is **untested** |
| **Apple Health (HealthKit)** | Separate PR; see `WEARABLES.md`. | See that PR |

Web fallback: none of this appears in a browser. Every helper returns null outside the app shell, and older app builds without a plugin keep the previous behaviour.

## 3. Navigation, safe areas, auth

- **Safe areas:** the site uses `viewport-fit=cover`; the header clears the status bar (PR #6), and the offline screen pads for all four safe-area insets. The mobile layout repair (PR #8) owns the rest of the layout.
- **Navigation:** in-app navigation is the site's own bottom tab bar and router. The iOS edge-swipe "back" gesture is **not** enabled: Capacitor 6 has no setting for it, and it needs a custom view controller that the White Glove handoff would not carry (§6). Follow-up, low risk.
- **Session persistence:** Supabase keeps the session in the page's `localStorage` (no cookies), in the app's persistent WebKit store, and refreshes tokens itself. Not verified on a device across days; if the store were cleared, the person signs in again and loses no data (it is on the server).
- **Sign in with Apple (4.8):** not required. Inside the app only email and password are offered: Google sign-in is hidden (PR #6, merged), because Google blocks OAuth in embedded WebViews.
- **External links** open in Safari (Capacitor default for other hosts).

## 4. Owner-only: universal links

The app already handles `appUrlOpen`. To turn universal links on:
1. In the Apple Developer portal, enable **Associated Domains** on the App ID `com.restpilotai.app`.
2. Add the entitlement `com.apple.developer.associated-domains` = `applinks:restpilotai.com` to `ios-app/ios/App/App/App.entitlements`.
3. Serve `https://restpilotai.com/.well-known/apple-app-site-association` (HTTPS, `application/json`, no redirect) with your 10-character Team ID:
   ```json
   { "applinks": { "details": [ { "appIDs": ["TEAMID.com.restpilotai.app"], "components": [ { "/": "/plan*" }, { "/": "/dashboard*" }, { "/": "/coach*" } ] } ] } }
   ```
   Today the path returns 404 (checked by White Glove's dry run). Not built here: it needs your Team ID, and a wrong file is worse than none.

## 5. Test evidence

- **Unit tests** (`tests/native-reminders.test.mjs`, Node test runner): times match the plan, shift-change heads-up, no reminder inside a sleep window (night-to-day switch), per-kind switches, lead time, quiet hours across midnight, daily cap priority, dedupe and stable ids, pending limit, settings validation, offline plan contents (no notes leave the site), link safety.
- **Simulator end to end** (`.github/workflows/ios-native-e2e.yml`, free macOS runner, ad-hoc signed, no Apple account):
  - Phase A: the shell loads a CI-only page that bundles the site's real `src/lib/native` code. An XCUITest taps **Allow** on the real iOS notification alert. The page schedules the planned reminders through the real plugin and checks that exactly that many are pending, re-plans with fewer kinds and checks the old ones are gone, clears on "sign-out" and checks that a notification that is not ours survives. The test then goes to the Home Screen, waits for a **real notification banner**, taps it, and checks that the page received the path `/plan`.
  - Phase B: the same app pointed at a host that cannot resolve must show the offline screen with the saved shift ("E2E Ward"), and stay on it after **Try again**.
  - Screenshots, logs and the app's UserDefaults are kept as the run's `restpilot-ios-native-e2e-evidence` artifact (14 days).
- **Not tested:** any physical iPhone; the real restpilotai.com inside the shell (it still serves the Lovable build, which does not have this code); signed builds; universal links.

## 6. White Glove pipeline: what carries over

Amber's handoff (`amberai src/lib/api-v1/ios-build/handoff.ts`) regenerates the Xcode project from a wrap package: `npm install`, `cap add ios`, `cap sync ios`, then Info.plist additions, bundle id and the package's `ios/AppIcon-1024.png`.
- **Carries over:** the plugins (they are npm dependencies in `capacitor/package.json`; `cap sync` installs their pods), `capacitor.config.json` (including `errorPath` and the splash settings), `www/` (including `offline.html`) from the package's `pwa/` folder, and the icon (`ios-app/resources/AppIcon-1024.png` is opaque 1024 px RGB, the exact format `isOpaque1024Png` accepts).
- **Does not carry over today:** the launch images, any entitlement (HealthKit, Associated Domains) and any purpose string other than microphone, camera, location, speech and photos. `WHITE-GLOVE-READINESS.md` lists the gap and the smallest Amber change that closes it.

## 7. Competitor features: staged after launch

| Feature | Approach | Owner steps | Effort | Risk | Recommendation |
|---|---|---|---|---|---|
| **Photograph a schedule** | Apple Vision `VNRecognizeTextRequest` (on device, free) in a small custom Capacitor plugin, or `VNDocumentCameraViewController` for capture. Parse dates and times on the site; show every parsed shift on a **confirm screen**; nothing is saved until the person confirms. Needs `NSCameraUsageDescription`. | Approve camera purpose string | M (1–2 weeks with parser tests on real rosters) | Medium: rota formats vary widely; wrong shifts are harmful | **First after launch.** Highest value for shift workers. |
| **Lock Screen widget** ("next shift", "sleep window") | WidgetKit extension reading the offline plan from an **App Group** shared store; the site already computes that plan. Needs a small plugin to write to the App Group. | Enable App Groups on the team; widget extension App ID | M–L | Medium: second target, signing, and the White Glove handoff must carry an extension | Second. |
| **Siri / Shortcuts** ("When is my next shift?", "Log a nap") | App Intents in the app target. "Next shift" reads the saved plan (no network). "Log a nap" needs an authenticated API call. | None for "next shift" | S–M | Low for read-only | Third; start with read-only "next shift". |
| **Apple Watch companion** | watchOS app with complications | New targets, App Store assets | L | High | Later. |

Nothing in this table is built yet: every option needs native code in the app target or a new target, which the White Glove handoff does not carry today (§6). "One-tap overtime" is schedule logic owned by the app and correctness agents.
