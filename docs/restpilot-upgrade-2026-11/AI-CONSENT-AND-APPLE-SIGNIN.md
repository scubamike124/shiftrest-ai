# AI data-sharing consent and Sign in with Apple

_Nov 15 2026. This closes two App Store submission blockers from [APP-STORE-COMPLIANCE.md](APP-STORE-COMPLIANCE.md): **5.1.2(i)** (ask before sharing personal data with third-party AI) and **4.8** (offer Sign in with Apple next to Google). It is an engineering reading of Apple's rules, not legal advice._

| PR | Branch | What | Status |
|---|---|---|---|
| #56 | `main` | AI consent: dialog, server enforcement, revoke in Settings, policy copy, tests | Independent APPROVE, "main checks" green; waiting for the coordinator to merge |
| #58 | `main` | Sign in with Apple on the website; no OAuth button in the app that can't work | Independent APPROVE, "main checks" green; waiting for the coordinator to merge |
| #62 | `codex/restpilot-railway-migration` | Parity port of #56: direct AI providers, gate before admission, its own consent version | Parity |
| #64 | `codex/restpilot-railway-migration` | Parity port of #58, plus the app-shell config that keeps Apple sign-in inside the app | Parity; needs an app rebuild |

The fixes reach users only after the owner presses **Publish** in Lovable. The iPhone app loads restpilotai.com, so it picks up `main` with no rebuild. The one exception is Apple sign-in *inside* the app (#64), which does need a rebuild.

---

## 1. AI consent (Guideline 5.1.2(i))

### What the user sees
- **Before the first AI use**, a one-time dialog appears: "Allow AI features?". It lists each provider, what is sent and why. A signed-in user meets it when opening the coach, sending a message, tapping the mic, playing a briefing, starting live voice, or loading the dashboard's AI cards.
  - **Google Gemini, through the Lovable AI Gateway**: coach messages, plus the schedule, sleep, preference and profile context RestPilot adds to them, AI memories (only if memory is on), and Fitbit/Oura summaries. Used for coach replies, briefings, plans, insights and shift-swap advice.
  - **OpenAI** (directly, and through the gateway): voice recordings, the text read aloud, preferred name and voice settings. Used for speech-to-text, spoken replies and live voice.
  - **ElevenLabs**: the text of companion replies read aloud.
- It links the Privacy Policy (new §6 "AI providers and your permission") and the subprocessor list, and offers **Allow** / **Not now**.
- **Not now**: nothing is sent. Schedule, sleep plan and reminders keep working. AI cards show "AI features are off …". Background requests don't ask again that session; anything the user starts asks again.
- **Withdraw:** Profile → **Privacy & AI data sharing** (`/settings/privacy`) has a switch. Turning it off stops new requests immediately and ends a live voice session on that device.

### How it is enforced
- **Storage (no migration).** The existing per-user `user_prefs.consent_json` stores the grant:
  - `ai_data_sharing` holds the consent version, `2026-11-15`;
  - `ai_data_sharing_at` and `ai_data_sharing_revoked_at` hold the timestamps.
  - Each grant or withdrawal also appends an audit row to `legal_acceptances` (`ai-data-sharing` / `ai-data-sharing-withdrawn`). The write runs under the user's own session (RLS).
  - Bumping `AI_CONSENT_VERSION` (`src/lib/ai/consent.ts`) asks everyone again. Do that whenever a provider or the data sent changes.
- **Server, on every request.** `requireAIConsent` / `assertAIConsent` (`src/lib/ai/consent.server.ts`) run after authentication and before any prompt is built or any provider is called, in:
  - `/api/ai` (all intents; `/api/coach` forwards there), `/api/brief`, `/api/insights`, `/api/swap`, `/api/stt`, `/api/tts`, `/api/tts-elevenlabs`;
  - the staff-only `/api/lab/simli/*`;
  - the OpenAI Realtime `mintRealtimeSession`;
  - the memory extraction after a coach reply, which re-checks.
  - A refusal is **403** `{"code":"ai_consent_required","error":"…"}` with the header `x-restpilot-ai-consent: required`. If consent can't be read, the route **fails closed** with 503.
- **Client.** `aiFetch` / `aiFetchBackground` replace `fetch` at every AI call site, and `ensureAIConsent` guards live voice. Without permission the request never leaves the device. Coach and Companion show "your message wasn't sent", and the ElevenLabs → OpenAI fallback is skipped on a refusal.

### Tests
`tests/ai-consent.test.mjs` runs the **real** route handlers, consent gate, gateway and logging code, with Supabase, auth and rate limits faked and `fetch` replaced by a spy.

- **For each AI route and intent:**
  - no consent (none, `{}`, older acknowledgements, older version) → 403 and **zero provider requests**;
  - consent → 200 and the provider is called;
  - revoked → 403 and zero calls;
  - unreadable → 503 and zero calls.
- **Live voice mint:** the same three states.
- **Client store:** "Not now" sends nothing, "Allow" sends, a revoke stops requests.
- **Static checks:**
  - every client call site uses `aiFetch`;
  - the gate precedes upstream calls;
  - `/api/coach` only forwards to `/api/ai`;
  - a revoke ends live voice;
  - memory extraction re-checks consent.
- **Mutation check:** removing the gate from one route makes its tests fail.
- **Railway (#62):** a refusal also never consumes the user's AI allowance (`consume_ai_request`).

On `main` with #56: `bun run test` passes 94/94, plus `tsc` and `vite build` (output pasted in #56).

---

## 2. Sign in with Apple (Guideline 4.8)

### What I found (read-only; no account was created)
- **Production auth** is Supabase Auth on Lovable Cloud. Google and Apple go through Lovable's managed OAuth broker: `lovable.auth.signInWithOAuth` → `restpilotai.com/~oauth/initiate` → `oauth.lovable.app` → provider. At the top level that is a full-page redirect (`@lovable.dev/cloud-auth-js` 1.1.2).
- **Apple is already enabled in Lovable-managed mode:**
  - the public `GET /auth/v1/settings` reports `external.apple: true`;
  - the broker redirects to `appleid.apple.com/auth/authorize?client_id=dev.lovable.managed-auth…`.
  - Lovable's docs (docs.lovable.dev/features/apple-auth) say managed mode is the default and needs no Apple Developer account. Own credentials are optional.
- **Google cannot work inside the app shell.**
  - Capacitor 6 iOS opens every top-level navigation to a host that isn't the app's server URL (or in `server.allowNavigation`) in Safari, and cancels it in the web view (`WebViewDelegationHandler.swift`). The shell has no `allowNavigation`, and production serves no `apple-app-site-association`, so a session started in Safari never returns to the app.
  - Google also refuses embedded web views (`disallowed_useragent`).
  - The same Safari hand-off would break Apple in today's shell.

### What #58 does on `main`

| | Google | Apple |
|---|---|---|
| **Website** | shown, unchanged | shown once `/auth/v1/settings` reports Apple enabled; hidden while unknown or on any error |
| **App, every build so far** | hidden | hidden |
| **App build with the `RestPilotWebOAuth/1` UA token (#64)** | hidden | shown |

So every app build offers either no third-party login, where 4.8 doesn't apply, or Sign in with Apple. A reviewer never meets a broken button.

- **Button.** "Continue with Apple" follows Apple's guidelines: white style on the dark page, Apple logo, the same height and corner radius as Google, and listed first.
- **Fallback.** In the app, sign-in is email and password, plus a hint: "Signed up with Google or Apple? … Forgot Password". The hint also covers Hide My Email relay addresses.
- **Kill switch.** `APPLE_SIGNIN_ENABLED` in `src/lib/auth/oauth-providers.ts`.
- **Tests.** `tests/apple-signin.test.mjs` covers the provider matrix, the strict settings parsing, the fail-closed probe and the page wiring.

### What #64 adds on the Railway branch
- **The same `/auth` rules.** That branch uses Supabase's own OAuth, so Apple appears only after Apple is enabled in **its** Supabase project.
- **`ios-app/capacitor.config.json`:**
  - `server.allowNavigation`: `oauth.lovable.app`, `*.supabase.co`, `appleid.apple.com`, `idmsa.apple.com`. This keeps the Apple flow inside the web view. No Google host is added.
  - `appendUserAgent`: `RestPilotWebOAuth/1 RestPilotApp/1.0.0`. `RestPilotApp/<version>` stays last for the native E2E check.

---

## 3. Owner steps

### A. Publish and check (iPhone is fine)
1. After the coordinator merges #56 and #58: open lovable.dev in Safari → the RestPilot project → **Publish**.
2. **AI consent check.** Use your own account, not the shared test account, at restpilotai.com in Safari.
   1. Open the **Coach** and send a message. The "Allow AI features?" dialog should appear.
   2. Tap **Not now**. The message is not sent.
   3. Send again and tap **Allow**. You get a normal reply.
   4. Go to Profile → **Privacy & AI data sharing** and switch it off. Send again: the dialog asks, and nothing is sent until you allow.
3. **Apple check.** Sign out. On restpilotai.com/auth tap **Continue with Apple**, finish on Apple's page, and confirm you land signed in. Try once with **Hide My Email**. In Lovable → Cloud → Users, confirm the new user appears.
   - If the button is missing, Apple is off in Lovable → Cloud → Users → Auth settings → **Apple**. Turn it on there.
4. Open the iPhone app (TestFlight). The sign-in screen should show email and password only. The consent dialog should behave as in step 2.

### B. Optional before App Review: your own Apple credentials
In Lovable-managed mode, Apple's sheet shows Lovable's managed client, not "RestPilot", and replies to Hide My Email addresses depend on Lovable's relay setup. Switching to your own credentials fixes both. **Do it before real users sign up with Apple:** Apple identifies users per developer team, so accounts made under one mode may not be recognized after a switch.

**Doable on an iPhone but fiddly; a computer is easier.** You need the paid Apple Developer Program, which you have for the app.
1. **App ID.** At developer.apple.com → Certificates, Identifiers & Profiles → Identifiers → App ID `com.restpilotai.app` → enable **Sign in with Apple**.
2. **Services ID.** Identifiers → **+** → Services ID (for example `com.restpilotai.web`) → enable Sign in with Apple → Configure:
   - Domain: `restpilotai.com`;
   - Return URLs: paste the Redirect URL(s) Lovable shows on its Apple settings screen.
3. **Key.** Keys → **+** → enable Sign in with Apple → download the `.p8` file. It can be downloaded only once. Note the **Key ID** and your **Team ID**.
4. **Lovable.** Cloud → Users → Auth settings → Apple → **Your own credentials**:
   - Client ID = the Services ID;
   - use **Generate secret** with the `.p8`, Key ID and Team ID;
   - save.
5. **Reminder.** Apple client secrets expire after **6 months**. Set a calendar reminder to generate a new one, or Apple sign-in stops working.

### C. Apple inside the iPhone app (needs a Mac with Xcode)
1. After #64 merges: `cd ios-app && npm ci && npx cap sync ios`, then build and upload to TestFlight as usual.
2. On a real iPhone: Sign in → **Continue with Apple** → finish → confirm you are signed in **inside the app**. If any step jumps to Safari, note the host in Safari's address bar and add it to `server.allowNavigation`.
3. If it can't be made reliable, skip it. The shipped app is compliant without it: it shows no third-party login, so 4.8 doesn't apply.

### D. App Review notes (add to the submission)
- "Before any AI feature is used, the app asks for permission to share data with Google Gemini (via the Lovable AI Gateway), OpenAI and ElevenLabs. It can be withdrawn under Profile → Privacy & AI data sharing."
- "Sign-in in the app is email and password" (or "email and password, or Sign in with Apple", if C was done).
- Demo account details, as listed in APP-STORE-COMPLIANCE.md.

### E. Railway cutover (later)
- **Enable Apple in the Railway Supabase project** (computer): Auth → Providers → Apple, with the Services ID, Team ID, Key ID and `.p8` secret. Return URL: `https://<project>.supabase.co/auth/v1/callback`.
- **Keep the AI providers matching the copy.** On that hosting, text AI goes to `AI_BASE_URL`, or to OpenAI when `AI_BASE_URL` is unset. #62's copy therefore names "Google Gemini (Google's Gemini API), or OpenAI" for text, and "OpenAI" for voice. Its consent version, `2026-11-15-railway`, differs from main's, so users are asked again after the cutover, which is correct because the recipients change. If you set `AI_BASE_URL` to Gemini for good, you can narrow the copy to Google. Whenever the copy changes, also update `/legal/privacy` and `/legal/third-parties`, and bump the version.

---

## 4. Residual risks
1. **Not device-tested.** I could not sign in from this environment: no production sign-in, and no Railway staging sign-in.
   - Apple end-to-end on the website is verified only up to Apple's authorize page.
   - Apple inside the app (#64) is untested on a device.
   - Owner checks A.3 and C.2 close this.
2. **Existing users** see the consent dialog at their next AI use. Until they tap Allow, AI cards read "AI features are off". Expect a short dip in AI usage after Publish.
3. **Live voice** already running on *another* device continues until it ends after a withdrawal. The browser talks to OpenAI directly with a short-lived key. The policy says so.
4. **Self-written consent.** RLS lets users write their own `user_prefs`, so a user could set `consent_json` without the dialog. That is still the user's own consent, and the audit row is best effort. A dedicated RPC would make the audit trail strict.
5. **Unknown status.** If the client can't load consent, the request goes to RestPilot's own server, which refuses without permission. No data reaches a provider either way.
6. **Bridge exposure (#64).** Capacitor injects its JS bridge into pages loaded in the web view. With `allowNavigation`, Apple's, Lovable's broker and Supabase pages could reach the app's plugins (including read-only Health) while they are on screen during sign-in. These are trusted auth vendors and the window is short. The long-term alternative is a native `ASAuthorizationController` / `ASWebAuthenticationSession` plugin with a custom-scheme redirect (Lovable docs: add `myapp://callback` to Redirect URLs).
7. **Managed-mode branding and relay mail**: see 3.B.
8. **Google users in the app** must use Forgot Password once to set a password. The in-app hint says so.
9. **One-render flash.** On a cold load of `/auth` inside the app, the server-rendered Google button shows for one render before hydration hides it. This is the same pattern as the existing purchase gates.
10. **Apple Health.** On the Railway branch, Health data is kept out of AI prompts (`device-insights.ts`, `tests/apple-health.test.mjs`), and the consent copy says "Never Apple Health data". If that ever changes, it needs its own explicit permission (5.1.2(vi), 5.1.3).
11. **Small copy follow-ups for `main`, not blocking:**
    - when no preferred name is set, live voice falls back to the first word of the display name. #62 says "preferred or display name"; #56 says "preferred name";
    - the editor-preview banner on `/auth` still ends "Google works normally on the published site".
12. **Simli** (avatar lab) is staff-only and consent-gated, but not named in the consent screen or the subprocessor list. Add it, and bump the version, before the avatar reaches users.
13. **Write race.** Two consent writers (`ai/consent.functions.ts`, `legal/consent.functions.ts`) read, merge and write `consent_json`. If both run at the same instant, one write could overwrite the other. A JSONB merge in SQL would close this; it is unlikely in practice.
