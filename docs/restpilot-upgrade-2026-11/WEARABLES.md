# RestPilot wearables: research, ranking and status

**Dated 14 Nov 2026.** Sources are the providers' official pages, read on 14 Nov 2026 (most show no "last updated" date; where none is shown, that is said). This is research, not legal advice. Nothing here was signed up for, applied for or paid for.

## Status at a glance

| Provider | Status | What that means |
|---|---|---|
| **Apple Health (HealthKit, iPhone + Apple Watch)** | **Implemented; simulator-tested** (see `NATIVE-APP.md` and the HealthKit PR) | Read-only, on the phone, behind Connect. Not tested on a physical iPhone. Needs the owner's approval of the purpose string before TestFlight. |
| **Oura (API V2)** | Implemented earlier (server OAuth, `src/lib/wearables/oura.server.ts`), **untested**, hidden in the UI | Uses the current V2 API. Never tested end to end. Owner must register the app and ask Oura to lift the 10-user limit. |
| **Fitbit (legacy Web API)** | **Broken: provider switched it off on 2 Nov 2026** | `src/lib/wearables/fitbit.server.ts` calls `api.fitbit.com`, which now returns HTTP 410. The UI already hides it. Its replacement is the Google Health API (below). |
| **Google Health API (Fitbit, Pixel Watch)** | Research only; **owner-blocked** (restricted-scope security review) | |
| **WHOOP (API v2)** | Research only; owner-blocked (developer app, approval past 10 members) | |
| **Garmin (Connect Developer Program, Health API)** | Research only; owner-blocked (business application) | |
| **Health Connect (Android)** | Research only; needs an Android app (none exists) | |

## Ranking (cost and feasibility for this app)

1. **Apple Health.** Free with the Apple Developer membership the owner already has. On the phone, so there are no API keys, servers, rate limits or partner approvals. It also gives indirect reach: people can let other apps (for example their ring or band's app) write sleep into Apple Health, and RestPilot reads what the person allows. (Which vendor apps write which types was **not verified** here.)
2. **Oura.** Free API, OAuth2, code already written for V2. One owner step (approval past 10 users).
3. **WHOOP.** Free API (no cost stated), OAuth2, clear tiered approval. New code needed (about the size of the Oura module).
4. **Health Connect.** Free, on the device, the Android counterpart of HealthKit. Needs an Android build of the shell and a Play Console health declaration. Do it when the Android app is built.
5. **Google Health API.** Covers Fitbit and Pixel Watch, but every scope is "Restricted" and needs a privacy and security review. Tokens from the old Fitbit API do not carry over, so everyone re-consents. Highest effort.
6. **Garmin.** Business application; the Starter tier is push-only (Garmin posts data to your server) with no history; Enterprise terms are negotiated. Highest commercial uncertainty.

## Provider details

### 1. Apple HealthKit (iPhone, Apple Watch)
- **Docs:** [HealthKit](https://developer.apple.com/documentation/healthkit), [Setting up HealthKit](https://developer.apple.com/documentation/healthkit/setting-up-healthkit), [App Review Guidelines 5.1.3](https://developer.apple.com/app-store/review/guidelines/#health-and-health-research). No page date shown.
- **Access:** Apple Developer Program membership (owner has it). The **HealthKit capability** on the App ID (`com.apple.developer.healthkit` entitlement) and a **`NSHealthShareUsageDescription`** purpose string for reading. No partner approval and no separate security review; App Review checks the use.
- **Rules that apply (5.1.3, quoted):** "Apps may not use or disclose to third parties data gathered in the health, fitness, and medical research context—including from … HealthKit API … for advertising, marketing, or other use-based data mining purposes other than improving health management, or for the purpose of health research, and then only with permission." "You must disclose the specific health data that you are collecting from the device." "(ii) … may not store personal health information in iCloud."
- **Cost:** none beyond the membership. **Rate limits:** none (on-device queries).
- **Scopes RestPilot reads:** sleep analysis (in bed, asleep, core, deep, REM, awake), heart rate variability (SDNN), resting heart rate. **Not** steps: no recommendation uses them, so they are not requested (5.1.1 data minimisation).
- **Capacitor feasibility:** good, through a native plugin; the page calls it through the Capacitor bridge. iOS never tells an app whether read access was refused (privacy), so the UI must handle "connected, but no data".
- **Plugin choice:** no maintained plugin for Capacitor 6 reads sleep stages and HRV correctly:

  | Package (licence) | Capacitor | Sleep | HRV | Notes |
  |---|---|---|---|---|
  | `@perfood/capacitor-healthkit` 1.3.2 (MIT), ~7.9k downloads/week, last release Feb 2025 | declares `^4.0.0` | yes, but maps "awake" to "Asleep" (inflates sleep) | no | peer range fails `npm ci` without overrides |
  | `capacitor-health` 0.0.14 (MIT), last Capacitor 6 release May 2025 | `^6.0.0` | **no** | no | |
  | `@flomentumsolutions/capacitor-health-extended` 0.0.18 (MIT) | `^6.0.0` | **no** | yes | |
  | `capacitor-health` 7.x, `@capgo/capacitor-health` 7.x (MPL-2.0) | ≥7 | **no** | no | |
  | `@capacitor/health-fitness` 1.0.2 (MIT, Ionic team, Oct 2026) | ≥8 | yes | yes | official; the migration path once the shell moves to Capacitor 8 |

  So RestPilot uses a **small read-only local plugin** (`ios-app/plugins/restpilot-health`) that calls Apple's HealthKit API directly. It follows Capacitor's documented plugin structure, so `cap sync` installs it like any other plugin, and it can be swapped for `@capacitor/health-fitness` when the shell (and White Glove's generator) moves to Capacitor 8.
- **Owner-only steps:** (1) approve or rewrite the `NSHealthShareUsageDescription` draft; (2) enable HealthKit on the App ID `com.restpilotai.app` (or let automatic signing do it); (3) add an Apple Health section to the privacy policy (draft in `WHITE-GLOVE-READINESS.md`); (4) in App Store Connect, declare Health data in the privacy label.

### 2. Google Health API (Fitbit, Pixel Watch) and the end of the Fitbit Web API
- **Docs:** [About the Google Health API](https://developers.google.com/health/about). No page date shown.
- **Legacy Fitbit Web API (quoted from Google):** support ended **30 Sep 2026**; on **2 Nov 2026** "the Fitbit Web API and Fitbit OAuth endpoints will be turned off and will no longer function or sync data". Requests return HTTP 410 Gone. **RestPilot's Fitbit module is therefore dead** and should be removed or rewritten.
- **Access:** Google OAuth 2.0. "All Google Health API scopes are categorized as Restricted, necessitating a privacy and security review for access." Old Fitbit tokens cannot be reused; every user must re-consent.
- **Data:** "All Fitbit devices and Google Pixel watches, current and previous" through consolidated data-type bundles; intraday data and webhooks.
- **Cost and rate limits:** not stated on the page. Google's restricted-scope reviews have in the past involved an independent security assessment, which can cost money; **confirm with Google before applying** (owner decision, possibly a paid service, which is excluded for now).
- **Capacitor feasibility:** server-side OAuth like Oura; works from the app (the consent page opens in Safari and returns to restpilotai.com).
- **Owner-only steps:** create a Google Cloud project, configure the OAuth consent screen, request the Health API restricted scopes and complete the review.

### 3. Health Connect (Android)
- **Docs:** [Health Connect data types and permissions](https://developer.android.com/health-and-fitness/guides/health-connect/plan/data-types); [Play Console health apps declaration](https://developer.android.com/health-and-fitness/guides/health-connect/publish/declare-access). No page date shown.
- **Access:** on-device Android API; permissions declared in the manifest (`android.permission.health.READ_SLEEP`, `READ_HEART_RATE_VARIABILITY` (RMSSD), `READ_RESTING_HEART_RATE`); reading older than 30 days needs `READ_HEALTH_DATA_HISTORY`, background reads need `READ_HEALTH_DATA_IN_BACKGROUND`. Publishing needs the Play Console health declaration, "Otherwise, users might be prompted with an error message".
- **Cost:** none (Google Play account, which the owner has). **Rate limits:** on-device API.
- **Capacitor feasibility:** good, in an Android build of the shell (not built yet; White Glove lists Android as future work).
- **Owner-only steps:** approve building the Android app; complete the Play Console health declaration.

### 4. Oura
- **Docs:** [API V2](https://cloud.ouraring.com/v2/docs) (rendered client-side; facts below from Oura's own pages and search snippets of them), [Getting started (V1 page, still current for registration)](https://cloud.ouraring.com/docs/), [API agreement](https://cloud.ouraring.com/legal/api-agreement).
- **Access:** register an OAuth2 application in the Oura cloud portal (Personal Access Tokens are marked deprecated). "By default, API Applications have a ten user limit"; approval is requested from the application's page.
- **Rate limits:** 5,000 requests per 5 minutes, enforced per access token and per application; HTTP 429 with `Retry-After`. Oura recommends webhooks over polling.
- **Cost:** none stated.
- **Data:** daily sleep, sleep periods (stages), HRV, heart rate, readiness, through V2 endpoints and scopes; RestPilot's module requests the sleep and heart-rate scopes it needs.
- **Capacitor feasibility:** server-side OAuth (existing code); the consent page opens in Safari and the connection is stored on the account, so the app sees it at the next refresh.
- **Owner-only steps:** register the app with redirect `https://restpilotai.com/api/public/wearables/oura/callback`, set `OURA_CLIENT_ID`/`OURA_CLIENT_SECRET` on Railway, test with your own ring, then request approval past 10 users.

### 5. WHOOP
- **Docs:** [Getting started](https://developer.whoop.com/docs/developing/getting-started), [App approval](https://developer.whoop.com/docs/developing/app-approval), [Rate limiting](https://developer.whoop.com/docs/developing/rate-limiting). No page date shown.
- **Access:** create a Team and an App in the WHOOP Developer Dashboard with a WHOOP account. "Every new app starts on the **Sandbox** tier, which allows up to 10 WHOOP members to connect." Higher tiers need a privacy policy URL, testing with a member, brand-guideline compliance, and a manual review; from Build onward you need connected members equal to 50% of the current tier's limit.
- **Rate limits:** "100 requests per minute", "10,000 requests per day" (increase on request).
- **Cost:** none stated. **API:** v2 (v1 webhooks removed). Scopes are chosen per app ("limit the scopes … to only the ones your application will use").
- **Capacitor feasibility:** server-side OAuth, same as Oura. New module needed.
- **Owner-only steps:** create the Team and App, add the privacy policy URL, test with a WHOOP member, then request tiers.

### 6. Garmin
- **Docs:** [Garmin Connect Developer Program overview](https://developer.garmin.com/gc-developer-program/overview/). No page date shown.
- **Access:** "Apply for the Garmin Connect Developer Program and create an app with Starter Access"; Enterprise is requested later and "commercial terms are tailored based on business and technical requirements". Personal access (own account only) is "Pull only".
- **Delivery:** Starter is "Push only" (Garmin calls your server), with no historical data and "Limited" user capacity; Enterprise adds Ping/Pull and history.
- **Rate limits and cost:** not stated.
- **Capacitor feasibility:** server-side only (push endpoint on Railway plus OAuth). Highest effort.
- **Owner-only steps:** apply as a business; accept the program terms; host the push endpoint.

## Privacy model RestPilot uses for wearable data

- Read-only. Asked for only when the person taps **Connect**.
- **Apple Health data stays on the iPhone:** it is not sent to RestPilot's servers or to the AI coach (the AI sees the schedule-only context it saw before). It improves the on-phone plan, recovery score and recommendations, which are labelled "from Apple Health".
- **Disconnect** stops reading and deletes the stored copy on the phone. iOS does not let an app revoke its own Health permission, so the screen tells the person where to remove it (Settings → Health → Data Access & Devices → RestPilot).
- Server-side providers (Oura): Disconnect deletes the stored tokens. **Gap found:** today it keeps the already-synced nightly readings (`wearable_readings`); deleting them on Disconnect is a follow-up for whoever re-enables those providers.
