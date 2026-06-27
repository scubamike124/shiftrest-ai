# QA Blocker Investigation — Findings & Fix Plan

## BLOCKER 1 — Raw permission error "The request is not allowed by the user agent…"

### Root cause
This is the standard Safari/WebKit `NotAllowedError` string. It is thrown from **two places** that can fire during a Coach session, and in both we currently surface the raw error text via `toast.error(err.message)`.

1. **`VoicePlayer.tsx` → `audio.play()`** (the most likely trigger on /coach and /plan).
   The play button click is a user gesture, but the code performs `await fetch("/api/brief")` **and** `await fetch("/api/tts")` **and** `await blob()` before finally calling `audio.play()`. iOS Safari treats the original gesture as expired after multiple awaits and rejects the play with the exact "not allowed by user agent or platform" message. The catch then runs `toast.error(e.message)` — the raw browser string the user is seeing.

2. **`NotificationsSection.tsx` → `Notification.requestPermission()`**.
   iOS Safari throws the same error when the site is not installed as a Home-Screen PWA, when called from a non-secure context, or when called without a fresh user gesture. The catch surfaces `err.message` verbatim.

Supporting evidence:
- `src/components/VoicePlayer.tsx` line ~167–170: `await audio.play(); … toast.error(e instanceof Error ? e.message : …)`
- `src/components/NotificationsSection.tsx` line ~92–108: `await Notification.requestPermission(); … toast.error(err.message)`
- `src/lib/notify.ts` `requestPermission()` and `showNotification()` do not pre-check capability beyond `"Notification" in window`.

### Fix
Frontend-only. No business-logic change.

1. **VoicePlayer — pre-warm the audio element under the gesture, friendly error**
   - Create/seed `audioRef.current = new Audio()` and call `audio.load()` synchronously at the top of the click handler, before any await. This preserves the gesture token on iOS.
   - After receiving the blob, set `audio.src` and try `audio.play()`; if it rejects, fall back to a visible **"Tap to play"** state instead of toasting raw text.
   - Replace `toast.error(e.message)` with a mapped friendly copy:
     - `NotAllowedError` → "Tap play again to start the briefing — Safari needs a direct tap."
     - `NotSupportedError` → "Your browser can't play this audio format."
     - any other → "Voice briefing is temporarily unavailable."
   - Always `console.error(e)` for diagnostics.

2. **NotificationsSection / notify.ts — detect-before-request + friendly catch**
   - Add a single helper `canRequestNotificationPermission()` that returns `{ ok: false, reason }` for: SSR, no `Notification`, iOS Safari without `standalone`, insecure context, `Notification.permission === "denied"`.
   - In `enableEverything()`, call the helper first and short-circuit to the existing inline iOS / unsupported / denied UI instead of attempting `requestPermission()` at all.
   - Wrap the actual `Notification.requestPermission()` call in try/catch and on any throw show the friendly iOS / unsupported / denied panel + `console.error`, never `err.message` in a toast.
   - Same friendly-mapper used by `lib/notify.ts requestPermission()` so any future caller is safe.

3. **Coach route** — already uses friendly toasts; no change required. Confirms the raw string only originates from the two surfaces above.

### Verification
- Manual on iOS Safari (375×667), iOS Safari standalone (Add to Home Screen), Android Chrome, desktop Chrome, desktop Safari, Firefox.
- Force `Notification.requestPermission` rejection by toggling site permission to Block; confirm friendly panel appears, no raw string.
- Force `audio.play()` rejection by adding an artificial 3s `setTimeout` before play in dev; confirm "Tap to play" fallback appears, no raw string.

---

## BLOCKER 2 — Plan page shows "No shift scheduled today" for a configured account

### Root cause
A **hydration race between Supabase auth and React Query** on `/plan`.

- `fetchShifts()` (`src/lib/shifts.ts`) calls `supabase.auth.getUser()`. If the session has not finished restoring at the moment the query first runs, `userId` is `null` and the function returns `[]`.
- In `src/routes/plan.tsx` the shifts and prefs queries are **not gated** by `signedIn`:
  ```tsx
  const { data: shifts = [] } = useQuery({ queryKey: ["shifts"], queryFn: fetchShifts });
  const { data: prefs = DEFAULT_PREFS } = useQuery({ queryKey: ["prefs"], queryFn: fetchPrefs, initialData: DEFAULT_PREFS });
  ```
  (Employers and wearables ARE gated with `enabled: signedIn === true`.)
- The empty result is cached. When auth eventually resolves and `signedIn` flips to `true`, nothing invalidates `["shifts"]` from this route, so the UI stays on the "No shift" empty state.
- `__root.tsx` does invalidate `["shifts"]` after migrations during the bootstrap, but only when `SIGNED_IN`/`SIGNED_OUT` events fire **after** session restore; on a warm reload where the session is already in storage and no auth event fires, the invalidation path runs once but can still race the first query fetch on `/plan` because `bootstrap()` awaits migrations first.

Database confirms the user is correctly configured:
- profile `scubamike124@gmail.com` exists, `cycle_weeks = 1`, `location_label = "Los Angeles, California"`.
- 2 shifts stored, including `day = 5, week_index = 0` (Saturday). Today (Sat 2026-06-27) maps to weekday 5 → shift SHOULD render.

So data, schedule math (`shiftsForDate`), and timezone handling are all correct. The only failure is the empty `[]` cache from the race.

### Fix
Frontend-only.

1. **Gate the queries on auth in `plan.tsx`** (mirror the pattern already used by employers/wearable):
   ```tsx
   const { data: shifts = [] } = useQuery({
     queryKey: ["shifts"], queryFn: fetchShifts,
     enabled: signedIn === true,
   });
   const { data: prefs = DEFAULT_PREFS } = useQuery({
     queryKey: ["prefs"], queryFn: fetchPrefs,
     initialData: DEFAULT_PREFS,
     enabled: signedIn === true,
   });
   ```
2. **Tighten the empty-state copy** so it only appears once we actually know the user has no shift today (`signedIn === true && shifts.length > 0 && !shift`). For `signedIn === null` or `shifts` still loading, render a small skeleton instead of the "No shift" panel.
3. **Belt-and-suspenders cache invalidation**: in the same `useEffect` that subscribes to `onAuthStateChange`, on `SIGNED_IN` call `queryClient.invalidateQueries({ queryKey: ["shifts"] })` and `["prefs"]` so any stale empty cache from a prior unauthenticated read is dropped. (Root already does this on event firing; we add it to the page for warm-tab navigation correctness.)

No schema changes. No planner-logic changes. No timezone changes.

### Verification
- Hard reload `/plan` while signed in → shift card renders (no flash of "No shift").
- Sign out → friendly "Sign in" panel (existing behavior preserved).
- Sign in from `/plan` → shift card hydrates immediately after auth.
- Toggle days; Saturday shows the existing 09:00–17:00 shift; rest days show "No shift" correctly.
- Add a shift on `/dashboard`, navigate to `/plan` → appears.

---

## Files to change
- `src/components/VoicePlayer.tsx` — gesture-preserving play, friendly catch.
- `src/components/NotificationsSection.tsx` — detect-before-request, friendly catch.
- `src/lib/notify.ts` — `requestPermission()` returns `"unsupported"` on iOS-Safari-no-standalone / denied; never throws.
- `src/routes/plan.tsx` — `enabled: signedIn === true` on shifts/prefs; safer empty-state gating; SIGNED_IN invalidation.

No backend, RLS, schema, or AI-orchestrator changes.

## Regression scope
- Voice playback: still one-tap on Chrome/desktop Safari; iOS gets a clean "Tap to play" fallback instead of a raw error.
- Notifications: enable flow unchanged on supported platforms; iOS Safari users get the existing install-to-home-screen panel instead of a thrown error.
- `/plan`: identical UI when signed in with shifts; eliminates the false-empty state on cold loads.

## Cross-browser test matrix
- Desktop Chrome, Desktop Safari, Desktop Firefox
- iOS Safari (in-browser) and iOS Safari standalone (Add to Home Screen)
- Android Chrome

Ready to implement on approval.
