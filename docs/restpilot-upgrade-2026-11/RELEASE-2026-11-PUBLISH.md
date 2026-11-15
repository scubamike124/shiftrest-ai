# RestPilot production release package: publish checklist and post-publish verification

_Nov 15 2026. Audited commit: `main` at **4b9ebde** (merge of #76). Nothing in this package was published, deployed or written to production. Production was only read with GET requests. The agent that wrote this has no Lovable, Supabase, Stripe or GitHub-admin credentials._

Files in this package:
- this document;
- `scripts/post-publish-verify.mjs`: read-only (GET only) verification of the live site;
- `.github/workflows/post-publish-verify.yml`: lets you run that script from an iPhone (Actions, "Run workflow").

Existing docs this package builds on (not duplicated): `AI-CAP-MIGRATION-VERIFY.md`, `STRIPE-SUBSCRIBER-AUDIT.md`, `VOICE-COST-MODEL.md`, `AI-CONSENT-AND-APPLE-SIGNIN.md`, `APP-STORE-COMPLIANCE.md`. `RELEASE-READINESS.md` is an older report (written at `e8742a9`); where it disagrees with this file, this file wins.

## 0. One-screen summary

| Question | Answer |
|---|---|
| Is `main` fit to publish? | Yes by every automated check I can run (section 1). One human prerequisite: apply two database migrations (section 3). |
| What is live now? | The Aug 17 2026 build (`b-1786931160964`, `x-deployment-id 119d568c0ca7e3cb02accde0644f22f92de79f0b38e4493f767d9f368bb0a5b3`). It is source commit `3bcbf05` (committed 01:45:27 UTC, built 01:46:00 UTC). |
| What does Publish change for users? | Lifetime offer gone for new buyers, AI consent dialog, crisis messages never sent to AI, AI daily budget enforced on every route and failing closed, **live voice switched off**, plus many fixes (section 2). |
| Database | Exactly **2** migrations on `main` are newer than the live build. Both are safety-critical and idempotent (section 3). Whether Lovable applies them for you is **unknown**; assume it does not and apply them yourself. |
| Order | Apply migrations **before or right after** Publish. Either order is safe (section 3.4). Do the cap-trigger migration first if you do both separately. |
| Not in this release | #72 (privacy policy draft for iOS), #63 (Apple In-App Purchase), #57 (website checkout kill switch and past-due billing fix), #21 (Stripe on Railway). All stay unmerged. |
| Biggest honest gaps | Section 1.5: the iOS app shell is not in `main`; #57 is not in `main`, so the website still sells Monthly/Annual and past-due customers still have no "fix card" path; the AI cap is fail-closed (an outage of the database check blocks AI). |

## 1. Main readiness audit

### 1.1 Commands run on a clean worktree of `origin/main` (4b9ebde)

| Step | Command | Result |
|---|---|---|
| Install | `bun install --frozen-lockfile` | exit 0, **1011 packages**, no lockfile change |
| Typecheck | `bun run typecheck` (`tsc --noEmit`) | exit 0 |
| Tests | `env -u REALTIME_VOICE_ENABLED bun run test` (`node --test tests/*.test.mjs`) | **293 tests, 293 pass, 0 fail, 0 skipped**, exit 0. Skipped = 0 means the real-PostgreSQL tests (cap trigger, voice ledger) ran against a throwaway Postgres 16 with every migration applied in filename order. |
| Build | `NODE_OPTIONS=--max-old-space-size=4096 bun run build` | exit 0 (Cloudflare-module preset, the default) |
| Local production-style build | `NITRO_PRESET=node_server ... bun run build`, served on 127.0.0.1 | built; used only to dry-run the verification script (section 5) |
| Main CI | GitHub Actions "main checks" run **43744287429** on `4b9ebde` | **completed, success** (install, typecheck, test, build). Commit status API shows `pending` because only that one workflow reports; there are no other required checks and **no branch protection**, so a red run would not block Lovable or the Publish button. |

### 1.2 Required protections: where they are and what proves them

| Protection | Code on `main` | Test that proves it |
|---|---|---|
| **Cap trigger migration** | `supabase/migrations/20261115060000_lock_ai_daily_token_cap.sql` (BEFORE INSERT/UPDATE trigger `user_prefs_guard_ai_cap`; `authenticated`/`anon` cannot change `ai_daily_token_cap`) | `tests/ai-cap-guard.test.mjs`; `tests/ai-cap-guard-postgres.test.mjs` (real Postgres: raise attempt ignored, insert gets 15000, anon blocked, trigger cannot be disabled by a client role, service_role may still set it) |
| **`has_ai_budget` revoke** | `20261115070000_...sql` line 1-3: `REVOKE EXECUTE ... FROM PUBLIC, anon, authenticated; GRANT ... TO service_role`. Only the backend calls it (`src/lib/ai/log.server.ts`, admin client) | `tests/voice-session-postgres.test.mjs`: "has_ai_budget cannot be called by signed-in or anonymous users, only the backend" |
| **Budget gate on every AI route** | `requireAIBudget` in `/api/ai`, `/api/brief`, `/api/insights`, `/api/swap`, `/api/stt`, `/api/tts`, `/api/tts-elevenlabs`, `/api/lab/simli/*`, live voice mint. RPC error, throw, >4 s hang or non-boolean => retryable 503 and **zero provider calls**; over cap => 429 | `tests/ai-consent.test.mjs`: per-route "budget RPC error -> 503, zero provider calls", gate order (consent, rate limit, budget, provider), and the **scan test** "every route/server function that can call a paid provider awaits requireAIBudget and records usage" (walks `src/routes` and `src/lib`, ignores comments; a new provider call without a gate fails the build) |
| **Crisis no-forward, server guard before 401** | `src/routes/api/ai.ts` `crisisSupportResponse()` runs before sign-in, consent, rate limit, budget; no provider call, no logging of the message; header `x-crisis-support: 1`; earlier crisis turns dropped from history (`withoutCrisisTurns`); client does the same locally (coach, companion, pilot) | `tests/crisis-no-forward.test.mjs`: "signed-out or expired session still gets the crisis reply; normal text there is still 401", mutation tests (guard removed => tests fail, crisis text then does reach the provider), forged assistant turn, history filter, static bounded reply, false positives still go through |
| **256 KB request cap** | `MAX_BODY_BYTES = 256 * 1024` in `/api/ai`: declared length or actual body over cap => 413 **before parsing, crisis scan or auth** | "body-size cap: oversized bodies get 413 before parsing, crisis scan or auth; a 30-turn chat is fine" |
| **Webhook price gate** | `webhook.ts` `handleCheckoutCompleted`: mints a `lifetime` row **only** when the line item's price resolves to `restpilot_lifetime`; any other paid one-time checkout mints nothing and alerts the owner | `tests/lifetime-discontinued.test.mjs`: "webhook only mints a lifetime row for the lifetime price", "a paid one-time checkout for a non-lifetime price raises an owner alert and mints no row" |
| **Lifetime offer removed for new purchases** | `billing.functions.ts`: `CHECKOUT_PRICES = {restpilot_monthly, restpilot_annual}`; `restpilot_lifetime` throws before any Stripe call; any non-recurring Stripe price refused. `paywall.tsx`/`pricing.tsx`: monthly and annual only | "checkout refuses the lifetime price before any Stripe call", "refuses any non-catalog or one-time price", "no customer-facing screen offers a $99 or lifetime purchase", "pricing pages still show monthly $7.99, annual $49.99 and the 14-day trial" |
| **Existing lifetime entitlements preserved** | `subscription.ts` reads up to 20 rows and prefers `status === "lifetime"`, then any still-valid row, then newest. SQL `has_active_subscription` unchanged (lifetime counts). Profile and the native notice still show "Lifetime ... Founding Member" to existing members. No code deletes or rewrites `subscriptions` rows | "existing lifetime entitlements are still honored", "a newer non-premium row cannot hide an existing lifetime entitlement" |
| **AI consent** | `src/lib/ai/consent.ts`, `consent.server.ts`, `consent-client.ts`, `consent.functions.ts`; `requireAIConsent`/`assertAIConsent` on every AI route and on live voice mint; 403 `ai_consent_required`, fail closed 503 if unreadable; withdraw switch at `/settings/privacy` | `tests/ai-consent.test.mjs`: **11 route entries** (ai coach, ai brief, ai coach_tip, brief, insights, swap, stt, tts, tts-elevenlabs, Simli speak, Simli session) each with 4 cases (none => 403 and zero provider calls; given => 200; revoked => 403; unreadable => 503), plus voice mint, client store, call-site scan and a mutation check |
| **Native purchase gate (#40)** | **On main.** `src/lib/native-app.ts`; `createCheckoutSession` and `createPortalSession` return `NATIVE_PURCHASE_UNAVAILABLE` for app requests (UA token `RestPilotApp/` or header `x-restpilot-native-app: 1`) before any Stripe call; app UI shows no prices or purchase buttons | `tests/native-purchase-gate.test.mjs` |
| **Sign in with Apple (#58)** | **On main, website only.** `src/lib/auth/oauth-providers.ts` (`APPLE_SIGNIN_ENABLED = true`; button shows only when Supabase reports Apple enabled; Google and Apple hidden inside the app) | `tests/apple-signin.test.mjs` |
| **Voice kill switch** | `openai.functions.ts`: voice mint refuses with `voice_disabled` unless `REALTIME_VOICE_ENABLED === "1"` (checked after consent, before any debit or provider call) | `tests/crisis-no-forward.test.mjs` harness and `tests/voice-session-postgres.test.mjs` |

### 1.3 What is on `main` versus only on branches (honest list)

| Item | On main? | Notes |
|---|---|---|
| Native purchase gate (#40) and hydration fix (#50) | Yes | |
| Sign in with Apple on the **website** (#58) | Yes | |
| Sign in with Apple **inside the iPhone app** (#64) | **No** | Lives on `codex/restpilot-railway-migration`; needs an app-shell rebuild. Today the app shows email and password only (no third-party login in the app, so Guideline 4.8 is not triggered). |
| iPhone app shell (`ios-app/`) | **No** (0 files on main) | Only on the Railway branch. The app loads restpilotai.com, so it gets this release with no rebuild. |
| Apple In-App Purchase (#63) | **No, held** | Apple still requires IAP before App Store submission (see `APP-STORE-COMPLIANCE.md`). Fine for internal TestFlight. |
| Website checkout kill switch `VITE_WEB_CHECKOUT_ENABLED` and the past-due "Manage billing" fix (#57) | **No** | After this release the website **still sells Monthly and Annual**. A `past_due`/`unpaid` subscriber still sees "Upgrade to Premium" with no way to fix the card or cancel (they can use the Stripe emails). |
| Privacy policy draft for iOS (#72) | **No (draft)** | Does not ship. The live policy is the current `legal.privacy.tsx` on main, which already has the AI-providers section from #56. |
| Stripe on Railway (#21) | No | |

### 1.4 Other checks worth knowing
- Old live code and the new migrations are compatible (verified in the Aug 17 source `3bcbf05`): its only call to `has_ai_budget` is through the **admin (service-role) client**, it never writes `ai_daily_token_cap`, and its voice mint does not call the new RPCs. So rolling the website back after the migrations does not break the old build (section 4).
- Premium users' cap is fixed at 500,000 inside `has_ai_budget`; only the **free tier** reads `user_prefs.ai_daily_token_cap`. That column is exactly what the cap trigger protects.

## 2. What changes for users when this is published (live Aug 17 build vs main)

166 files differ (`git diff --stat 3bcbf05 origin/main`). Only `package.json` changed among dependency files (two npm scripts added; no dependency change). User-visible changes by merged PR:

| PR | User-visible change |
|---|---|
| #2 | `robots.txt` sitemap line points to restpilotai.com (live says `shift-rest-ai.lovable.app`). |
| #19, #74 | **$99 Lifetime plan and "Founding Member Limited Time" gone** from `/pricing` and `/paywall`. Only Monthly $7.99 and Annual $49.99 with the 14-day trial. Checkout for lifetime is refused server-side. Existing lifetime members keep Premium. |
| #38, #44 | Fitbit/Oura connect callbacks no longer return 500; their OAuth state is signed so nobody can attach tokens to another account. |
| #40, #50 | Inside the iPhone app: no prices, no purchase or billing buttons, notice "Subscriptions aren't available in the app yet."; no hydration error. Website unchanged. |
| #22 | iPhone layout fix. |
| #48 | Companion shows a 2D fallback now that Ready Player Me is gone. |
| #53 | 2-6 week rotations advance correctly with no saved Week A date. |
| #54 | Partner share links carry only shift times (no notes, ids); "Export my data" covers every user table. |
| #55 | Deep links survive sign-in; the stray product name "Reelo" is replaced by "RestPilot" (23 strings). |
| #60 | Companion evening Smart Alarm and bedtime use the user's time zone, not UTC. |
| #56 | **"Allow AI features?" consent dialog** before first AI use, per-provider disclosure, withdraw switch at Profile > Privacy & AI data sharing (`/settings/privacy`, new page). Without consent nothing is sent to an AI provider. |
| #58 | "Continue with Apple" on the website sign-in. |
| #67, #68 | Companion and live-voice safety-and-care guardrail; questions no longer hijacked by the sound/alarm router; local crisis card that works without AI consent. |
| #77 | **Crisis messages are never forwarded to an AI provider**: local card plus a short static caring reply (988, 911). Normal messages are unaffected. |
| #75 | Shift Swap Copilot no longer always fails with 401; dashboard AI cards survive malformed replies (an "unavailable / Try again" card instead of a blank dashboard); accessibility labels. |
| #78, #79 | Onboarding: no consent flash for returning users, Back, Enter, resume after reload, scrollable dialog so the consent button is visible on small phones; dashboard h1; companion intro sheet waits for onboarding. |
| #76 | **AI daily budget enforced on every paid route and fail closed** (an error while checking the budget gives a retryable 503 instead of free AI); usage now accrues on every route in dollar-calibrated token-equivalents (free tier 15,000/day is about $0.30; premium 500,000 about $10), so **free users can reach the daily limit sooner than before** and see a user-safe 402/429 message; **live voice is OFF** (see below). |
| #52, #51, #66, docs | Documentation only. |

**Live voice changes from on to off.** Today's live build offers live voice with no cost cap. After Publish, minting returns "Voice is temporarily unavailable. You can keep using the text coach." until you set `REALTIME_VOICE_ENABLED=1` (section 7g). Text coach, speech-to-text, TTS and the crisis card are not affected.

## 3. Database

### 3.1 What is known and not known
- Migrations newer than the live build: **exactly two**, both from Nov 15 (`git diff --stat 3bcbf05 origin/main -- supabase`). Everything else in `supabase/migrations/` (49 files, latest `20260706024628_...`) is older than the Aug 17 build and was part of what the live site already runs.
- **Unknown:** whether those 49 older migrations are all applied in the live database (repo notes in `docs/launch/production-checklist.md` say 18 were applied in June), whether Lovable applies migration files that arrive from GitHub (as opposed to ones generated inside the Lovable chat, which have the UUID filenames), and which database role Lovable's SQL editor runs as. Nobody can read the production database from here.
- Known mechanism in the repo: `supabase/config.toml` project id `czsgjqfcjiuqirvmdlps`; the existing docs tell the owner to run SQL from **Lovable > project > More (...) > Database > Manage > SQL editor**, or the Supabase dashboard SQL Editor. Treat both as paste-and-run. Running SQL by hand does not write a migration-history row; the files are idempotent, so a later automatic apply is harmless.

### 3.2 The migrations, in order

| # | File | What it does | Destructive? | Locking | Idempotent? | Safety-critical? |
|---|---|---|---|---|---|---|
| 1 | `20261115060000_lock_ai_daily_token_cap.sql` | Creates function `guard_user_prefs_ai_cap()` (not SECURITY DEFINER) and trigger `user_prefs_guard_ai_cap` BEFORE INSERT OR UPDATE on `user_prefs`: for `authenticated`/`anon`, keeps the stored cap on UPDATE and forces 15000 on INSERT | No (no data rewritten; existing rows untouched) | `CREATE TRIGGER` takes a short `SHARE ROW EXCLUSIVE` lock on `user_prefs` (blocks concurrent writes for an instant; reads continue) | Yes (`CREATE OR REPLACE FUNCTION`, `DROP TRIGGER IF EXISTS`) | **Yes.** Without it any signed-in free user can raise their own daily AI allowance by writing the column. |
| 2 | `20261115070000_voice_session_ledger_and_budget_rpc_lockdown.sql` | (a) `REVOKE EXECUTE` on `has_ai_budget(uuid)` from PUBLIC, anon, **authenticated**, grant to service_role. (b) Creates `claim_voice_session`, `end_voice_session`, `charge_voice_overage` (SECURITY DEFINER, per-user advisory lock, rows in `ai_log`), revoked from clients, granted to service_role | No (functions and grants only; no table or data change) | None beyond catalog locks | Yes (`CREATE OR REPLACE`, REVOKE and GRANT repeatable) | **Yes.** (a) stops any signed-in user probing another user's cap status. (b) is what live-voice minting needs; without it minting **fails closed**. |

Total risk: low. Neither touches user data or existing columns. Both ran cleanly in the repo's real-Postgres tests against all prior migrations.

### 3.3 How to apply (owner, iPhone) and check before and after
Pick one tool; do not mix half-and-half:
1. **Lovable SQL editor** (More > Database > Manage > SQL editor), or
2. **Supabase dashboard > SQL Editor** for project `czsgjqfcjiuqirvmdlps`.
(Or ask Lovable in chat to "apply the pending migrations from main". That is the same unknown mechanism; confirm with the checks below.)

Paste the **whole file** for migration 1, Run, then migration 2, Run. Each is one script; if the tool reports an error, stop and send me the message.

**Before (read-only; tells you whether either is already applied):**
```sql
select tgname, tgenabled from pg_trigger
where tgrelid = 'public.user_prefs'::regclass and not tgisinternal;

select p.proname,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_can_run,
       has_function_privilege('anon', p.oid, 'EXECUTE')          as anon_can_run,
       has_function_privilege('service_role', p.oid, 'EXECUTE')  as service_role_can_run
from pg_proc p
where p.pronamespace = 'public'::regnamespace
  and p.proname in ('has_ai_budget','claim_voice_session','end_voice_session','charge_voice_overage');
```
Before: no `user_prefs_guard_ai_cap` row; `has_ai_budget` shows `authenticated_can_run = true`; the three voice functions are absent.

**After (same two queries):** a `user_prefs_guard_ai_cap` row with `tgenabled = O`; `has_ai_budget` `authenticated_can_run = false`, `anon_can_run = false`, `service_role_can_run = true`; all three voice functions present with `authenticated_can_run = false`, `service_role_can_run = true`.

Then run the rolled-back negative test from `AI-CAP-MIGRATION-VERIFY.md` ("Safe negative test": it must end with an error showing `before` equals `after`, not 999999).

**Optional read-only check for abuse before the fix** (counts only):
```sql
select ai_daily_token_cap, count(*) from public.user_prefs group by 1 order by 2 desc;
```
Free users should all be at 15000 (older rows may sit at the former default 60000). Other values may mean someone raised their own cap; note them, do not edit them now.

### 3.4 Order relative to the website publish
- **Code before migration is safe.** New code with migration 1 missing: budgets and consent work; the user-cap hole stays open until you apply it. New code with migration 2 missing: `has_ai_budget` is still callable by signed-in users (leak only), voice minting refuses (it is off anyway).
- **Migration before code is safe.** The old live build does not use anything the migrations change (section 1.4).
- Recommended: apply **migration 1 then 2 first**, then Publish, so the site never runs with the hole open. If you would rather publish first, apply both within the same session.
- Voice: with the kill switch unset, nothing mints regardless. With the flag set but migration 2 missing, `claim_voice_session` errors and the mint is refused (fails closed). So **never set `REALTIME_VOICE_ENABLED` before migration 2 is confirmed.**

## 4. Rollback plan

### 4.1 Website (Lovable)
In Lovable: project > version history (the same screen as `RELEASE-READINESS.md` uses), restore the version before this publish (the Aug 17 build `b-1786931160964` is the live one now; confirm which entry that is by its timestamp), then **Publish > Update** again. Exact button names beyond "restore previous version" and "Publish > Update" are unknown to me. Verify with `GET /api/public/version`: `buildId` returns to the older value. Note the restore reintroduces the $99 lifetime offer for new visitors: only roll back if the problem outweighs that (you can archive the lifetime price in Stripe, section 6, to stop sales either way).

### 4.2 Database rollback SQL (only if a migration itself causes a problem)
Rolling back the website does **not** require rolling back migrations (section 1.4).

Migration 1 (re-opens the free-tier cap hole):
```sql
drop trigger if exists user_prefs_guard_ai_cap on public.user_prefs;
drop function if exists public.guard_user_prefs_ai_cap();
```
Migration 2:
```sql
-- (a) restore the old privilege on has_ai_budget (re-opens the "probe another user" leak)
grant execute on function public.has_ai_budget(uuid) to authenticated;
-- (b) remove the voice ledger functions (voice minting then fails closed)
drop function if exists public.claim_voice_session(uuid, text, integer, integer);
drop function if exists public.end_voice_session(uuid, text, integer, text);
drop function if exists public.charge_voice_overage(uuid, text, integer, integer);
```
Rows already written to `ai_log` (`rt-mint:*`, `rt-end:*`, `rt-over:*`) are usage records that age out of the 24-hour budget window; leave them.

### 4.3 What is NOT reversible
- Users who saw and answered the consent dialog: the grant and withdrawals are recorded in `user_prefs.consent_json` and `legal_acceptances`; rolling back code does not erase them.
- Anything a user did on the new build (new sign-ins with Apple, saved settings).
- Stripe payments or sessions created in the meantime, and any lifetime Checkout Session paid after publish (honoured by the webhook, by design).
- Emails already sent; cached service workers on devices (the old build is re-delivered, but the 60-second poll and update banner may need one reload).
- A kept manual migration run is not "undone" by a Lovable restore; the SQL above is the only way back.

### 4.4 Decision points
| Trigger | Action |
|---|---|
| Verification script FAILs on build id after a few minutes | Wait 5 minutes (CDN), reload; if still old, the publish did not promote: repeat Publish > Update. No rollback. |
| Verification FAILs on lifetime/consent/crisis strings but build id is new | Treat as a bad build: roll back the website (4.1), send me the output. |
| Existing lifetime or paying subscriber shows Free after publish | Roll back the website at once (4.1); do not touch the database. Then check Stripe webhook and the `VITE_PAYMENTS_CLIENT_TOKEN` build value. |
| Wave of AI refusals for premium users ("temporarily unavailable" 503) | It is the fail-closed budget check erroring. Check database health and migration 2 grants (section 3.3). Roll back the **website** only if it persists past a database recovery. Do not drop the migrations. |
| Free users complain about hitting the daily limit | Expected tradeoff (section 8, decision 1). Not a rollback trigger. |
| Sign-in or onboarding blocked for everyone | Roll back the website. |

## 5. Post-publish verification

### 5.1 Automated: `scripts/post-publish-verify.mjs`
Read-only: HTTP GET only, Node 18+ built-ins only, no sign-in, no cookies, no secrets.
```
node scripts/post-publish-verify.mjs                      # production
node scripts/post-publish-verify.mjs --base http://127.0.0.1:4391   # a local build
node scripts/post-publish-verify.mjs --json
```
Exit code 0 = no FAIL (WARN allowed), 1 = at least one FAIL. Checks (the first column is what the table prints):

| Check | Passes when |
|---|---|
| build id differs from Aug 17 build | `/api/public/version` `buildId` is not `b-1786931160964` |
| x-deployment-id differs | response header is not `119d568c0ca7e3cb...bb0a5b3` (WARN if absent, as on a local build) |
| sw.js carries the new build id | `/sw.js` no longer contains the old build id |
| /api/public/health | 200 and `ok: true` |
| /pricing and /paywall HTML | no `$99`, `Founding Member`, `restpilot_lifetime`, or the word "lifetime" (the one allowed phrase: "Lifetime purchases (no longer sold)" in the paywall renewal disclosure) |
| `/`, `/safety`, `/coach` HTML | no `$99`, "Founding Member - Limited", `restpilot_lifetime` |
| JS bundles | every JS file the pages reference loads; none contains the `$99` literal, "Founding Member - Limited" or a one-time cadence; the pricing, paywall and billing chunks contain no lifetime string. (`restpilot_lifetime` and "Founding Member" are *expected* elsewhere in the bundle set: the shared entitlement chunk and the existing-member notice. That is why those two strings are only forbidden in the offer chunks.) |
| consent gate strings | `ai_consent` present in the bundles |
| crisis strings | `988` present on `/safety` or bundles, and the `x-crisis-support` handler is in the coach/companion bundles |
| no "Reelo" | not in any page or bundle |
| robots.txt | `Sitemap:` host is restpilotai.com; `/sitemap.xml` 200 with all URLs on restpilotai.com (WARN only) |
| legal pages | `/legal/privacy`, `/terms`, `/subscription`, `/third-parties`, `/disclaimers` return 200 |
| `/settings/privacy` | 200 (new consent page) |

**Dry runs (Nov 15, from this session):**
- Against **production now** (old build): **12 PASS, 0 WARN, 11 FAIL**, overall FAIL. The failures are exactly the ones the release should fix: build id unchanged, deployment id unchanged, sw.js old build, `$99` and "Founding Member" and "Lifetime" in `/pricing` and `/paywall` HTML, lifetime literals in the JS bundles, no `ai_consent`, no `x-crisis-support`, one "Reelo" string, robots.txt sitemap host `shift-rest-ai.lovable.app`, `/settings/privacy` 404. The script therefore detects the old build.
- Against a **local node_server build of main 4b9ebde**: **21 PASS, 2 WARN, 0 FAIL**, overall PASS (WARNs: no `x-deployment-id` header and no `/sw.js` on a local build; both expected).

### 5.2 Running it from an iPhone
1. Merge this PR first. GitHub lists a manually run workflow only once its file is on the default branch (`main`). (I am not merging it; this is a prerequisite you control. Until then run the script from a laptop, or ask me to run it.)
2. Safari > github.com/scubamike124/shiftrest-ai > **Actions** > **Post-publish verify** (left list) > **Run workflow** > leave the URL as `https://restpilotai.com` > **Run workflow**.
3. Open the run, then the **verify** job; the result table is also at the top of the run's **Summary**. Green = no FAIL.
The workflow is read-only (`contents: read`, no secrets) and refuses any target other than restpilotai.com, www.restpilotai.com or the Lovable preview host.

### 5.3 Manual checklist (cannot be automated)
Use your own accounts. Do not tap "Start" on a live checkout.
1. **Existing lifetime subscriber still Premium.** Sign in with a test or real lifetime account. Profile shows "Lifetime access - thank you for being a Founding Member" (no Manage button, by design). If you have no lifetime account, run `STRIPE-SUBSCRIBER-AUDIT.md` query 2 and confirm `lifetime` people are counted; you cannot test the UI without an account.
2. **Existing monthly or annual subscriber:** Profile shows "Premium · Monthly/Annual"; Manage subscription opens the Stripe portal; close it.
3. **Cap trigger:** run the three SQL checks in section 3.3 and the rolled-back negative test in `AI-CAP-MIGRATION-VERIFY.md`.
4. **Voice stays disabled:** open the Companion/Pilot, try live voice. Expected: "Voice is temporarily unavailable. You can keep using the text coach." (while `REALTIME_VOICE_ENABLED` is unset). Text coach still answers.
5. **Crisis card:** in Coach type a crisis phrase (for example "I want to end my life"). Expected: the local crisis support card and a short caring reply with 988; no normal AI answer. Then send "I slept 4 hours" and get a normal reply. Also do it signed in with AI consent off: the card must still appear.
6. **Onboarding and consent on iPhone (Safari and the TestFlight app):** new account or reset flow: onboarding is scrollable, the consent button visible on a small phone, Back works. Coach: "Allow AI features?" dialog; **Not now** sends nothing; **Allow** gets a reply; Profile > Privacy & AI data sharing switch off stops it.
7. **Sign in with Apple (website):** sign out, `/auth`, Continue with Apple, land signed in. In the app: email and password only.
8. **Stripe webhook receives events:** Stripe dashboard > Developers > Webhooks > the RestPilot endpoint > recent deliveries show 2xx after publish. (Do not resend old events: see `STRIPE-SUBSCRIBER-AUDIT.md` step 3.) A real renewal or a test-mode event confirms end to end.
9. **App check:** in the iPhone app `/pricing` and `/paywall` show no prices and the "Subscriptions aren't available in the app yet." notice.
10. **Lovable logs:** no new 500s on `/api/public/payments/webhook`, `/api/public/wearables/*`, `/api/ai`.

## 6. Stripe: archive the lifetime price AFTER publish

**Why after:** the live Aug 17 build still sells lifetime. Archiving before publish makes its lifetime checkout fail with an error. After publish, no code path can create a lifetime checkout (section 1.2), so archiving is a belt-and-braces step.

### Steps (Stripe dashboard in Safari on iPhone, live mode)
1. dashboard.stripe.com, make sure **Test mode is off**.
2. Menu > **Product catalog** > open the RestPilot lifetime product > tap the **$99.00 one-time** price row.
3. Top right (...) > **Archive price** > confirm.
4. **Do not** create a replacement price with the same lookup key, do not edit or transfer the `restpilot_lifetime` lookup key, and do not delete the price or product.

### Effects (Stripe behaviour as documented; I have not run it)
- Existing subscriptions and past payments are unaffected; lifetime members' access comes from the `lifetime` rows in `public.subscriptions`, which need no Stripe call.
- An archived price cannot be used to create new Checkout Sessions. A Checkout Session **opened before publish** can still be paid until it expires (up to 24 hours). The webhook then runs `checkout.session.completed`, fetches the line item and resolves the price by **`lookup_key`** (or `metadata.lovable_external_id`) via `priceLookup()`. If it still resolves to `restpilot_lifetime`, it mints the lifetime row; if the lookup key were moved or removed, it would resolve to something else, **mint nothing and alert you** while the customer has paid. So the lookup key must stay on that price.
- Unknown: whether Lovable's Stripe integration re-syncs or reactivates prices. Check the price is still archived after the next catalog change.

### Read-only subscriber audit for existing lifetime holders (you run these; counts only)
From `STRIPE-SUBSCRIBER-AUDIT.md` (Lovable > More > Database > Manage > SQL editor):
```sql
-- Lifetime holders and their status (counts only)
select environment, price_id, status, count(*) as subscriptions, count(distinct user_id) as people
from public.subscriptions
where status = 'lifetime' or price_id = 'restpilot_lifetime'
group by 1, 2, 3 order by 1, 2, 3;
```
```sql
-- Everyone with Premium right now, per environment (same rule as the app)
select environment, count(distinct user_id) as people_with_premium
from public.subscriptions
where status = 'lifetime'
   or (status in ('active', 'trialing') and (current_period_end is null or current_period_end > now()))
   or (status = 'canceled' and current_period_end is not null and current_period_end > now())
group by environment;
```
The full set (query 1 by plan and status, query 3 double billing, Stripe-side counts, comparison step) is in `STRIPE-SUBSCRIBER-AUDIT.md`. Record the lifetime count before and after publish; it must not change.

## 7. Tap-by-tap iPhone publication steps

Estimated time 30-40 minutes. Do these in order. Buttons marked (unknown) are menu names I cannot see from here; follow the closest equivalent and tell me if one differs.

**(a) Review**
1. Read sections 0, 3, 4 and 8 of this document. Decide the items in section 8.
2. Open github.com/scubamike124/shiftrest-ai/pulls: confirm #72, #63, #57, #21 are **not** merged (they must not be). Confirm the latest "main checks" run on main is green.
3. Merge this PR (the release package) if you want to run verification from the phone (section 5.2). It contains no app code.

**(b) Apply the migrations** (section 3.3)
4. Lovable app or lovable.dev in Safari > your RestPilot project > **More (...)** > **Database** > **Manage** > **SQL editor** (same path as the Stripe audit; label wording may differ).
5. Run the two "Before" queries; screenshot or note the result.
6. Open `supabase/migrations/20261115060000_lock_ai_daily_token_cap.sql` on GitHub, copy the whole file, paste into the SQL editor, **Run**.
7. Same for `20261115070000_voice_session_ledger_and_budget_rpc_lockdown.sql`.
8. Run the "After" queries and the rolled-back negative test. Stop if anything differs from the expected result.

**(c) Publish from Lovable**
9. Project preview first: `/pricing` shows Monthly $7.99 and Annual $49.99 with the 14-day trial and no $99; `/version` shows a new Build ID.
10. **Publish** (top right) > **Update** (as in `RELEASE-READINESS.md`; exact wording (unknown)). Wait for it to finish.

**(d) Run verification**
11. Safari > the repo > **Actions** > **Post-publish verify** > **Run workflow** (section 5.2). Open the summary. If the result is FAIL on the build id, wait five minutes and run again.
12. Or open `https://restpilotai.com/api/public/version` and check `buildId` is not `b-1786931160964`.

**(e) Manual checks**
13. Section 5.3, items 1-10 (about 15 minutes).

**(f) Archive the lifetime price**
14. Only after (d) and (e) pass: section 6.

**(g) Voice (optional; leave off until you are ready)**
15. Voice stays off after publish. To enable it **only after** all of these:
   1. migration 2 confirmed (section 3.3);
   2. a **dedicated OpenAI project and API key** used only for Realtime;
   3. a **hard monthly spend limit** (and alerts) on that OpenAI project; this is the only real bound on a modified client's voice spend (`VOICE-COST-MODEL.md`: not bounded by our cap for a hostile client);
   4. that key in the server environment (`OPENAI_API_KEY` or `OPENAI_REALTIME_API_KEY`; where Lovable keeps secrets is (unknown) to me: Lovable > project > Cloud/Secrets);
   5. then set `REALTIME_VOICE_ENABLED=1` and re-test one voice session.
   To turn it off again, unset the variable or set it to anything but `1`.

**(h) Rollback triggers:** section 4.4.

## 8. Owner decisions and risks

1. **Fail-closed AI budget (outage tradeoff).** If the database call that checks the daily budget errors, hangs over 4 seconds or returns something unexpected, AI requests get a retryable 503 instead of being allowed. That protects spend but means a database incident also takes AI down. The old behaviour failed open. Decision: accept (recommended: a spend bug is worse than a short AI outage), or ask for a degraded mode.
2. **Free users hit the limit sooner.** Usage now accrues on every paid route (TTS, STT, insights, swap, brief), so the free 15,000/day (about $0.30) is consumed faster than before. Decision: keep the numbers, or raise the free cap (code constants in `src/lib/ai/log.server.ts` and the trigger's default of 15000 in migration 1).
3. **Static crisis reply.** A crisis cue gets a fixed local reply (988, 911, findahelpline.com), not a model answer. Safe and consistent, but not conversational. Accept or ask for a design review.
4. **False positives.** The cue list can flag harmless sentences, which then get the crisis card and are not answered by the AI (a test covers deliberate non-matches). Watch support emails; tune the cue list in `src/lib/safety/crisis-cues.ts` if needed.
5. **Audio disclosure.** Speech-to-text and live voice send the user's audio to OpenAI **before** any text check can run, so a spoken crisis message reaches the provider. The consent dialog and privacy policy say so. Decision: accept the disclosure as written, or remove voice-to-AI until server-side screening exists.
6. **Voice flag.** Voice is **off** after publish; turning it on needs the OpenAI spend limit first (section 7g). The longer-term fix (server-mediated calls) is designed but not built (`VOICE-SERVER-MEDIATED-CALLS-PLAN.md`).
7. **#63 and #72 are not in this release.** Without #63 there is no Apple IAP, so the App Store submission is still blocked (internal TestFlight is fine); the live privacy policy is the one on main. #57 is also not in: the website still sells Monthly/Annual and past-due customers still have no Manage billing button.
8. **Railway line parity.** Production is Lovable on `main`; the Railway branch (`codex/restpilot-railway-migration`) has parity ports of consent and Apple sign-in (#62, #64) and a different Supabase auth path. Fixes here do not reach Railway automatically, and the iPhone app shell with in-app Apple sign-in exists only there. Decision: when to cut over, and keep the two lines in step until then.
9. **Bugbot.** Automated review bot findings (Cursor Bugbot, if enabled on this repo) are not part of the required checks and I could not read them from here. Please check the open comments on the merged PRs #74-#79 before publishing; I did not verify them.
10. **Lifetime window.** Lifetime Checkout Sessions opened before publish remain payable for up to 24 hours and are honoured. Archive the price after publish (section 6) and keep the lookup key.
11. **Stale docs.** `RELEASE-READINESS.md` still names `e8742a9` and a different Publish scope. Treat this document as current.

## Appendix A: dry-run output (abridged)

Production (old build), `node scripts/post-publish-verify.mjs`:
```
FAIL  build id differs from Aug 17 build   still b-1786931160964
FAIL  x-deployment-id differs ...          still 119d568c0ca7e3cb...
FAIL  sw.js carries the new build id       sw.js still contains the old build b-1786931160964
PASS  /api/public/health 200 ok:true
FAIL  /pricing HTML has no lifetime offer  $99 ...; Lifetime "...monthly, annual, and lifetime plans..."
FAIL  /paywall HTML has no lifetime offer  $99; Founding Member — Limited Time; Lifetime
FAIL  JS bundles contain no lifetime offer index: $99 / cadence one-time; billing.functions: restpilot_lifetime; paywall: $99, Founding Member
FAIL  AI consent gate present in bundles
FAIL  crisis server-guard marker present in client
FAIL  no 'Reelo' product name
FAIL  robots.txt sitemap host correct      https://shift-rest-ai.lovable.app/sitemap.xml
FAIL  /settings/privacy ... 200            HTTP 404
12 PASS, 0 WARN, 11 FAIL   OVERALL: FAIL
```
Local build of main 4b9ebde: `21 PASS, 2 WARN, 0 FAIL   OVERALL: PASS`.
