## Phase 1 — PWA App-Shell Rollout (Investigation)

Goal: cold-start offline launch. Warm-offline snapshot system stays the source of truth for user data; the service worker only serves the app shell when the network is dead.

---

### Critical finding from investigation

`/sw.js` is already in use as the **push-notification service worker** (`public/sw.js`, registered from `src/routes/__root.tsx:163` and `src/lib/notifications/client.ts:54`). The PWA skill's default path also uses `/sw.js`. We cannot ship two workers at the same scope — the second registration replaces the first, and Smart Alarm push notifications would break.

**Decision:** Use `vite-plugin-pwa` in **`injectManifest` mode**, not `generateSW`. We author one combined `public/sw-src.ts` that keeps every existing `push` / `notificationclick` handler verbatim and adds Workbox precache + runtime routes on top. The plugin compiles it to `/sw.js` at the same path, same scope. No migration, no path collision, push keeps working.

This is a documented variation of the skill's offline path (skill says "use `vite-plugin-pwa`" — `injectManifest` is supported by the same plugin); the merge is forced by the pre-existing push worker.

---

### Files that will change

**New**
- `public/sw-src.ts` — combined service worker source: existing push handlers (copied verbatim from `public/sw.js`) + Workbox precache + runtime caching rules.
- `src/lib/pwa/register.ts` — guarded registration wrapper. Single registrar; refuses in dev, iframe, Lovable preview hosts, and `?sw=off`.

**Modified**
- `vite.config.ts` — add `VitePWA({ strategies: "injectManifest", srcDir: "public", filename: "sw-src.ts", injectRegister: null, devOptions: { enabled: false }, registerType: "autoUpdate", ... })`. Build output: `/sw.js` (unchanged path).
- `src/routes/__root.tsx` — replace the inline `navigator.serviceWorker.register("/sw.js")` call (line ~163) with `import { registerAppShell } from "@/lib/pwa/register"` and a single guarded call. Push registration in `src/lib/notifications/client.ts` continues to work because it just calls `getRegistration("/sw.js")` — same file, now serves both purposes.
- `package.json` — add `vite-plugin-pwa` + `workbox-window` + `workbox-precaching` + `workbox-routing` + `workbox-strategies`.

**Deleted**
- `public/sw.js` — replaced by the compiled output of `sw-src.ts`. The build emits the same `/sw.js` URL; returning users get a same-path update, no orphaned registration.

**Untouched**
- Every file in `src/lib/offline/*`, `src/lib/ai/*`, `src/lib/wearables/*`, `src/lib/time/*`, dashboard, Long Clock, Smart Alarm components, snapshot logic, AI client cache, sign-out cache clearing.

---

### Caching strategy

| Surface | Strategy | Why |
|---|---|---|
| Built JS/CSS chunks (hashed, same-origin) | Workbox `precacheAndRoute(self.__WB_MANIFEST)` (precache) | Hashed filenames → safe to cache forever. Enables true cold-start offline. |
| HTML navigations (`/`, `/dashboard`, etc.) | `NetworkFirst`, 3s timeout, falls back to precached `/index.html` shell | Skill requirement: never serve stale HTML. Offline → shell loads, React hydrates, snapshot system fills data. |
| Font files, icons in `public/` | `CacheFirst`, max 30 entries | Static, versioned via filename. |
| `/__l5e/assets-v1/**` (Lovable CDN) | `StaleWhileRevalidate`, max 60 entries, 30d expiry | Immutable per-UUID URLs; safe and fast. |
| Everything matching `/api/**` | **Bypass — never intercept** | AI responses, auth tokens, server-fn payloads must never touch the SW cache. |
| Anything matching `supabase.co`, `/auth/**`, `/api/public/**` | **Bypass — never intercept** | Auth, webhooks, wearable callbacks, Stripe portal. |
| `/~oauth*` | Excluded from navigation fallback | Skill requirement. |

The SW's `fetch` handler has an explicit early-return for any URL whose pathname starts with `/api/` or whose host is not the current origin. Nothing privileged ever lands in `caches`.

---

### Service-worker scope

- Filename: `/sw.js` (unchanged).
- Scope: `/` (unchanged — required for push notifications to reach all routes).
- `clientsClaim()` on activate (unchanged — already in the push worker).
- `skipWaiting()` on install (unchanged).

---

### Registration guards (in `src/lib/pwa/register.ts`)

Refuse to register when ANY is true (skill spec, verbatim):
- `!import.meta.env.PROD`
- `window.self !== window.top` (iframe)
- hostname starts with `id-preview--` or `preview--`
- hostname is/ends with `.lovableproject.com`, `.lovableproject-dev.com`, `.beta.lovable.dev`
- `URLSearchParams(location.search).get("sw") === "off"`

In any refused context, call `getRegistration("/sw.js").then(r => r?.unregister())` first so stale dev/preview registrations are cleared. Then return without registering.

This means: in the Lovable editor preview (where you're testing now) the SW does **not** register — warm-offline behavior is unchanged. The SW only activates on the published `*.lovable.app` (and custom domains).

---

### Install-prompt behavior

**No install prompt UI in Phase 1.** Out of scope. Manifest already has `display: "standalone"` so the browser's native "Add to Home Screen" continues to work as-is. We can add a custom `beforeinstallprompt` UI in a later phase if you want it.

---

### Update strategy

- `registerType: "autoUpdate"` — Workbox checks for a new SW on every navigation. New version installs in the background, then on next nav the page reloads transparently to pick up new chunks.
- No update toast / "refresh now" banner in Phase 1 (additive UX, defer).
- Hashed chunk filenames + `NetworkFirst` HTML means returning users never see the white-screen-after-deploy problem.
- **Kill switch:** any user can append `?sw=off` to unregister immediately. Documented for support.
- **Reversibility:** if we need to nuke the rollout, replace `public/sw-src.ts` with the skill's kill-switch worker template (compiles to same `/sw.js`), ship one release, every browser evicts the registration on next visit. Push handlers stay intact in that kill-switch via the same merge pattern.

---

### Risks and mitigations

| Risk | Mitigation |
|---|---|
| **Push notifications break** (Smart Alarm) — most critical risk | `injectManifest` keeps the existing push handlers byte-for-byte; we'll diff `sw-src.ts` push code against current `public/sw.js` before merge. Add a manual QA step: trigger a test push after deploy. |
| Stale HTML shipped after a deploy | `NetworkFirst` on navigations + `autoUpdate` + hashed chunks. |
| SW registers in Lovable preview and caches stale chunks | Hard guard list in `register.ts`; unregister-on-refuse path covers any historic registration. |
| `/api/ai` response gets cached → user sees yesterday's plan | Explicit bypass at top of `fetch` handler; runtime caching rules are origin+path scoped and exclude `/api/`. AI snapshot cache stays in `localStorage` per `ai-client.ts`, unchanged. |
| Auth token leaks into Cache Storage | We never cache Supabase origin, `/api/**`, or `/auth/**`. Verified in code review checklist. |
| Snapshot system collides with SW caching | They live in different layers: SW caches the **app shell** (HTML/JS/CSS/assets), snapshot caches **user data** in `localStorage`. The dashboard's existing `getCachedUserIdSync` → `hydrateQueryCacheFromSnapshot` path runs after React boots, exactly as today. |
| Service-worker bug bricks the app | `?sw=off` kill switch + same-path replacement worker pattern. |

---

### How existing offline snapshot logic integrates

Boot order on a cold offline launch (after Phase 1):

```text
1. Browser requests / → SW NetworkFirst fails fast → serves precached index.html
2. SW serves precached JS/CSS chunks → React hydrates
3. Dashboard mounts → useState initializer calls getCachedUserIdSync()
   → hydrateQueryCacheFromSnapshot() (sync, from localStorage)
4. useQuery for shifts/employers/prefs sees cached data → renders Long Clock,
   Smart Alarm, recommendations
5. AI cards call postIntent() → offline branch in ai-client.ts replays last
   cached JSON from localStorage (per-intent key)
6. OfflineBanner shows "Offline mode active. Using your last saved plan."
```

The SW is purely additive to the existing snapshot system. It solves step 1–2 (which today require network). Steps 3–6 already work and are not touched.

---

### Production-readiness gates (must pass before declaring done)

1. Typecheck clean.
2. Build produces `dist/sw.js` containing both the push handlers and Workbox precache manifest. Manual diff of push section vs current `public/sw.js`.
3. Manual QA on published URL:
   - First load online → reload offline → app shell loads, dashboard renders snapshot, Long Clock + Smart Alarm visible, banner showing.
   - Reconnect → snapshot reconcile + tz-aware toast still fires.
   - Trigger Smart Alarm test push → notification fires.
   - Sign out → cache cleared, sign in as another user → no leak.
4. Lovable editor preview: confirm SW does NOT register (DevTools → Application → Service Workers shows empty).
5. `?sw=off` on published site unregisters and reloads cleanly.

If any gate fails, the rollout is reversed by reverting the three changed files; the kill-switch worker pattern is on standby if registrations are already in the wild.

---

Awaiting approval before writing code.