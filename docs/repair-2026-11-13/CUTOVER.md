# RestPilot: move off Lovable Cloud (owner steps first)

Status on 2026-11-14: production is unchanged. restpilotai.com is still
served by Lovable from `main`, on the Lovable Cloud database
`czsgjqfcjiuqirvmdlps`. Railway staging runs this branch, and it still
points at the Lovable database. The migration kit has passed a rehearsal on
synthetic data. No real data has been copied.

## What only you can do

Every step works on an iPhone unless it says **Desktop**. Do these in
order. Each one is free unless it says otherwise.

1. **Export the database from Lovable** (about 2 minutes, then wait for an
   email).
   - In the Lovable iPhone app, or at lovable.dev in Safari, open the
     RestPilot project.
   - On iPhone, tap the project name to open the Project menu. On desktop,
     open **More**.
   - Tap **Database → Manage → Settings → Export project data → Export
     data**. In the **Database** card, tap **Export → Start export**.
   - Lovable emails you when the export is ready.
   - The database must be running, not paused. You can export once every
     24 hours, and the file can be up to 5 GB.
   - Lovable's docs do not list a fee or a plan requirement for exporting.
     The project's normal credit use continues.
   - Source: [Lovable: Export your database](https://docs.lovable.dev/features/database-backups#export-your-database).
   - Do **not** remove or pause Lovable Cloud. Removing it deletes the
     users, the backups and the export.
2. **Create two new Supabase projects.**
   - Go to [supabase.com/dashboard/new](https://supabase.com/dashboard/new)
     twice.
   - Name the first `restpilot-rehearsal`. It is a full-data rehearsal for
     staging, and you delete it after go-live.
   - Name the second `restpilot`. It becomes production at go-live.
   - The kit never overwrites a project, so the final export needs a
     project that has not been used yet.
   - For each, pick the region nearest the Railway service.
   - Tap **Generate a password** each time and save both passwords in your
     password manager.
   - The free plan costs $0.
   - The free plan has limits:
     - no automatic daily backups;
     - the project pauses after about a week with very little database
       activity;
     - 2 free projects per account, which is exactly these two.
   - The Pro plan removes the pause and adds daily backups, at a monthly
     cost. See [Supabase pricing](https://supabase.com/pricing). Upgrading
     is your call; the migration works on the free plan.
3. **Give the agent access through Railway, not chat.**
   - In Safari, open [the Railway project](https://railway.com/project/f52e7151-37df-4a2a-9f8b-0a686b031a5c).
   - Open **Settings → Shared Variables**, and pick the **staging**
     environment.
   - Add these variables. The web app does not receive shared variables
     unless something references them.
     - `SUPABASE_ACCESS_TOKEN`: create one at
       [supabase.com/dashboard/account/tokens](https://supabase.com/dashboard/account/tokens).
       The agent uses it to read the project's keys and set its sign-in
       settings. Revoke it after the cutover.
     - `REHEARSAL_DB_URL` and `TARGET_DB_URL`: in each project
       (`restpilot-rehearsal`, then `restpilot`), tap **Connect → Session
       pooler** and copy the URI. Replace `[YOUR-PASSWORD]` with that
       project's password from step 2.
     - `EXPORT_URL`: in Lovable, open **Storage**, open the export file and
       tap **Copy URL**. That signed link lasts about 1 hour, so tell the
       agent "export link set" right away.
       - Alternative with no time limit: download the file. In the new
         Supabase project, open **Storage → New bucket** and create a
         private bucket called `migration`. For the rehearsal, use the
         `restpilot-rehearsal` project; for go-live, use `restpilot`.
       - Upload the file. Tap it, choose **Get URL**, pick a 1-week expiry,
         and paste that link as `EXPORT_URL`.
       - After go-live, delete that file and bucket. It holds every user's
         data and password hash.
4. **Desktop: Google sign-in.** Existing Google users keep their accounts.
   Google's user ID does not change between OAuth clients, so the agent can
   match them.
   - Open [Google Cloud Console → Credentials](https://console.cloud.google.com/apis/credentials).
   - Choose **Create credentials → OAuth client ID → Web application**.
   - Authorized redirect URIs: one per project,
     `https://<rehearsal-ref>.supabase.co/auth/v1/callback` and
     `https://<restpilot-ref>.supabase.co/auth/v1/callback`. A single
     client can hold both.
   - Authorized JavaScript origins: `https://restpilotai.com`,
     `https://www.restpilotai.com` and
     `https://restpilot-web-staging.up.railway.app`.
   - Put the results in Railway Shared Variables as `GOOGLE_CLIENT_ID` and
     `GOOGLE_CLIENT_SECRET`.
   - Lovable's managed Google credentials cannot be moved. Until this step
     is done, Google sign-in fails with "missing OAuth secret". That is
     exactly what staging shows today.
5. **Email sender.** Sign-up confirmations and password resets need this.
   Supabase's built-in mailer only reaches project team members, 2 per hour.
   - Create a [Resend](https://resend.com) account. Its free tier has
     monthly and daily send limits; check them against your volume.
   - Add the domain `restpilotai.com` and add the DNS records Resend shows.
     These are new records for sending mail. They do not move the website.
   - Your DNS is at GoDaddy. Records can be added in the GoDaddy app or in
     Safari.
   - Put `RESEND_API_KEY` and `EMAIL_FROM` (for example
     `RestPilot <hello@restpilotai.com>`) in Railway Shared Variables.
6. **AI and voice provider keys:** `AI_API_KEY`, `AI_BASE_URL`,
   `AI_CHAT_MODEL`, `AI_FAST_MODEL` and the voice keys listed in
   `.env.example`, with values from your own provider accounts. Provider
   usage is billed by those providers. These were Lovable's AI gateway
   before; they do not migrate.
7. **Decide on paid subscriptions before step 9.**
   - On Railway, Stripe is disabled. Existing recurring subscriptions keep
     renewing in Stripe, but renewals no longer update RestPilot.
   - After a subscriber's current period ends, the app would treat them as
     expired even though they paid.
   - Lifetime purchases are unaffected: they never expire and they migrate
     intact.
   - The import report lists how many subscriptions are active.
   - If that number is above zero, choose one before cutover. This is a
     billing/legal decision; the agent makes no payment changes.
     - (a) Approve a read-only Stripe status sync on Railway, using a
       restricted key and webhook secret you create.
     - (b) Manage those subscribers manually.
8. **Approve the go-live window.** Anything written on Lovable after the
   final export, such as sign-ups or new data, is not carried over. Pick a
   quiet hour. The window between export and step 9 is usually under an
   hour.
9. **Desktop recommended: move the domain.** Do this only after every gate
   below has passed.
   - First, screenshot the current GoDaddy records: `@ A 185.158.133.1`
     and any `www` record.
   - GoDaddy cannot point the bare `restpilotai.com` at Railway. Railway
     needs CNAME flattening or ALIAS at the root. Pick one:
     - (a) Move nameservers to Cloudflare (free). Then add `@ CNAME` plus
       the `TXT` record that Railway shows.
     - (b) Serve `www.restpilotai.com` from Railway: add a `www CNAME` plus
       `TXT`. Use GoDaddy forwarding from `restpilotai.com` to
       `https://www.restpilotai.com`.
   - In Railway, open **restpilot-web (production) → Settings → Public
     Networking → + Custom Domain** to get the exact records. Both the
     CNAME and the TXT record are required.
   - Source: [Railway: custom domains](https://docs.railway.com/networking/domains/working-with-domains).

## What the agent does with that access

Nothing below changes production or the Lovable database.

1. **Import**, using the one-off runner: `scripts/migration/runner/`.
   - It runs on Railway because Postgres cannot be reached from the agent's
     sandbox.
   - The runner's variables are Railway references, for example
     `TARGET_DB_URL=${{shared.REHEARSAL_DB_URL}}` and
     `CRON_SECRET=${{restpilot-web.CRON_SECRET}}`. Secret values are never
     read into chat or logs. psql runs with terse errors, so failures do not
     echo row data or secrets.
   - Steps: `preflight`, then `import` (which runs verify), then `verify`.
     The output is counts and checksums only.
   - If `preflight` exits 6, the export's migration history has a gap.
     Nothing has been restored. The agent checks the live schema, then sets
     `PENDING_MIGRATIONS` to the versions to apply.
   - The import restores into the target project:
     - accounts, with their bcrypt password hashes and user IDs;
     - Google identities;
     - the public schema, with all RLS policies, functions, triggers and
       grants;
     - all app rows, including lifetime purchases and subscription history;
     - migration history.
   - The restore is one transaction. It then applies the three repository
     migrations that live never received (`20261113*`), each in its own
     transaction. A re-run resumes any that failed, and verify fails until
     all have been applied.
   - Sessions are not copied. Everyone signs in again once.
   - It refuses the live Lovable database and any target that is not fresh
     or not named exactly. Re-running it never restores twice.
2. **Sign-in settings**, per project:
   `configure-auth.mjs --apply --sync-railway --generate-hook-secret --generate-cron-secret`.
   - It sets Site URL and redirect allow-list entries for restpilotai.com,
     www and staging.
   - It enables Google.
   - It registers the Send Email Hook at `/lovable/email/auth/webhook`, with
     a new secret on both sides.
   - It writes the project's URL, keys and hook secret into the Railway
     service. It creates `CRON_SECRET` there only if the service has none.
   - Values are never printed. Without `--apply` it is a dry run and writes
     nothing.
   - For `restpilot-rehearsal`, the Railway IDs and `SITE_URL` name the
     staging service. For `restpilot`, they name the production service and
     `https://restpilotai.com`.
   - If the Auth update fails after the Railway write, the hook secrets
     differ until the command is re-run. A re-run sets a new secret on both
     sides.
3. **Staging check**: staging points at `restpilot-rehearsal` with real
   data. Run the gates below.
4. **Production service:** create Railway environment `production` with
   service `restpilot-web` from this branch, using the same variables plus
   `PUBLIC_APP_URL=https://restpilotai.com`. Point it at `restpilot`.
5. **At go-live:**
   - final export (your step 1, repeated; the 24-hour limit applies);
   - import into `restpilot`;
   - verify;
   - `rewire.mjs --apply` recreates the scheduled jobs that live has,
     against restpilotai.com.
     - A job that is switched off on live stays off.
     - Jobs live never had, such as the subscription-expiry emailer, need
       `--include-default-jobs` and your go-ahead;
   - gates;
   - your DNS step;
   - delete `restpilot-rehearsal` afterwards.

Do not merge this branch into `main` before the DNS move. Lovable builds
production from `main`.

## Verification gates

All gates must pass on staging, then on production, before DNS moves.

| Gate | How | Pass |
| --- | --- | --- |
| Data matches | `verify.mjs` | Every table matches its row count and sha256 checksum. Every database object the app needs exists (`required-objects.json`). Accounts, bcrypt hash counts and identities per provider are equal. RLS is on for every table that had it, and the policy count is at least the archive's. All planned repository migrations are applied. |
| Existing user signs in | `TEST_EMAIL`/`TEST_PASSWORD` of an existing account (yours) with `verify-deployment.mjs` | Sign-in with the old password works. RLS returns only that user's profile. |
| Google sign-in | `verify-deployment.mjs` | The authorize request redirects to Google, and the return URL is accepted by the allow-list. |
| Right backend | `verify-deployment.mjs` | CSP and the browser bundle point at the new project and no longer at `czsgjqfcjiuqirvmdlps`. |
| Subscriptions read-only and correct | `verify.mjs` entitlement lines and the app's Account screen | The counts by status and price match, including `lifetime`. Checkout stays disabled. The step 7 decision is recorded. |
| AI works | Coach chat as your account on staging | The reply arrives, and the usage limit is enforced. |
| Email | Password reset to your address from staging | The email arrives, and its link returns to staging. |
| Health | `/api/public/health`, `/api/public/version` | HTTP 200, with the expected build ID. |

## Rollback

- **Before DNS:** nothing user-facing has changed. Lovable keeps serving.
  Fix forward or delete the new project.
- **After DNS:** restore the GoDaddy records from your screenshot. Lovable
  is intact and serves again within the DNS TTL.
  - Data written on Railway after the move would not flow back: Lovable
    Cloud has no import path.
  - Decide within the first hours, and keep Lovable Cloud untouched for at
    least 30 days.
  - Keep the export file offline. Daily backups need Supabase Pro;
    otherwise take your own with `pg_dump`.

## Why a new Supabase project rather than Railway Postgres

- The app is built on Supabase.
  - It uses `@supabase/supabase-js` for sign-in: password, Google OAuth,
    email OTP verification and recovery.
  - It reads and writes through PostgREST under 90 RLS policies on 40
    tables keyed to `auth.uid()`.
  - It uses a GoTrue Send Email Hook.
  - In the database it uses `pg_cron`, `pg_net`, `pgmq` and Vault.
  - It has no storage buckets and no edge functions.
- Lovable officially documents restoring its export into Supabase with
  passwords kept.
- Railway Postgres would need self-hosted GoTrue, PostgREST and the same
  extensions. That is a custom platform to build and run. Supabase is the
  proven, least-custom path, and Railway still hosts the web app.
- Sources:
  - [Lovable: what migrates and how](https://docs.lovable.dev/tips-tricks/external-deployment-hosting#host-backend-and-data-on-a-managed-provider-supabase-example)
  - [Supabase: migrating auth users between projects](https://supabase.com/docs/guides/troubleshooting/migrating-auth-users-between-projects)
  - [Supabase: backup and restore](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore)

## Kit reference (`scripts/migration/`)

- `plan.mjs`: reads the export. It never connects to a database.
  - It writes restore lists, SQL and `manifest.json`: row counts, sha256
    checksums, account, entitlement and RLS summaries.
  - It writes a report of what it skips and why: cron jobs as host and path
    only, Vault as names only.
- `import.mjs`: guarded, single-transaction restore into a fresh,
  exactly-named target. Then the repository migrations newer than the
  export's history are applied, resumable, and verify runs.
- `verify.mjs`: read-only comparison against the manifest.
  `--allow-growth` is for after go-live.
- `rewire.mjs`: Vault secrets through `\getenv`, never argv, and pg_cron
  jobs to the new host. It is a dry run unless `--apply`. Only jobs found
  in the export are scheduled, unless you pass `--include-default-jobs`.
  Run it at go-live only, so users don't get duplicate notifications while
  Lovable is still live.
- `configure-auth.mjs` and `auth-config.mjs`: Supabase Management API Auth
  settings, and the Railway variable sync.
- `verify-deployment.mjs`: the gate script above. It needs no secrets.
- `runner/`: the one-off Railway service (Docker, PostgreSQL 17 client
  tools).
- `rehearsal/run.sh`: the dry run on a throwaway local PostgreSQL 16, with
  synthetic data. Evidence: `evidence/migration-rehearsal.txt`. It is not
  migrated data.

Secrets referenced by name only: `SUPABASE_ACCESS_TOKEN`, `REHEARSAL_DB_URL`, `TARGET_DB_URL`,
`EXPORT_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SEND_EMAIL_HOOK_SECRET`,
`CRON_SECRET`, `RESEND_API_KEY`, `RESEND_WEBHOOK_SECRET`, `AI_API_KEY`,
`AI_AUDIO_API_KEY`, `OPENAI_API_KEY`, `OPENAI_REALTIME_API_KEY`,
`ELEVENLABS_API_KEY`, `SIMLI_API_KEY`, `VAPID_PRIVATE_KEY`,
`FITBIT_CLIENT_SECRET`, `OURA_CLIENT_SECRET`, `GOOGLE_CLIENT_SECRET`.
