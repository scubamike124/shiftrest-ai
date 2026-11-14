#!/usr/bin/env bash
# Entry point of the one-off migration runner. Configure with service
# variables (Railway's variable editor; never chat or git):
#   MIGRATION_STEP     preflight | import | verify | rewire-dry-run | rewire-apply | idle
#   TARGET_DB_URL      new project's Session pooler connection string (secret)
#   TARGET_REF         new project's ref, must appear in TARGET_DB_URL
#   EXPORT_URL         HTTPS link to the Lovable .backup (secret: a signed link)
#   EXPORT_SHA256      optional: expected sha256 of the export file
#   PENDING_MIGRATIONS optional: comma-separated repo migration versions to apply,
#                      only when import/preflight exits 6 (history gap) after a
#                      manual check of the live schema
#   APP_URL, CRON_SECRET, SUPABASE_SERVICE_ROLE_KEY   for rewire-* only
# Prints reports with counts/checksums only. The export and plan live in an
# ephemeral directory that is deleted when the step ends.
set -euo pipefail
KIT="${KIT:-/kit/scripts/migration}"
REPO_MIGRATIONS="${REPO_MIGRATIONS:-/kit/supabase/migrations}"
STEP="${MIGRATION_STEP:-idle}"
if [ "$STEP" = idle ]; then echo "MIGRATION_STEP=idle: nothing to do"; exit 0; fi
: "${TARGET_DB_URL:?TARGET_DB_URL is required}" "${TARGET_REF:?TARGET_REF is required}" "${EXPORT_URL:?EXPORT_URL is required}"
WORK="$(mktemp -d /tmp/restpilot-migration.XXXXXX)"
trap 'case "$WORK" in /tmp/restpilot-migration.*) rm -rf "$WORK" ;; esac' EXIT
umask 077
echo "downloading export (link not printed)"
# -L: signed storage links redirect; redirects may only go to https.
curl -fsSL --proto =https,file --proto-redir =https --retry 3 -o "$WORK/export.backup" "$EXPORT_URL"
SUM="$(sha256sum "$WORK/export.backup" | cut -d' ' -f1)"
echo "export sha256 $SUM ($(stat -c %s "$WORK/export.backup") bytes)"
if [ -n "${EXPORT_SHA256:-}" ] && [ "$EXPORT_SHA256" != "$SUM" ]; then echo "export checksum mismatch"; exit 1; fi
if [ "$(head -c 2 "$WORK/export.backup")" = "PK" ]; then
  echo "export is a zip; extracting the .backup inside"
  mkdir "$WORK/x" && unzip -q "$WORK/export.backup" -d "$WORK/x"
  f="$(find "$WORK/x" -type f \( -name '*.backup' -o -name '*.dump' \) | head -1)"
  [ -n "$f" ] || { echo "no .backup file inside the zip"; exit 1; }
  mv "$f" "$WORK/export.backup"
fi
node "$KIT/plan.mjs" --archive "$WORK/export.backup" --out "$WORK/plan"
case "$STEP" in
  preflight) node "$KIT/import.mjs" --plan "$WORK/plan" --confirm-target "$TARGET_REF" --repo-migrations "$REPO_MIGRATIONS" ${PENDING_MIGRATIONS:+--pending-migrations "$PENDING_MIGRATIONS"} --preflight-only ;;
  import)    node "$KIT/import.mjs" --plan "$WORK/plan" --confirm-target "$TARGET_REF" --repo-migrations "$REPO_MIGRATIONS" ${PENDING_MIGRATIONS:+--pending-migrations "$PENDING_MIGRATIONS"} ;;
  verify)    node "$KIT/verify.mjs" --plan "$WORK/plan" --confirm-target "$TARGET_REF" ${VERIFY_ALLOW_GROWTH:+--allow-growth} ;;
  rewire-dry-run) node "$KIT/rewire.mjs" --plan "$WORK/plan" --confirm-target "$TARGET_REF" ;;
  rewire-apply)   node "$KIT/rewire.mjs" --plan "$WORK/plan" --confirm-target "$TARGET_REF" --apply ;;
  *) echo "unknown MIGRATION_STEP=$STEP"; exit 2 ;;
esac
