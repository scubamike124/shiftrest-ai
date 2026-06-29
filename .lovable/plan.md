
# Nova Tap + Voice Interaction Fix

## Investigation summary

Three concrete bugs cause "Nova looks alive but doesn't respond":

1. **Landing avatar (`/`) is a dead end on mobile.** `HeroStack` (src/routes/index.tsx ~L188) wraps the big Aura avatar in `<Link to={ctaHref}>` which resolves to `/auth` for signed-out users. Tapping the eye sends you to a login form — no listening state, no greeting, looks broken.
2. **Companion avatar (`/companion`) tap does nothing voice-related.** The button around `CompanionAvatarFace` (src/routes/companion.tsx L790–807) only focuses the composer. It does not start the mic, does not trigger a greeting, and does not show any state change. The mic is only reachable from the small composer mic button (L1044) — discoverability bug + perceived dead tap.
3. **No greeting on entry.** Companion never speaks first. User opens `/companion` and sees a static avatar until they type — exact "feels visually present, not functionally interactive" symptom.

Secondary findings:
- Mic permission is requested correctly inside a gesture in `useMicRecorder.start()`, but `NotAllowedError` only sets internal state — there is no toast/inline message, so a denied permission looks identical to a dead tap.
- Voice-status "failed" pill exists but only renders after a TTS attempt; it doesn't cover mic-denied or STT-failed cases.
- Dashboard `CompanionAvatar` chip is a plain `Link to /companion` — fine, but should land on a `/companion?greet=1` state so the user gets an immediate hello.
- Desktop has the same dead-tap on the big avatar; the bug is not mobile-only, it's just most obvious there.

## Fix plan (interaction layer only — no visual redesign)

### 1. Landing page — make Nova's tap meaningful
`src/routes/index.tsx`
- Change `HeroStack` + `CompanionShowcaseSection` avatar links so the destination is always `/companion?intro=1&greet=1`, regardless of `signedIn`. The `_authenticated` gate will still redirect signed-out users to `/auth`, but with `redirect=/companion?greet=1` so they land in the live experience after login instead of on the dashboard.
- Keep the secondary "Start free" CTA pointing at `ctaHref` for the signup path.

### 2. Companion entry — auto-greeting
`src/routes/companion.tsx`
- On mount, if `search.greet === 1` OR this is the first visit of the session, push an assistant message:  
  `"Hi {firstName}, I'm here. How can I help tonight?"`  
  Use `speakIfEnabled()` so it auto-plays when voice is enabled, and silently no-ops in quiet hours / voice-off (text still visible).
- Guard with a `useRef` so the greeting fires only once per mount.

### 3. Avatar tap = start voice turn (with safe fallback)
`src/routes/companion.tsx` (avatar `<button>` at L790)
- Replace the focus-composer handler with `handleAvatarTap()`:
  - If `micState === "listening"` → `micStop()` (release/send).
  - Else → call `handleMicTap()` to start capture *synchronously inside the gesture* (preserves iOS Safari user-gesture chain — see Lovable stack-overflow note on media gestures).
  - Wrap in try/catch; on any failure call `focusComposer()` and toast `"Voice unavailable — you can type instead."`
- Add `aria-pressed={micState === "listening"}` and a hover/active scale so the tap is visibly acknowledged.

### 4. Mic permission + error surfacing
`src/lib/voice/useMicRecorder.ts` already classifies `NotAllowedError` → `denied`. In `companion.tsx`:
- Watch `micState`. When it flips to `"denied"` show a one-time inline banner above the composer:  
  `"Microphone is blocked. Enable it in browser settings, or just type below."` with a "Dismiss" button.
- When it flips to `"error"` show the recorder's `error` string as a toast and keep the composer focused.
- Pre-flight `navigator.permissions.query({ name: "microphone" })` (wrapped in try/catch for Safari) before first tap so we can show the banner instead of a silent denial loop.

### 5. State indicators (already present — verify wired through)
The avatar already accepts `state={orbState}` covering idle / listening / thinking / speaking. Add the missing ones:
- `muted` → render when `voiceRepliesEnabled === false` (small "Voice off" pill under avatar).
- `error` → render when `voiceStatus === "failed"` OR `micState === "denied" | "error"` (reuse existing amber pill, expand copy).

### 6. Tap-target hygiene
- Ensure the avatar button has `min-h-[88px] min-w-[88px]` hit area and `z-10` so the bottom nav and any preview overlay can't intercept the tap.
- Verify `CompanionDock` and `BottomNav` do not render an invisible overlay over the avatar region (quick `pointer-events` audit on `/companion`).

## Acceptance verification

After the changes, on both desktop and a 390×844 mobile viewport via Playwright:
1. Cold-load `/` → tap the big Aura eye → lands on `/auth?redirect=/companion?greet=1` (signed out) or `/companion?greet=1` (signed in).
2. On `/companion` first paint → greeting message appears, voice plays if enabled.
3. Tap avatar → mic permission prompt fires (first time) → state flips to "listening" → release/tap again → STT → assistant replies → TTS speaks.
4. Deny mic permission → inline banner appears, composer stays usable, user can type and get a reply.
5. Voice replies disabled → avatar shows "Voice off" pill; text reply still works.
6. No console errors. No dead taps. Bottom nav does not block avatar.

## Files touched
- `src/routes/index.tsx` — hero + showcase avatar links
- `src/routes/companion.tsx` — greeting on mount, avatar tap handler, permission banner, muted/error pills
- `src/routes/auth.tsx` — honor `?redirect=` after sign-in (verify, add if missing)
- `src/lib/voice/useMicRecorder.ts` — no API change; only consumed differently

No DB changes, no new dependencies, no UI redesign.
