# RestPilot app migration: GitHub → Railway

The source is `scubamike124/shiftrest-ai`. This branch includes the repair work
from PR #3 and replaces the Lovable build/runtime integrations. Production DNS
has not been changed. The Railway `restpilot-ai` project contains an isolated
`staging` environment and `restpilot-web` service.

## What changed

- Standard Vite/TanStack/Nitro Node build, `npm ci`, `npm run build`, `npm start`.
  `railway.json` specifies the commands and process-liveness health check.
- npm is the sole package manager; the obsolete Bun lock is removed to avoid
  a host selecting a different dependency graph. Local environment files are
  excluded from git. Their existing public Supabase connection values are
  configured in Railway's variable manager, not copied into documentation.
- Direct Supabase OAuth, direct configurable OpenAI-compatible AI requests,
  direct Resend delivery, signed Standard Webhooks, and preserved unsubscribe
  links replace the Lovable SDKs and gateways. Secrets remain server-only.
- Stripe checkout is disabled at the server adapter, its browser SDKs and
  checkout screen are removed, and Stripe origins are removed from CSP.
  Historical billing reconciliation/deletion safeguards remain in source so
  existing paid accounts are not silently orphaned. No new billing is enabled.
- The private voice test can enroll explicit authenticated Supabase user UUIDs
  through `PRIVATE_BETA_USER_IDS`. Only listed users receive metered trial voice
  access without a subscription; wildcard enrollment is refused. Existing
  sandbox trial-usage accounting and AI budget admission still apply. This is
  test enrollment, not native StoreKit or Play Billing entitlement verification.
- The production service worker is finalized after Nitro assembles assets, so
  precaching includes the actual deployed client bundles and static files.
  The Node entry serves `/sw.js` explicitly because Nitro captures its static
  asset manifest before that final step.

## Configuration still required before functional testing

Use Railway service variables, not chat or committed files. `.env.example`
lists the expected names. The staging service currently has only public
Supabase connection settings, host/port, and its public URL. It has no privileged
database key, provider keys, or enrolled tester accounts.

1. Supply the existing project's `SUPABASE_SERVICE_ROLE_KEY` through Railway's
   secure variable editor. Confirm ownership/access to this Supabase project;
   a frontend hosting move does not transfer Lovable-managed database ownership.
   If an independently owned backend is needed, export/import users, schema,
   files, and data and verify them before changing the connection.
2. Apply the three repair migrations from PR #3 to the intended backend after
   backup and verify deployed RLS/functions. Local isolated SQL checks do not
   establish that these changes are already deployed.
3. Configure direct AI endpoints/keys and explicit model IDs, and the voice
   provider(s) actually needed for the test. No provider call has been billed
   or verified by the local tests.
4. Enroll the owner's existing authenticated UUID(s) for the private voice test.
   Trial duration is client-reported; it is not authoritative provider-side
   session-duration enforcement. Do not open this beta to arbitrary accounts.
5. Add the staging origin to Supabase redirect URLs; configure Google/Apple
   OAuth credentials directly in Supabase. Existing Lovable-managed OAuth
   credentials cannot be assumed portable.
6. Configure a verified Resend sender, `RESEND_API_KEY`, `EMAIL_FROM`, and
   `SEND_EMAIL_HOOK_SECRET`. Register the Supabase Send Email Hook at
   `/lovable/email/auth/webhook`. Paths are preserved for compatibility, but
   these handlers do not call Lovable. For suppression, register only Resend
   `email.bounced` and `email.complained` at `/lovable/email/suppression` with
   `RESEND_WEBHOOK_SECRET`. Configure the service-authenticated email queue
   runner; the old host's cron scheduling does not migrate automatically.
7. Set `CRON_SECRET` and point scheduled jobs (alarms, reminders, AI learning,
   subscription lifecycle, wearable sync) at this host with an
   `x-cron-secret` header. The existing `pg_cron` jobs were created outside
   the repository's migrations, so verify and repoint them in the database.
   Without this secret these endpoints always return 401.
8. Review provider disclosures against the chosen live providers. Register
   wearable callback URLs and configure push credentials if those features
   are in the first test.

## Verification and cutover

- 231 automated checks passed before final packaging. Provider calls are mocked.
- TypeScript passed before final packaging. Build/smoke status is recorded in
  the final pull-request description after the commands complete.
- `node --env-file=.env scripts/deploy/smoke-node-build.mjs` starts the real Node
  output and checks homepage, auth, disabled checkout page, manifest, worker,
  and CSP. No actual email, payment, sign-in, or AI request is performed.
- `/api/public/health` reports process liveness only, not database, provider,
  OAuth, migration, or native-app readiness.
- Do not change `restpilotai.com` DNS until authenticated workflows, recovery,
  account deletion/export, AI/voice limits, notifications, and applicable
  wearable flows pass on staging and the signed White Glove app is device-tested.
- Existing recurring Stripe subscriptions, if any, need an explicit retirement
  plan before database migration; disabling checkout does not cancel them.
