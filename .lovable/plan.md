# AI Coach Brief — "Missing authorization" investigation

## What I verified in production

- **Live build ID rotated**: `/api/public/version` on restpilotai.com now returns `b-1783018674243` (built 2026-07-02T18:57:54Z). The publish took.
- **Deployed dashboard bundle contains the fix**: `assets/dashboard-BvzlqB-P.js` on restpilotai.com contains BOTH:
  - `access_token` (session read)
  - `Authorization:\`Bearer ${n}\`` (header attached to `/api/insights`)
  - `Sign in to load your brief` (the friendly 401 message)
- **Only one component owns "AI Coach Brief"**: `src/components/AIBriefCard.tsx`, mounted only from `src/routes/dashboard.tsx` (line 329). No duplicate/legacy copy exists in the tree (`rg AIBriefCard` returns just those two files).
- **Only one caller of `/api/insights`**: `AIBriefCard.tsx` (line 58). It correctly reads `supabase.auth.getSession()`, aborts if no token, and only fires when `hasSession === true`.
- **Only one server-side origin of the exact string "Missing authorization"**: `src/lib/api/auth.server.ts:40`, returned as `401 { error: "Missing authorization" }`. `AIBriefCard` never surfaces that string — for any 401 it throws `"Sign in to load your brief"` (line 68).

So the fixed code IS live at restpilotai.com, and if the fixed code executes, the card can only show "Sign in to load your brief.", never "Missing authorization".

## Root cause

The user's device is still running the pre-fix `AIBriefCard` bundle out of the **PWA service-worker precache**.

- `public/sw-src.ts` uses `precacheAndRoute(self.__WB_MANIFEST)` with `skipWaiting()` + `clientsClaim()`, but hashed JS chunks are served **CacheFirst from the precache**. When a returning user opens the app, Workbox activates the new SW in the background — but **the current page keeps running with the previously-cached `dashboard-*.js` chunk until a full reload**. The old chunk still calls `fetch("/api/insights")` with no `Authorization` header → server correctly returns `401 { error: "Missing authorization" }` → the old error branch renders `e.error` verbatim → user sees "Missing authorization".
- This matches the symptom exactly: happens right after "opening the latest published link and completing onboarding" (first visit under new SW, page not yet reloaded).
- Onboarding/name entry does not reset the Supabase session; that is a red herring. The bearer would attach correctly under the new bundle.

Evidence supporting this over a code bug:
1. Production bundle at the current hash contains the fix (verified via `curl | grep`).
2. There is no code path in the fixed `AIBriefCard` that can render the raw "Missing authorization" text.
3. `src/lib/pwa/register.ts` shows the app already has an update-then-reload flow, confirming the "old chunk keeps running until reload" model.

## Exact file causing the remaining issue

Not a source-code bug in `AIBriefCard.tsx` — the file is correct. The failure is in **service-worker upgrade behavior** defined in `public/sw-src.ts`. Users on the previous SW keep executing the previous precached `dashboard-*.js` until the app forces a reload.

## Smallest safe fix

Two-line change, no behavior change to the AI code:

1. **Bump the SW cache identity** so the new SW invalidates the old precache immediately on activation, and the client-side updater triggers a reload prompt.
   - In `public/sw-src.ts`, add/bump a `CACHE_VERSION` constant embedded in the SW build (the file already reads `__BUILD_ID__`). Confirm `cleanupOutdatedCaches()` runs on `activate` (it is imported; verify it is called) so the stale precache is deleted before the next navigation.
2. **Force one hard client reload on SW `controllerchange`** in `src/lib/pwa/register.ts` (guarded by a sessionStorage flag to avoid loops). This guarantees users on the pre-fix bundle drop it within one navigation instead of "eventually".

Nothing in `AIBriefCard.tsx`, `/api/insights`, or auth changes.

## Verification steps after the fix

1. `bunx tsgo` — type-check clean.
2. Publish; confirm `/api/public/version` returns a new build id.
3. On a device that previously saw "Missing authorization":
   - Open restpilotai.com. New SW installs, controllerchange fires, page reloads once.
   - Sign in / complete onboarding.
   - Open Home (Dashboard). AI Coach Brief must render normally, or show "Sign in to load your brief." if the session hasn't hydrated — never the raw "Missing authorization".
4. DevTools → Network → `/api/insights` request must include `Authorization: Bearer …` and return 200.

## Out of scope (will not touch)

- `/api/insights` server code
- `AIBriefCard.tsx` logic
- Any other endpoints, UI, or unrelated components

Awaiting approval before implementing.
