# Service-Worker Cache Busting & Auto-Update

## What we found

Most of what you asked for is already implemented in `public/sw-src.ts` and `vite.config.ts`. The remaining gap is the one that actually causes your "old shell doesn't know about new routes" 404 on iPhone.

| You asked for | Status today |
|---|---|
| 1. Bump SW cache version per deploy | ✅ Workbox `__WB_MANIFEST` hashes every asset; `cleanupOutdatedCaches()` already runs |
| 2. Auto-invalidate old route manifests | ✅ `registerType: "autoUpdate"` + `cleanupOutdatedCaches()` |
| 3. Force newest SW to activate immediately | ⚠️ `skipWaiting()`/`clientsClaim()` are set, but iOS often skips the SW script revalidation entirely, so the new worker is never even discovered until the user hard-refreshes |
| 4. "Update Available" banner | ❌ Not implemented |
| 5. New routes available immediately | ⚠️ Works *if* the new SW is discovered; today it can take a stale visit before iOS checks |
| 6. Every publish invalidates manifests | ✅ Same as #1/#2 |

**Root cause of the 404 you hit:** the cached app-shell `index.html` was served by the old SW, which still pointed at the old JS route-tree bundle. That old bundle had no route at `/lab/avatar-poc/simli`, so the SPA rendered its in-app 404 even though the server-side route was live. Private Safari (no SW) loads it fine — which is exactly what your test will confirm.

## What we'll change

Three small additions, scoped to the SW path. No edits to Simli, avatar, or app logic.

### 1. Force SW script revalidation on every navigation
Set `updateViaCache: "none"` when registering `/sw.js`. iOS Safari otherwise caches the SW script itself for up to 24h, which delays discovery of every new deploy.
- File: `src/lib/pwa/register.ts` — add the option to the existing `navigator.serviceWorker.register("/sw.js", { scope: "/" })` call.

### 2. Proactively check for updates
After registration, call `reg.update()` on:
- initial load (after a short delay so it doesn't compete with hydration)
- every `visibilitychange` to `visible` (returning to the tab/app after backgrounding)
- File: `src/lib/pwa/register.ts` only.

### 3. One-tap "Update available" banner
A tiny client component listens for `reg.waiting` / `updatefound` and renders a bottom-right pill when a new SW is installed and ready:

```text
┌──────────────────────────────┐
│  New version ready  · Update │
└──────────────────────────────┘
```
Tapping it posts `{ type: "SKIP_WAITING" }` to the waiting worker and reloads once `controllerchange` fires.
- New file: `src/components/pwa/UpdateBanner.tsx`
- New file: `src/lib/pwa/update-channel.ts` — small event bus the registrar publishes to
- Mount once in `src/routes/__root.tsx`
- SW side: add a `message` listener in `public/sw-src.ts` that calls `self.skipWaiting()` on `SKIP_WAITING` (cheap, additive — `skipWaiting()` already runs on install, this just covers the case where the user previously dismissed the banner)

### Out of scope (intentionally)
- No edits to the Simli POC, avatar pipeline, or any feature route.
- No changes to the push-notification handlers in `sw-src.ts`.
- No removal of `vite-plugin-pwa`, no kill-switch worker — the current PWA is healthy, just slow to discover updates on iOS.

## How we verify

After the changes land and you publish:

1. **Open in Private Safari** on iPhone → `https://shift-rest-ai.lovable.app/lab/avatar-poc/simli` → should load the Connect/Speak screen. This is the "is the deploy itself healthy?" baseline you're already planning to run.
2. **Open in normal Safari** (the one with the stuck SW) → should load the cached shell once, then show the "Update available" banner within ~1s, tap it, page reloads, Simli POC loads. No "Clear Website Data" needed.
3. Subsequent publishes: same banner appears within seconds of opening the app — no manual cache action ever again.

## Production URL (unchanged)

`https://shift-rest-ai.lovable.app/lab/avatar-poc/simli`

The picker is at `https://shift-rest-ai.lovable.app/lab/avatar-poc`.

## Technical notes (for reference, skip if not relevant)

- `updateViaCache: "none"` is the spec-defined way to force the browser to revalidate the SW script on every check; without it iOS uses the HTTP cache (up to 24h).
- `reg.update()` on `visibilitychange` is the standard pattern for installed PWAs that may stay backgrounded for days.
- The banner is gated on `import.meta.env.PROD` and the same refuse-list as `registerAppShell()`, so it never renders in Lovable preview or dev.
- No changes to manifest fields (`start_url`, `id`, `scope`, `display`) — those are install-time sticky on iOS and changing them would require reinstall.
