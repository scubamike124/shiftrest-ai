## Verdict: inconclusive — but leaning "guards probably fired silently"

Your `/version` page shows client and server both on `b-1783381141244` with Match ✓. That single fact alone cannot distinguish two very different scenarios:

**Scenario A — guards worked (silent auto-update):**
1. You opened the app on canary v3 build.
2. Backgrounded 90s. Canary v4 published.
3. Foregrounded → poll or `pageshow` fetched `/api/public/version`, detected drift.
4. `reg.update()` fetched new `/sw.js`, it installed and became `waiting`.
5. The registrar's `autoActivateIfPossible` auto-posted `SKIP_WAITING` (no banner shown, by design — that's why the banner isn't guaranteed to appear).
6. `controllerchange` fired → one silent `window.location.reload()`.
7. You landed on v4. `/version` now shows v4 == v4. Match ✓.

**Scenario B — test never created drift:**
1. You happened to open the app *after* v4 was already live (e.g. Safari fetched v4 on the very first foreground before you noticed).
2. There was never a v3-in-memory vs v4-on-server gap for the guards to catch.
3. `/version` shows v4 == v4 trivially.

The current `/version` page doesn't record which build you *started* on, so we can't tell A from B after the fact.

## Why I lean toward A

- The canary label on `/version` in the served bundle is v4. If you had been running v3, `/version` would have shown "🟠 v4" on the server side and "🟢 v3" on the client side (mismatch banner) — unless the guards silently reloaded you before you looked. You reported Match ✓, not mismatch. That's consistent with the guards having already reloaded.
- But it's *also* consistent with you never having loaded v3 in the first place.

## Definitive next test — instrument the client so we can tell A from B

Add lightweight breadcrumbs so a single visit to `/version` after the test tells us exactly what happened. No behavior change; observation only.

### Changes

1. **`src/lib/pwa/register.ts`** — when the registrar acts, record a breadcrumb to `localStorage` under `rpai:pwa-log` (bounded ring buffer, ~20 entries). Log entries at:
   - `registered` (with `__BUILD_ID__`)
   - `drift-detected` (source, serverBuild, currentBuild, streak)
   - `auto-skip-waiting` (buildId that was waiting)
   - `reload` (source: controllerchange / sw-activated-message / bfcache)
   - `bfcache-restore-stale` (serverBuild)

   Each entry: `{ ts, type, ...fields, build: __BUILD_ID__ }`.

2. **`src/routes/version.tsx`** — add a fourth section "Recent PWA activity" that reads `rpai:pwa-log` and renders the entries newest-first with timestamps. Include a "Clear log" button.

3. **Canary bump** — change the label on `/version` to `🟠 Publish canary v5 — breadcrumb test`.

### Verification (internal, before asking you to test)

- Grep the built `register-*.js` for `rpai:pwa-log`, `drift-detected`, `bfcache-restore-stale` — confirm the strings shipped.
- Curl `/api/public/version` on prod, confirm buildId rotated.
- Playwright: load `/version`, confirm the new section renders and shows at least the `registered` entry.

### Your test procedure (after I publish v5 and confirm live)

1. Open app on iPhone, visit `/version` once. It should show canary v5, and the PWA log should contain a `registered` entry with `build: <v5-id>`. Tap "Clear log" to start clean.
2. Navigate to home, background app 90+ seconds.
3. I publish v6 (I'll do this on your signal).
4. Foreground the app, wait ~15 seconds, then open `/version`.
5. Read the PWA log aloud.

### How the log will answer the question definitively

- If you see `drift-detected` → `auto-skip-waiting` → `reload`, guards worked (Scenario A).
- If you see `bfcache-restore-stale` → guards worked via the bfcache path.
- If the log is empty except `registered` with `build: <v6-id>` and no drift entries, Safari fetched v6 on its own before the guards had anything to catch (Scenario B / inconclusive again — but then we know the guards weren't needed).
- If the log shows `drift-detected` repeatedly with no `reload`, the poll is detecting drift but the SW isn't picking up the new script — a real bug we can then fix.

Either way, you'll walk away knowing definitively which mechanism carried the update.

### Files touched

- `src/lib/pwa/register.ts` — add `logBreadcrumb()` helper, call it at the 5 lifecycle points above.
- `src/routes/version.tsx` — add "Recent PWA activity" section + canary v5 label.

No changes to `sw-src.ts`, no behavior changes to the guards themselves. Purely observability.
