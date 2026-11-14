#!/usr/bin/env bash
# REHEARSAL (dry run) of the Lovable Cloud -> owner-owned Supabase migration.
# Uses a throwaway local PostgreSQL 16 cluster and SYNTHETIC data shaped by
# supabase/migrations. It does not touch any hosted database and its output
# is NOT migrated data.
#
#   sudo bash scripts/migration/rehearsal/run.sh      (root: runs postgres as the postgres user
#                                                     and installs stub extensions temporarily)
#
# Flow: "source" DB = Supabase shim + the 49 migrations live had before
# 2026-11-13 + synthetic rows, cron jobs, vault secrets, queued email ->
# pg_dump -Fc --compress=zstd (Lovable's export format) -> plan.mjs ->
# import.mjs into a fresh "target" shim (applies the 3 pending repo
# migrations) -> verify.mjs -> extra checks (password hashes still verify,
# same user ids, RLS isolates users, sessions not copied, idempotent re-run,
# live-backend guard) -> teardown.
set -euo pipefail

KIT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO="$(cd "$KIT/../.." && pwd)"
PGBIN="${PGBIN:-/usr/lib/postgresql/16/bin}"
PORT="${REHEARSAL_PORT:-54329}"
# Unix socket paths are limited to ~107 bytes, so the cluster lives in a short /tmp path.
WORK="$(mktemp -d /tmp/rp-rehearsal.XXXXXX)"
EXTDIR="$("$PGBIN/pg_config" --sharedir)/extension"
INSTALLED=()

cleanup() {
  su postgres -s /bin/bash -c "'$PGBIN/pg_ctl' -D '$WORK/data' -m immediate stop" >/dev/null 2>&1 || true
  for f in "${INSTALLED[@]}"; do [ -n "$EXTDIR" ] && [ -n "$f" ] && rm -f "$EXTDIR/$f"; done
  case "$WORK" in /tmp/rp-rehearsal.*) rm -rf "$WORK" ;; esac
}
trap cleanup EXIT

say() { printf '\n== %s\n' "$*"; }

say "REHEARSAL ONLY - synthetic data, throwaway cluster at $WORK"
for f in "$KIT"/rehearsal/fake-extensions/*; do
  b="$(basename "$f")"
  if [ ! -e "$EXTDIR/$b" ]; then cp "$f" "$EXTDIR/$b"; INSTALLED+=("$b"); fi
done
chown postgres "$WORK"; chmod 755 "$WORK"
su postgres -s /bin/bash -c "'$PGBIN/initdb' -D '$WORK/data' -U postgres --auth=trust -E UTF8 --locale=C.UTF-8 >/dev/null"
su postgres -s /bin/bash -c "'$PGBIN/pg_ctl' -D '$WORK/data' -o \"-k $WORK -p $PORT -c listen_addresses='' -c timezone=UTC\" -l '$WORK/log' -w start >/dev/null"

export PSQL="$PGBIN/psql" PG_RESTORE="$PGBIN/pg_restore" PGOPTIONS="-c client_min_messages=warning"
P() { "$PGBIN/psql" -X -q -v ON_ERROR_STOP=1 -h "$WORK" -p "$PORT" -U postgres "$@"; }
P -c "create database lovable_source" -c "create database supabase_target"

say "source: Supabase shim + migrations that predate 2026-11-13 + synthetic data"
P -d lovable_source -f "$KIT/rehearsal/supabase-shim.sql"
P -d lovable_source -c "create schema supabase_migrations" \
  -c "create table supabase_migrations.schema_migrations (version text primary key, statements text[], name text)"
applied=0
for m in "$REPO"/supabase/migrations/*.sql; do
  v="$(basename "$m" | cut -d_ -f1)"
  [ "$v" -ge 20261113000000 ] && continue
  P -d lovable_source --single-transaction -f "$m" >/dev/null
  P -d lovable_source -c "insert into supabase_migrations.schema_migrations(version, name) values ('$v', '$(basename "$m" .sql | cut -d_ -f2-)')"
  applied=$((applied + 1))
done
echo "applied $applied migrations to source"
P -d lovable_source -f "$KIT/rehearsal/seed.sql" >/dev/null

say "export: pg_dump custom format, zstd (the format Lovable's Export data produces)"
"$PGBIN/pg_dump" -h "$WORK" -p "$PORT" -U postgres -d lovable_source -Fc --compress=zstd -f "$WORK/lovable-export.backup"
ls -l "$WORK/lovable-export.backup" | awk '{print $5" bytes"}'

say "target: fresh Supabase shim (stands in for a new Supabase project)"
P -d supabase_target -f "$KIT/rehearsal/supabase-shim.sql"

say "plan"
node "$KIT/plan.mjs" --archive "$WORK/lovable-export.backup" --out "$WORK/plan"

TARGET="postgresql://postgres@localhost/supabase_target?host=$WORK&port=$PORT"
SOURCE="postgresql://postgres@localhost/lovable_source?host=$WORK&port=$PORT"

say "guard: the kit refuses the live Lovable backend and unconfirmed targets"
if TARGET_DB_URL="postgresql://postgres.czsgjqfcjiuqirvmdlps:x@aws-0-us-east-1.pooler.supabase.com:5432/postgres" \
   node "$KIT/import.mjs" --plan "$WORK/plan" --confirm-target czsgjqfcjiuqirvmdlps 2>"$WORK/guard.err"; then
  echo "FAIL: live backend was not refused"; exit 1
fi
echo "refused live backend: $(cat "$WORK/guard.err")"
if TARGET_DB_URL="$TARGET" node "$KIT/import.mjs" --plan "$WORK/plan" --confirm-target some-other-ref 2>"$WORK/guard.err"; then
  echo "FAIL: mismatched confirm accepted"; exit 1
fi
echo "refused mismatched target: $(cat "$WORK/guard.err")"

say "import + verify"
TARGET_DB_URL="$TARGET" node "$KIT/import.mjs" --plan "$WORK/plan" --confirm-target supabase_target \
  --repo-migrations "$REPO/supabase/migrations"

say "extra checks"
T() { P -d supabase_target -At "$@"; }
S() { P -d lovable_source -At "$@"; }
fail=0
check() { if [ "$2" = "$3" ]; then echo "PASS $1"; else echo "FAIL $1: got '$2' expected '$3'"; fail=1; fi; }
check "same user ids" "$(T -c "select string_agg(id::text, ',' order by id) from auth.users")" "$(S -c "select string_agg(id::text, ',' order by id) from auth.users")"
check "password hashes byte-identical" "$(T -c "select md5(string_agg(coalesce(encrypted_password,'-'), ',' order by id)) from auth.users")" "$(S -c "select md5(string_agg(coalesce(encrypted_password,'-'), ',' order by id)) from auth.users")"
check "existing password still verifies (bcrypt, as GoTrue checks it)" \
  "$(T -c "select encrypted_password = extensions.crypt('rehearsal-pass-two', encrypted_password) from auth.users where email = 'rehearsal-2@example.invalid'")" "t"
check "wrong password rejected" \
  "$(T -c "select encrypted_password = extensions.crypt('wrong-password', encrypted_password) from auth.users where email = 'rehearsal-2@example.invalid'")" "f"
check "Google identity kept with its provider id" "$(T -c "select provider_id from auth.identities where provider = 'google'")" "1098765432101234567890"
check "entitlements identical: has_active_subscription for every user (active, lifetime, none)" \
  "$(T -c "select string_agg(id::text || '=' || public.has_active_subscription(id, 'live')::text, ',' order by id) from auth.users")" \
  "$(S -c "select string_agg(id::text || '=' || public.has_active_subscription(id, 'live')::text, ',' order by id) from auth.users")"
check "lifetime purchase carried over" "$(T -c "select count(*) from public.subscriptions where status = 'lifetime' and price_id = 'restpilot_lifetime'")" "1"
check "sessions not copied" "$(T -c "select count(*) from auth.sessions")" "0"
check "refresh tokens not copied" "$(T -c "select count(*) from auth.refresh_tokens")" "0"
check "profile not duplicated by signup trigger" "$(T -c "select count(*) from public.profiles")" "$(S -c "select count(*) from public.profiles")"
check "pending repo migrations applied" "$(T -c "select string_agg(version, ',' order by version) from supabase_migrations.schema_migrations where version >= '20261113'")" "20261113090000,20261113100000,20261113110000"
check "new migration objects exist" "$(T -c "select to_regprocedure('public.consume_ai_request(uuid)') is not null and to_regclass('public.subscription_sync_state') is not null")" "t"
check "email queues recreated empty" "$(T -c "select count(*) from pg_tables where schemaname = 'pgmq'")/$(T -c "select count(*) from pgmq.q_auth_emails")" "4/0"
check "cron jobs not copied (rewired separately)" "$(T -c "select count(*) from cron.job")" "0"
check "vault secrets not copied" "$(T -c "select count(*) from vault.secrets")" "0"
rls_own="$(T -c "begin; set local role authenticated; select set_config('request.jwt.claims', '{\"sub\":\"22222222-2222-4222-8222-222222222222\",\"role\":\"authenticated\"}', true); select count(*) from public.coach_messages; commit;" | tail -1)"
check "RLS: user 2 sees only their 60 coach messages" "$rls_own" "60"
rls_anon="$(T -c "begin; set local role anon; select count(*) from public.profiles; commit;" 2>&1 | tail -1 || true)"
case "$rls_anon" in *"permission denied"*|0) echo "PASS RLS: anon cannot read profiles ($rls_anon)";; *) echo "FAIL anon read profiles: $rls_anon"; fail=1;; esac
check "a new signup on the target still creates its profile (trigger restored)" \
  "$(T -c "insert into auth.users(id, aud, role, email, created_at, updated_at) values ('55555555-5555-4555-8555-555555555555','authenticated','authenticated','new@example.invalid', now(), now()); select count(*) from public.profiles where id = '55555555-5555-4555-8555-555555555555';" | tail -1)" "1"
T -c "delete from auth.users where id = '55555555-5555-4555-8555-555555555555'" >/dev/null

say "rewire: Vault secrets + pg_cron jobs against the new app host (synthetic secrets)"
APP=https://restpilot-web-staging.up.railway.app
TARGET_DB_URL="$TARGET" APP_URL="$APP" node "$KIT/rewire.mjs" --plan "$WORK/plan" --confirm-target supabase_target
check "dry run schedules nothing" "$(T -c "select count(*) from cron.job")" "0"
TARGET_DB_URL="$TARGET" APP_URL="$APP" CRON_SECRET="rehearsal-cron-secret-0123456789" SUPABASE_SERVICE_ROLE_KEY="rehearsal-service-role-0123456789" \
  node "$KIT/rewire.mjs" --plan "$WORK/plan" --confirm-target supabase_target --apply > "$WORK/rewire.out"
check "only the 4 jobs live had are scheduled, all against the new host" "$(T -c "select count(*) filter (where command like '%$APP/%') || '/' || count(*) from cron.job")" "4/4"
check "a job inactive on live stays inactive" "$(T -c "select active from cron.job where jobname = 'restpilot-ai-learn'")" "f"
check "live schedule taken from the export" "$(T -c "select schedule from cron.job where jobname = 'restpilot-notify-tick'")" "*/5 * * * *"
check "no secret value inside any job command" "$(T -c "select count(*) from cron.job where command like '%rehearsal-cron-secret%' or command like '%rehearsal-service-role%'")" "0"
check "secrets stored in Vault" "$(T -c "select string_agg(name, ',' order by name) from vault.decrypted_secrets where decrypted_secret like 'rehearsal-%'")" "email_queue_service_role_key,restpilot_cron_secret"
TARGET_DB_URL="$TARGET" APP_URL="$APP" CRON_SECRET="rehearsal-cron-secret-0123456789" SUPABASE_SERVICE_ROLE_KEY="rehearsal-service-role-0123456789" \
  node "$KIT/rewire.mjs" --plan "$WORK/plan" --confirm-target supabase_target --apply --include-default-jobs > /dev/null
check "--include-default-jobs adds the 2 jobs live lacked; re-run is idempotent" "$(T -c "select count(*) from cron.job")/$(T -c "select count(*) from vault.secrets")" "6/2"
if grep -q "rehearsal-cron-secret\|rehearsal-service-role" "$WORK/rewire.out"; then echo "FAIL rewire printed a secret"; fail=1; else echo "PASS rewire output contains no secret"; fi
T -c "delete from cron.job" >/dev/null
P -c "create database no_vault" >/dev/null
P -d no_vault -f "$KIT/rehearsal/supabase-shim.sql" >/dev/null
if TARGET_DB_URL="postgresql://postgres@localhost/no_vault?host=$WORK&port=$PORT" APP_URL="$APP" \
   CRON_SECRET="rehearsal-cron-secret-0123456789" SUPABASE_SERVICE_ROLE_KEY="rehearsal-service-role-0123456789" \
   node "$KIT/rewire.mjs" --plan "$WORK/plan" --confirm-target no_vault --apply > "$WORK/rewire-fail.out" 2>&1; then
  echo "FAIL rewire succeeded without Vault"; fail=1
elif grep -q "rehearsal-cron-secret\|rehearsal-service-role" "$WORK/rewire-fail.out"; then
  echo "FAIL rewire error output leaked a secret"; fail=1
else
  echo "PASS rewire failure without Vault prints no secret: $(grep -o 'ERROR:.*' "$WORK/rewire-fail.out" | head -1)"
fi

say "resume: a failed repository migration is retried on re-run, and verify fails until it is"
P -c "create database supabase_target2" >/dev/null
P -d supabase_target2 -f "$KIT/rehearsal/supabase-shim.sql" >/dev/null
TARGET2="postgresql://postgres@localhost/supabase_target2?host=$WORK&port=$PORT"
mkdir "$WORK/repo-migrations"
for m in "$REPO"/supabase/migrations/20261113*.sql; do cp "$m" "$WORK/repo-migrations/"; done
second="$(ls "$WORK/repo-migrations" | sed -n 2p)"
printf 'select 1/0; -- injected failure\n' | cat - "$WORK/repo-migrations/$second" > "$WORK/broken.sql" && mv "$WORK/broken.sql" "$WORK/repo-migrations/$second"
set +e
TARGET_DB_URL="$TARGET2" node "$KIT/import.mjs" --plan "$WORK/plan" --confirm-target supabase_target2 --repo-migrations "$WORK/repo-migrations" > "$WORK/resume1.out" 2>&1
code=$?
set -e
check "first run stops at the broken migration (exit 7)" "$code" "7"
if TARGET_DB_URL="$TARGET2" node "$KIT/verify.mjs" --plan "$WORK/plan" --confirm-target supabase_target2 > "$WORK/resume-verify.out" 2>&1; then
  echo "FAIL verify passed with a pending migration"; fail=1
else
  echo "PASS verify refuses while pending -> $(grep 'repository migrations applied' "$WORK/resume-verify.out")"
fi
cp "$REPO/supabase/migrations/$second" "$WORK/repo-migrations/$second"
TARGET_DB_URL="$TARGET2" node "$KIT/import.mjs" --plan "$WORK/plan" --confirm-target supabase_target2 --repo-migrations "$WORK/repo-migrations" > "$WORK/resume2.out" 2>&1
grep -E "resuming|migration applied|repository migrations applied|VERIFY" "$WORK/resume2.out"

say "history gap: an older repository migration missing from the export is refused, not skipped"
P -c "create database supabase_target3" >/dev/null
P -d supabase_target3 -f "$KIT/rehearsal/supabase-shim.sql" >/dev/null
mkdir "$WORK/gap-migrations"
for m in "$REPO"/supabase/migrations/20261113*.sql; do cp "$m" "$WORK/gap-migrations/"; done
printf 'select 1;\n' > "$WORK/gap-migrations/20260101000000_not_in_live_history.sql"
set +e
TARGET_DB_URL="postgresql://postgres@localhost/supabase_target3?host=$WORK&port=$PORT" node "$KIT/import.mjs" --plan "$WORK/plan" \
  --confirm-target supabase_target3 --repo-migrations "$WORK/gap-migrations" > "$WORK/gap.out" 2>&1
code=$?
set -e
check "history gap refused before restoring (exit 6)" "$code" "6"
grep -o "refusing: 1 repository migration.*" "$WORK/gap.out"
check "nothing was restored before the refusal" "$(P -d supabase_target3 -At -c "select count(*) from auth.users")" "0"
TARGET_DB_URL="postgresql://postgres@localhost/supabase_target3?host=$WORK&port=$PORT" node "$KIT/import.mjs" --plan "$WORK/plan" \
  --confirm-target supabase_target3 --repo-migrations "$WORK/gap-migrations" --pending-migrations 20260101000000 > "$WORK/gap2.out" 2>&1
check "listing only the gap still applies the newer migrations too (4 applied)" \
  "$(P -d supabase_target3 -At -c "select count(*) from migration_kit.repo_migrations where applied_at is not null")" "4"
grep -E "repository migrations applied|required app objects|VERIFY" "$WORK/gap2.out"

say "after go-live: a newer migration deployed with supabase db push is not re-applied by a re-run"
mkdir "$WORK/later-migrations"
for m in "$REPO"/supabase/migrations/20261113*.sql; do cp "$m" "$WORK/later-migrations/"; done
printf 'create table public.post_cutover_marker (id int);\n' > "$WORK/later-migrations/20261120000000_post_cutover.sql"
T -c "insert into supabase_migrations.schema_migrations(version, name) values ('20261120000000', 'post_cutover')" >/dev/null
TARGET_DB_URL="$TARGET" node "$KIT/import.mjs" --plan "$WORK/plan" --confirm-target supabase_target \
  --repo-migrations "$WORK/later-migrations" > "$WORK/later.out" 2>&1
grep -E "none pending|VERIFY" "$WORK/later.out"
check "deployed migration not re-applied" "$(T -c "select to_regclass('public.post_cutover_marker') is null")" "t"
T -c "delete from supabase_migrations.schema_migrations where version = '20261120000000'" >/dev/null
set +e
TARGET_DB_URL="$TARGET" node "$KIT/import.mjs" --plan "$WORK/plan" --confirm-target supabase_target --preflight-only \
  --repo-migrations "$REPO/supabase/migrations" --pending-migrations 20260601225645 > "$WORK/already.out" 2>&1
code=$?
set -e
check "a version live already has is refused in preflight (exit 6)" "$code" "6"

say "idempotency: re-running the import is a verified no-op"
TARGET_DB_URL="$TARGET" node "$KIT/import.mjs" --plan "$WORK/plan" --confirm-target supabase_target --repo-migrations "$REPO/supabase/migrations" | tail -3

say "runner entry point (as Railway would run it): verify step from a downloaded export"
MIGRATION_ALLOW_FILE_URL=1 KIT="$KIT" REPO_MIGRATIONS="$REPO/supabase/migrations" MIGRATION_STEP=verify TARGET_DB_URL="$TARGET" TARGET_REF=supabase_target \
  EXPORT_URL="file://$WORK/lovable-export.backup" bash "$KIT/runner/run-job.sh" | grep -E "^(export sha256|VERIFY)"

say "tamper detection: verify fails after one changed row"
T -c "update public.coach_messages set content = content || '!' where ctid = (select ctid from public.coach_messages limit 1)" >/dev/null
if TARGET_DB_URL="$TARGET" node "$KIT/verify.mjs" --plan "$WORK/plan" --confirm-target supabase_target >"$WORK/tamper.out" 2>&1; then
  echo "FAIL: tampered row not detected"; fail=1
else
  grep "^FAIL" "$WORK/tamper.out" | head -2; echo "PASS verify detected the changed row"
fi

[ "$fail" = 0 ] && say "REHEARSAL PASSED (synthetic data; not a migration of real data)" || { say "REHEARSAL FAILED"; exit 1; }
