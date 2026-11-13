# RestPilot continuation — November 13, 2026

## Changes prepared for the existing repair PR

- Ported bounded AI request parsing and output limits to the newer source. Paid AI routes share an atomic request allowance and fail closed on usage-check errors. Existing per-route rate limits and tester/admin lab checks remain.
- OpenAI Realtime validates entitlement against the deployment's payment environment, not a browser-selected environment. Missing, expired or failed subscription reads cannot become unlimited voice access. Existing paid-through cancellation grace remains. Lifetime/active subscriptions are considered across the user's rows, so a newer incomplete checkout does not hide paid entitlement.
- Trial heartbeats use a service-only atomic increment rather than read/overwrite; persistence failures are reported. The existing browser reports elapsed time: this is NOT authoritative provider duration enforcement, and must not be represented as a guaranteed spend cap. Configure provider budgets and verify disconnect/usage behavior before releasing paid voice broadly.
- Subscription webhooks read current Stripe state after reading a database revision. A transactional compare-and-save rejects stale revisions; the handler fetches Stripe again on conflict, retrying at most four times before returning 500. Cancellation can be recorded before creation. A canceled subscription ID cannot be resurrected; ownership/environment mismatches are rejected. Confirmation mail is suppressed for a canonical canceled state.
- Pricing links retain the chosen monthly/annual/lifetime plan, invalid stored choices are ignored, and copy reflects usage limits. The newer 14-day trial is preserved. Account deletion uses an accessible in-page confirmation and retains retry state on server failure, replacing browser dialogs that can fail in a WebView.
- Companion color references use the existing color format correctly. Geolocation is permitted for the same origin so explicit location buttons can request browser permission. Camera/USB restrictions remain.

## Validation

- 216 handler/unit regression tests pass. Provider IO is mocked; no emails, payments or AI calls are sent by these tests.
- TypeScript and the production client/server/PWA build pass. Existing deprecation/chunk warnings remain.
- Actual SQL migrations execute in an isolated PGlite PostgreSQL engine. Checks cover stale snapshot rejection, cancellation tombstones, ownership/environment isolation, deletion-before-creation, 40 overlapping usage increments, the 3,600-second accounting cap, a 31-request admission burst, and anonymous/authenticated privilege denial.
- This SQL test does not substitute for production schema drift checks, Supabase API integration or concurrent connections against hosted PostgreSQL.
- Browser/device visual QA remains unverified in this environment. No White Glove package, signed iOS build or TestFlight installation is claimed.

## Required deployment order

1. Verify the exact existing Lovable project, its current deployment and rollback procedure. The source corresponds to the newer site but is not a hosting attestation.
2. On an isolated Supabase test branch, apply the three new migrations in order: `20261113090000_ai_request_admission.sql`, `20261113100000_trial_voice_atomic.sql`, `20261113110000_subscription_sync.sql`. Validate against the actual schema and test two isolated user accounts.
3. Configure server `PAYMENTS_ENVIRONMENT` consistently with the build's publishable Stripe token. Verify test/live secrets, webhook routes and existing provider limits. Keep secrets out of GitHub.
4. Deploy this branch to the verified preview target. Exercise sign-in/recovery, selected-plan checkout and Stripe sandbox create/update/cancel/replay flows. Verify real provider failures and retry paths.
5. After review, apply the same migrations before deploying the app to production. Missing migrations intentionally block the affected paid routes with errors. Do not deploy app code first.
6. Verify the production build identifier and user journeys, then run Amber's existing White Glove conversion, including microphone, external-auth return, download/share, offline, notifications and device checks. Do not create a second wrapper system.

Rollback: retain the additive tables/functions while restoring the previously verified app artifact; preserve subscription/usage data and webhook retry events. The old app's payment-ordering weakness returns on rollback, so keep monitoring/reconciliation active. Do not drop data to roll back UI code.

## Remaining blockers and limits

Lovable, Supabase and Stripe integrations are not connected in this session; prior connection suggestions were dismissed. Production deployment, actual RLS/auth validation, real Stripe sandbox lifecycle tests, scientific/product-claim review, complete mobile visual/performance QA and native White Glove build/device tests are still outstanding. This is a repair continuation, not a full readiness certification.

Reproduce SQL checks with an isolated installed `@electric-sql/pglite` module:

```sh
RESTPILOT_PGLITE_MODULE=/path/to/pglite/dist/index.js node scripts/qa/verify-repair-migrations.mjs
```
