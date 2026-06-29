# Companion Auth 401 — Root Cause & Fix Plan

## What the error actually is

The string `Unauthorized: No authorization header provided` is thrown in exactly one place: `src/integrations/supabase/auth-middleware.ts` line 34. It fires when a protected `createServerFn` is called from the browser without a `Bearer` token attached.

The Companion route (`/companion`) does **not** call any protected serverFn directly. The culprit is the **DailyBrief** widget it renders:

```
src/routes/companion.tsx  →  <DailyBrief signedIn={signedIn} ... />
src/components/companion/DailyBrief.tsx
  → useServerFn(getAfternoonBrief)   ← .middleware([requireSupabaseAuth])
  → useServerFn(getEveningBrief)     ← .middleware([requireSupabaseAuth])
```

Both calls are gated by `enabled: signedIn`. The race is on **iPhone Safari first-paint**: `signedIn` flips true (set by the auth listener), the query fires immediately, but the `attachSupabaseAuth` client middleware calls `supabase.auth.getSession()` which returns `null` during the brief window where the SDK is still hydrating the session from `localStorage` (or after the Safari "disclaimer" tap when the page was opened pre-auth). No token → no header → 401 → "No authorization header provided" surfaces in the UI/toast. `/api/ai`, `/api/stt`, `/api/tts` all tolerate missing auth (they only gate the budget), so the AI loop itself is **not** the source of this specific error — the brief is.

## Fix (3 small changes, no schema/back-end edits)

### 1. Harden the client bearer attacher
File: `src/integrations/supabase/auth-attacher.ts` (auto-generated — replace its body with the same export so generation-aware tools still find it).

- Call `getSession()`; if it returns no token, wait up to ~600ms for `onAuthStateChange` to fire `INITIAL_SESSION`/`SIGNED_IN`, then try once more.
- If still no token, call `supabase.auth.refreshSession()` as a last resort (works when the refresh token is in storage but the access token expired).
- Emit a `companion:auth-status` event with `{ hasSession, hasToken, userId }` for the HUD.
- Always return `next(...)` — never throw — so unauthenticated calls fail at the server with a clean 401 instead of a network-layer exception.

### 2. Gate the brief queries on a real session, not just `signedIn`
File: `src/components/companion/DailyBrief.tsx`.

- Replace the `signedIn` prop check with `useQuery({ enabled: hasSession && ... })` where `hasSession` is derived from a lightweight `useSession()` hook (one `supabase.auth.getSession()` + `onAuthStateChange` listener, returns `{ session, ready }`).
- Don't fire until `ready === true && session != null`. This eliminates the first-paint race entirely.
- On 401 the query's `onError` shows a soft "Sign in to see your brief" line instead of bubbling the raw error.

### 3. Extend the Debug HUD with auth rows
File: `src/components/companion/DebugHUD.tsx` + `src/lib/companion/debug-bus.ts`.

- Add three rows: `Authenticated` (YES/NO), `User Session` (Present/Missing), `Authorization Header` (Attached/Missing — last attempted call).
- Listen for the new `companion:auth-status` event from the attacher.
- New debug steps in the event log: `auth-ok`, `auth-missing`, `auth-refresh`, `auth-fail` (never logs the token value, only its presence).
- Bump `BUILD_STAMP` so the user can confirm the fresh build is loaded.

## Verification

1. Typecheck.
2. Cold-load `/companion?debug=1` on iPhone Safari signed-in:
   - HUD shows `Authenticated: YES`, `User Session: Present`, `Authorization Header: Attached`.
   - No 401 toast, brief renders.
3. Cold-load `/companion?debug=1` signed-out:
   - HUD shows `Authenticated: NO`, `User Session: Missing`, `Authorization Header: Missing`.
   - Brief silently hides; voice/text loop still works against the public `/api/*` endpoints.
4. Sign out mid-session → HUD flips to NO/Missing on next call; no crash.

## Out of scope (intentionally not touching)

- `/api/ai`, `/api/stt`, `/api/tts`, TTS playback, avatar animation, voice queue — these were fixed last round and are not the source of *this* error.
- Edge functions / DB / RLS — server side is correct; the bug is purely the client failing to attach a token in time.

## Technical notes

- The auto-generated attacher header comment will stay; the patched implementation keeps the same export name so the build still recognizes it.
- No new dependencies.
- `useSession` will live in `src/hooks/use-session.ts` and is reusable anywhere we need to gate on a hydrated session.
