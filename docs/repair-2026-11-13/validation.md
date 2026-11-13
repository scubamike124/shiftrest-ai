# Reconciled-source validation

- 135/135 repair tests pass (account 19, billing 42, calendar 34, webhook 32, schemas 8). External IO is mocked.
- `npm run typecheck`: exit 0.
- `NODE_OPTIONS=--max-old-space-size=6144 npm run build`: exit 0; client, server and PWA build completed. Deprecation/chunk-size warnings remain.
- npm audit: 0 critical, 0 high, 10 moderate, 5 low. This is not a zero-vulnerability claim.
- Bun lock imported successfully from npm lock.
- 91/91 route imports preserved. Sale, Science and homepage source files unchanged.
- Monthly/annual checkout tests explicitly require the existing 14-day trial.
- `git diff --check`: clean.

No independent second reviewer or live backend/device verification was performed during this continuation. See reconciliation.md for remaining scope and blockers.
