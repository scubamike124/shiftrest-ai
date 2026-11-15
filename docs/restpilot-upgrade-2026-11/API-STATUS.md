# RestPilot API and integration status (Railway staging)

Checked 2026-11-15 against staging `restpilot-web-staging.up.railway.app`, at
build `b-1794699763288` (commit `1b54b28`, which includes PR #18's AI layer).

Staging environment:

- It still uses the **live Lovable Cloud database** (`czsgjqfcjiuqirvmdlps`),
  and holds only its public keys.
- No test account exists, and no production data was read or written.
  Authenticated paths were therefore exercised only up to their auth gate.
  Their provider calls were checked directly against the provider, read-only.
- Secrets are named, never shown.

Status meanings:

- **working**: exercised on staging, or against the provider exactly as the
  code calls it.
- **broken**: has a repro.
- **blocked**: a key is missing on Railway, or there is no non-production
  database.

## Railway staging variables

These are **missing** on staging, and production code reads them. The
Lovable column says whether Lovable production has an equivalent. This is
inferred from `main`'s code, since Lovable's secret store cannot be read.

| Variable | Used by | Lovable production |
| --- | --- | --- |
| `SUPABASE_SERVICE_ROLE_KEY` | admin DB access: AI admission, rate limits, cron hooks, email queue, webhooks, account delete/export, wearables callbacks, contact | yes, managed by Lovable; not obtainable (see CUTOVER.md) |
| `AI_API_KEY`, `AI_BASE_URL`, `AI_CHAT_MODEL`, `AI_FAST_MODEL` (optional `AI_ROUTING`, `AI_MODEL_<TASK>`, `AI_REASONING_<TASK>`, `AI_STREAM_USAGE`; tasks are COACH, VOICE, STRUCTURED, BRIEF and BACKGROUND) | all text AI | no: production used `LOVABLE_API_KEY` (Lovable AI gateway) |
| `AI_AUDIO_API_KEY`, `AI_AUDIO_BASE_URL`, `AI_TTS_MODEL`, `AI_STT_MODEL` | `/api/tts`, `/api/stt` | no: Lovable AI gateway |
| `OPENAI_API_KEY` (fallback for both), `OPENAI_REALTIME_API_KEY` (optional `AI_REALTIME_MODEL`, `AI_REALTIME_TRANSCRIBE_MODEL`) | realtime voice, fallback AI | yes |
| `ELEVENLABS_API_KEY` | `/api/tts-elevenlabs`, lab Simli speak | yes |
| `SIMLI_API_KEY` | lab avatar session | yes |
| `PRIVATE_BETA_USER_IDS` or `PAYMENTS_ENVIRONMENT`/`VITE_PAYMENTS_CLIENT_TOKEN` | voice entitlement environment | payments: yes, via the Lovable Stripe connector (website Stripe parked, PR #21) |
| `CRON_SECRET` | all `/api/public/hooks/*`, `/api/public/wearables/cron` | yes |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | Web Push | yes |
| `RESEND_API_KEY`, `EMAIL_FROM`, `SEND_EMAIL_HOOK_SECRET`, `RESEND_WEBHOOK_SECRET`, `EMAIL_PREVIEW_SECRET` | auth and transactional email | no: production used Lovable Emails (`LOVABLE_SEND_URL`) |
| `OWNER_ALERT_EMAIL` | ops alerts, contact form | yes |
| `FITBIT_CLIENT_ID`, `FITBIT_CLIENT_SECRET`, `OURA_CLIENT_ID`, `OURA_CLIENT_SECRET` | wearables | yes |

## Matrix

### Health, auth and platform

| API | Provider | Needs | Staging result | Status |
| --- | --- | --- | --- | --- |
| `GET /api/public/health` | app | none | 200 `{"status":"ok"}` | **working** |
| `GET /api/public/version` | app | none | 200 `buildId b-1794699763288` | **working** |
| `POST /api/public/csp-report` | app | none | 204 for a sample report | **working** |
| Email/password sign-in | Supabase Auth (GoTrue v2.197) | public keys | bogus login gets a clean `invalid_credentials`; CORS allows the staging origin; CSP and bundle point at the project | **working** (API level; no test account) |
| Google and Apple sign-in | Supabase OAuth | provider secrets in the backend | `GET /auth/v1/authorize?provider=google` → 400 `Unsupported provider: missing OAuth secret` (same for apple) | **broken on Railway**: Lovable's managed OAuth broker only serves Lovable hosting. Fixed by owner-owned Google credentials on the new project (CUTOVER step 4) |
| Sign-up confirmation and password reset email | Supabase Auth → Lovable mailer | Lovable-managed | not exercised: it would email a real address | **blocked**: needs the new project's Send Email Hook and Resend |

### AI (PR #18 owns these; verified, not rewritten)

| API | Provider | Needs | Staging result | Status |
| --- | --- | --- | --- | --- |
| `POST /api/ai` (`coach`, `brief`, `commute`, `smart_alarm`, `daily_plan`, `daily_review`, `right_now`, `tomorrow_preview`, `jetlag_plan`, `adjust_plan`, `pattern_alert`, `coach_tip`) | OpenAI-compatible `chat/completions` | AI_* keys and models, service role (admission) | `{}` → 400 `intent required`; `{"intent":"coach"}` → `Backend not configured` | **blocked**: `SUPABASE_SERVICE_ROLE_KEY`, `AI_API_KEY` |
| `POST /api/coach` (legacy alias) | forwards to `/api/ai` | as above | any body → **200 with the HTML app shell** instead of JSON | **broken** (repro below; fixed in this PR) |
| `POST /api/brief`, `/api/insights`, `/api/swap` | chat/completions | AI_* keys and models | 401 `Missing authorization` (auth gate first) | **blocked**: AI keys; no test account |
| `POST /api/tts` | OpenAI-compatible `audio/speech` | `AI_AUDIO_*`, `AI_TTS_MODEL` | 401 at the auth gate | **blocked**: AI audio keys |
| `POST /api/stt` | OpenAI-compatible `audio/transcriptions` | `AI_AUDIO_*`, `AI_STT_MODEL` | 401 at the auth gate | **blocked**: AI audio keys |
| `POST /api/tts-elevenlabs` | ElevenLabs `v1/text-to-speech` | `ELEVENLABS_API_KEY` | 401 at the auth gate | **blocked**: `ELEVENLABS_API_KEY` |
| `mintRealtimeSession` (server fn) | OpenAI `v1/realtime/client_secrets`; browser `v1/realtime/calls` (WebRTC) | `OPENAI_REALTIME_API_KEY`/`OPENAI_API_KEY`, voice entitlement env | needs a session | **blocked**: OpenAI key; entitlement env; `VITE_ENABLE_REALTIME_PILOT=0` on staging |
| `POST /api/lab/simli/session`, `/api/lab/simli/speak` | Simli `compose/token`; ElevenLabs | `SIMLI_API_KEY`, `ELEVENLABS_API_KEY`, lab role | 403 `lab_access_required` | **blocked**: keys; lab-only by design |
| Companion 3D avatar default model | `models.readyplayer.me/<id>.glb` | none | DNS **NXDOMAIN** for `models.readyplayer.me` (Ready Player Me no longer resolves) | **broken in production too**; for the AI-companion agent: self-host the `.glb` or switch models |

### Weather, air quality, routes and search

These are provider calls with the exact URLs the code builds; the server
functions themselves need a session.

| API | Provider | Needs | Result | Status |
| --- | --- | --- | --- | --- |
| Current weather (`fetchCurrentWeather`), forecast (`fetchTomorrowWeather`), morning/evening/afternoon brief weather | Open-Meteo `api.open-meteo.com/v1/forecast` | none | 200 in 0.14–0.17 s, within the code's 3.5 s timeout | **working**, but see the licensing note |
| Air quality (`fetchWeatherIntel` via `getWeatherIntel`) | Open-Meteo `air-quality-api` | none | 200 in 0.54 s | **working**, but see the licensing note |
| Place search (`geocodeWeatherQuery`, `geocodeTrafficQuery`) | Open-Meteo geocoding | none | 200; "Seattle" resolves | **working**, but see the licensing note |
| Drive time (`fetchRouteSnapshot` via `getTrafficIntel`) | OSRM demo `router.project-osrm.org` | none | 200 `code: Ok`, a route returned | **working**, but see the licensing note |
| Reverse geocode (profile, browser) | BigDataCloud `reverse-geocode-client` | none | 200 | **working** (client-side free tier) |

### Data, notifications, email and payments

| API | Provider | Needs | Staging result | Status |
| --- | --- | --- | --- | --- |
| Calendar feeds (`testCalendarFeed`, `getCalendarAgenda` …) | user ICS URLs (Google, Apple, Outlook allow-list) | session | fetcher covered by 34 offline tests (redirect refusal, size cap) | **blocked** live: no test account |
| `POST /api/public/hooks/notify`, `dispatch-alarms`, `ai-learn`, `subscription-lifecycle`, `/api/public/wearables/cron` | app via pg_cron, Web Push | `CRON_SECRET`, `VAPID_*`, service role | 401 `unauthorized` for all five (correct without the secret) | **blocked**: `CRON_SECRET`, `VAPID_*`, service role; cron jobs are rewired at go-live (`rewire.mjs`) |
| Push subscribe/test (`subscribePush`, `sendTestNotification`) | Web Push (VAPID) | `VAPID_*` | needs a session | **blocked**: `VAPID_*` |
| `POST /lovable/email/auth/webhook` (Send Email Hook) | Resend | `RESEND_API_KEY`, `EMAIL_FROM`, `SEND_EMAIL_HOOK_SECRET`, `PUBLIC_APP_URL` | 503 `Email service is not configured` | **blocked**: Resend keys |
| `POST /lovable/email/queue/process`, `/transactional/send`, `/suppression`, `/auth/preview`; `GET /email/unsubscribe` | Resend; Supabase | `RESEND_*`, service role, `EMAIL_PREVIEW_SECRET` | 500 `Server configuration error` | **blocked**: Resend keys and service role |
| `POST /api/public/contact` | Resend (owner alert); DB rate limit | `OWNER_ALERT_EMAIL`, Resend, service role | `{}` → 400 `invalid_input` (validation works) | **blocked**: a valid submission would need the service role and Resend |
| Wearables OAuth (`startWearableOAuth`, `/api/public/wearables/{fitbit,oura}/callback`) | Fitbit, Oura | client IDs/secrets, service role | callbacks reachable | **blocked**: keys. **Defect:** OAuth `state` is not verified; see "Defects" |
| `POST /api/public/payments/webhook` | Stripe | Stripe key and webhook secret | 400 without `?env`; 400 unsigned | **parked** (owner decision 2026-11-15; PR #21 open, inert) |
| Checkout/portal (`createCheckoutSession`, `createPortalSession`) | Stripe | see PR #21 | disabled on this branch | **parked**: production's Lovable checkout is untouched |

## Defects

1. **`/api/coach` returns the HTML app shell on Railway.** *Fixed in this
   PR.*
   - Repro:
     `curl -X POST -H 'Content-Type: application/json' -d '{"messages":[]}' https://restpilot-web-staging.up.railway.app/api/coach`
     returns `200 text/html`. Production returned `401 {"error":"Sign in required"}` when observed on 2026-11-15.
   - Cause: behind Railway's edge, the server sees `http://<host>`. Its
     self-fetch to `http://…/api/ai` gets a `301` to https, and `fetch`
     replays the POST as a GET, which serves the SPA.
   - Fix: forward over loopback (`127.0.0.1:$PORT`), use
     `redirect: "manual"`, and drop stale encoding headers.
     `tests/coach-forward.test.mjs` covers it.
2. **Wearables OAuth `state` is not verified.** *Separate PR.*
   - `/api/public/wearables/{oura,fitbit}/callback` takes the user id from
     `state` (`<userId>:<random>`) without checking it was issued by the
     server.
   - Anyone who completes their own Fitbit/Oura authorization with
     `state=<victim-uuid>:x` makes the server store the attacker's tokens on
     the victim's account. That overwrites the victim's connection and injects
     foreign sleep data.
   - Fitbit's PKCE cookie does not prevent this, because the attacker runs the
     flow in their own browser.
3. **Ready Player Me host is gone.** It is noted above for the AI-companion
   agent; this PR does not change it.

## Account deletion and subscription status on Railway

- **Subscription status:** *fixed in PR (subscription-status-read).*
  - The profile and premium UI used to read the `subscriptions` table only
    when a Stripe publishable key was configured.
  - Railway has none, so paid and lifetime members looked free there, even
    though the server still honoured their access.
  - Status is now read from the database regardless. A build without a key
    uses the `live` rows. A newer incomplete checkout no longer hides an
    older paid or lifetime row.
- **Account deletion fails closed on Railway for any non-canceled Stripe
  subscription row** (active, trialing, past_due, incomplete, unpaid, or
  expired active; one-time lifetime purchases excepted). This is *not
  changed*.
  - `deleteAccountFn` cancels Stripe subscriptions first. With Stripe off,
    the user gets "We couldn't confirm all subscription cancellations…" and
    keeps the account. That is an App Store 5.1.1(v) risk for any app build
    pointed at Railway.
  - Deleting anyway would lose the subscription id (rows cascade with the
    user) and leave the customer billed. So the fix is a billing decision,
    not a code-only one. Options for the owner:
    - (a) **Recommended:** keep the CUTOVER hard gate. Railway does not serve
      customers until website Stripe works there, and then deletion cancels
      as on Lovable.
    - (b) If Railway must serve customers before Stripe:
      - deletion proceeds;
      - the subscription id is written to a cancellation queue table with no
        foreign key to the user;
      - the owner is alerted at once;
      - the queue is processed when the Stripe key exists;
      - the user-facing copy is agreed by the owner.
- **White Glove iOS test (2026-11-16):** not blocked.
  `ios-app/capacitor.config.json` loads `https://restpilotai.com/`, which is
  Lovable, where Stripe and deletion work. The Railway gap only applies
  after cutover, which the Stripe gate covers.

## Licensing and cost notes for the owner

None of these are changed by this work.

- **Open-Meteo:** its terms say the free API is "only" for "non-commercial
  purposes". Apps with subscriptions are listed as commercial. RestPilot
  sells subscriptions, so this needs a paid Open-Meteo plan, or another
  provider. Free-tier limits are 10,000 calls a day, 5,000 an hour and 600
  a minute.
  Source: open-meteo.com/en/terms.
- **OSRM demo server:** the OSRM usage-policy page lists the terms of the
  previous demo server.
  - Those terms forbade selling access, required public access with
    attribution, and said access could be withdrawn "at any time and without
    giving a reason".
  - The page now points to FOSSGIS's terms at
    routing.openstreetmap.de/about.html for the current server.
  - Either way, it is not a dependable production router for a paid
    feature.
  - The policy also asks for an identifying `User-Agent`;
    `src/lib/traffic.server.ts` sends Node's default.
  - Source: github.com/Project-OSRM/osrm-backend/wiki/Api-usage-policy.
- **AI and voice providers** bill per use. See `COST-MODEL.md`.

## How this was checked

- Staging: `curl` of every route listed above (GET, and POST with `{}`).
  `scripts/migration/verify-deployment.mjs` covered auth.
- Providers: the exact URLs from `src/lib/weather.server.ts`,
  `src/lib/traffic.server.ts` and `src/routes/profile.tsx`, for Seattle
  coordinates.
- Unauthenticated status codes of the keyed providers: OpenAI 401, Resend
  401, Fitbit 401, Oura 400. These only show the hosts are reachable; they
  do not test keys.
- Offline: `npm run test:repair` covers handlers with mocked IO.
