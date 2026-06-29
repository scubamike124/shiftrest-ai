## Investigation so far

The code changes from the last turn are present in source:

- `src/routes/companion.tsx`
  - line ~303 — `voiceStatus` reset on mount
  - line ~309 — 2.5s "stuck speaking" watchdog
  - line ~284 — greeting now renders text only (no autoplay)
  - line ~386 — transcript auto-submits to `handleSend`
  - line ~531 — `companionOn` gate removed from `handleSend`
- `src/components/companion/Avatar.tsx`
  - line ~94 — 3–8s blink loop with 20% double blink
  - line ~219 — inner ring dimmed
  - line ~306 — listening warmth moved to jaw (y:72%), not the eyes

Typecheck is clean. So the most likely reason "nothing changed" is **not the code** — it is one of:

1. The published site `shift-rest-ai.lovable.app` was never re-published after the fix. Frontend changes only go live when you press **Publish → Update**. The preview URL `id-preview--…lovable.app` is what received the fix.
2. iPhone Safari is serving the cached PWA shell (we ship a service worker + manifest).
3. The user is opening the dashboard avatar route, not `/companion`, so a different surface is being tested.

I am not going to guess a code fix again. I will ship a **visible Debug HUD** so the next tap on the real device tells us exactly where the pipeline stops.

## What I will build

### 1. On-screen Debug HUD on `/companion`

A small fixed panel pinned to the bottom-left of the Companion screen, only visible when **any** of these is true:
- URL has `?debug=1`
- `localStorage.companion_debug === "1"`
- a `Cmd/Ctrl+Shift+D` keystroke toggles it on

The HUD shows live values:

```
build       2026-06-29 04:24 · sha <short>
route       /companion
signedIn    true
companionOn false
prefsLoaded true
micPerm     granted | prompt | denied
micState    idle | requesting | listening | encoding
voiceStatus idle | speaking | failed
orbState    idle | listening | thinking | speaking
audioLevel  0.00 (decays)
ttsCtx      suspended | running
greetShown  yes
lastTap     <ms ago>
transcript  "<last text>" (len)
aiReq       sent / pending / failed
aiResp      streaming / done / failed
ttsStart    yes/no   ttsErr  <kind>
playback    ok / blocked / ended
```

Each row updates from the same events the app already emits:
- `companion:voice-status` (started / ended / failed / skipped)
- `companion:audio-level` (rms)
- new lightweight `companion:debug` event the page dispatches at each pipeline step (tap, mic-start, mic-stop, stt-req, stt-ok, ai-req, ai-first-token, ai-done, tts-req, tts-play, tts-end, tts-fail)

This is the single source of truth the user can screenshot from their iPhone and send back.

### 2. Build-stamp banner

A one-line `BUILD <ISO timestamp>` shown at the very top of the HUD. If the iPhone keeps showing an old timestamp after publish, we have proven it's a cache problem, not a code problem.

### 3. Service-worker / cache cache-busting for `/companion`

Add `<meta http-equiv="Cache-Control" content="no-store" />` only on the `/companion` route head, and ensure the service worker (if registered) does **not** cache that route's HTML shell. This makes future fixes appear on the next visit without a hard reload.

### 4. iOS audio unlock on first tap (defensive)

In `handleMicTap` we already call `prepareVoicePlayback()`. I will also create-and-resume a single shared `AudioContext` synchronously inside the same tap handler (before any `await`), and play a 1-frame silent buffer. This is the documented iOS Safari pattern for letting later TTS audio play without a user gesture. If TTS still fails afterward, the HUD will say `playback blocked` instead of `ttsStart yes`, which tells us exactly that.

### 5. Hard reset button in the HUD

A "Reset Nova" button that:
- calls `stopSpeaking()`
- forces `voiceStatus = "idle"`, `orbState = "idle"`
- aborts any in-flight `/api/ai` request
- clears `messages`

Lets the user un-stick the avatar without reloading.

## Files I will touch

- `src/lib/companion/debug-bus.ts` *(new)* — typed `emit(step, payload)` + subscribe.
- `src/components/companion/DebugHUD.tsx` *(new)* — the panel above.
- `src/routes/companion.tsx` — mount `<DebugHUD />`, emit debug events at each pipeline step, add iOS audio unlock in the tap handler, add Reset button wiring.
- `src/lib/companion/speak.ts` — emit `tts-req / tts-play / tts-end / tts-fail` debug events alongside existing `companion:voice-status`.
- `src/lib/voice/useMicRecorder.ts` — emit `mic-start / mic-stop / mic-error` debug events; expose permission state.
- `src/routes/__root.tsx` *(tiny)* — add a build-time `BUILD_STAMP` constant injected via Vite `define`, used by the HUD.

## What this does NOT change

- No new animation work on the avatar until the HUD tells us blink/eye is actually broken on the device (the current code already moved the glow off the eyes and randomized the blink — if the user still sees the old behavior, the HUD timestamp will prove the build is stale, not the code).
- No new TTS provider, no API changes.

## After you approve

I will implement steps 1–5, run typecheck, and give you back:
- the preview URL with `?debug=1` appended
- a one-line instruction to publish so the published site picks up the fix
- a short list of what to screenshot from the iPhone so we can read the HUD values together

That screenshot will end the guessing.