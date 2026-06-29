
# Investigation — AI Companion Voice & Animation (Launch Blocker)

No code changed yet. This document traces the full pipeline, names the exact root causes, and lists the proposed fixes for your approval.

---

## Issue 1 — AI never responds after listening

### Pipeline trace (what actually happens today)

```text
Avatar tap
  → handleMicPointerDown / handleMicClick      (src/routes/companion.tsx ~388–422)
  → handleMicTap                                (companion.tsx ~317)
      • prepareVoicePlayback()  ✔ primes iOS audio in the gesture
      • setInput("")            ✔
      • micStart(onAutoStop)                   (src/lib/voice/useMicRecorder.ts)
          – getUserMedia ✔
          – AudioContext + ScriptProcessor ✔
          – state → "listening" ✔   ◀── user sees "Listening"
  → user speaks; chunks pushed ✔
  → auto-stop on trailing silence ✔
      – finalize() returns WAV blob
      – onAutoStop(blob) fires
          • POST /api/stt with bearer ✔
          • setInput(text) ✔                   ◀── transcript lands in composer
          • handleSend(undefined, text)        ◀── ❌ silently returns here
```

`handleSend` (companion.tsx ~504) has this guard at the top:

```ts
if (!text || sending || !companionOn) return;
```

`companionOn = prefs?.assistantMode === "companion"`. Two ways this is false at the moment the voice callback fires:

1. **`assistantMode` is still `"coach"`** for the user. The settings sheet ships a toggle but nothing flips it on by default — many test accounts have never enabled it. Result: every tap and every voice turn silently no-ops. The mic returns, the transcript is shown, no API call is ever made, no error is surfaced.
2. **Prefs haven't finished loading** yet. `prefsQ` is `enabled: signedIn === true` and runs after the auth round-trip. If the user taps Nova before that resolves, `prefs` is `undefined` ⇒ `companionOn === false` ⇒ the same silent return.

That's the dead-end. The greeting effect has the same guard, which is why some sessions also show no greeting line — they're the ones where `companionOn` is false.

### Secondary failure modes also present in this code path

- **Stale closure in the auto-stop callback.** `handleMicTap` and `handleSend` are recreated on every render. The callback handed to `micStart` is the one from the render in which the user tapped, and it captures the `handleSend` / `messages` / `prefs` from that render. Long enough turns + state churn (greeting added, voiceStatus event) can fire `handleSend` against a stale `messages` snapshot, dropping the user line from the rendered history even when the network call succeeds.
- **Intent router can swallow a turn without speaking.** When `localPrefs.actionSuggestionsEnabled` is true and `parseIntent` returns confidence ≥ 0.6, `proposeAction` is called and `handleSend` returns. The action card renders silently — no AI text, no narration unless the user taps Confirm. To a first-time user this also reads as "Nova went quiet."
- **/api/ai failure surfaces only as a toast.** If `resp.ok` is false the assistant turn appends a fallback line, but the toast can be missed on mobile and there's no in-thread "tap to retry."

### Files involved

- `src/routes/companion.tsx` (handleMicTap, handleSend, greeting effect, intent routing block)
- `src/lib/voice/useMicRecorder.ts` (correct; not the cause)
- `src/lib/companion/speak.ts` (correct; not the cause)

### Root cause (Issue 1)

The voice loop is gated by `companionOn`, which is false whenever the user hasn't manually flipped Companion Mode on or whenever prefs haven't loaded yet. The callback path silently returns instead of completing the turn or telling the user why.

---

## Issue 2 — Eyes glow and Nova gets stuck in Listening/Speaking

### Animation state trace

`orbState` is derived in one effect (companion.tsx ~264):

```text
if (micState === "listening")              → "listening"
else if (voiceStatus === "speaking")       → "speaking"
else if (transcribing || sending)          → "thinking"
else                                       → "idle"
```

`voiceStatus` listens for `companion:voice-status` events emitted by `speak.ts` — `"started" | "ended" | "failed" | "skipped"`.

The avatar (`src/components/companion/Avatar.tsx`) reacts to `state`:

- **Listening overlay** (lines 300–309): a radial gradient centred at `50% 32%` with `hsl(var(--primary) / 0.18)`. The eyes on the portrait sit at `y ≈ 33.5%`. The gradient peak lands almost exactly on the irises → the eyes visibly brighten / glow.
- **Inner-ring glow** (lines 213–227): `inset 0 0 20px primary` while listening, `inset 0 0 24px cyan` while speaking. Combined with the catchlight gradient this reads as "glowing face."
- **Blink loop** runs as a self-rescheduling `setTimeout` chain. There is no bug in the loop itself — it continues during listening and speaking — but the bright overlay drowns out the eyelid motion, so users perceive "she stopped blinking."

### Why the state gets stuck

There are three independent ways `orbState` fails to return to `idle`:

1. **Greeting speech with no user gesture.** On mount the greeting calls `speak(opener)`. iOS/Safari and many desktop browsers refuse autoplay before a gesture. `speak.ts` emits `"started"` optimistically; the `<audio>` element's `play()` rejects. Depending on the path, `"ended"` may never fire ⇒ `voiceStatus` is stuck at `"speaking"` ⇒ `orbState === "speaking"` forever ⇒ the cyan inner-ring glow stays on the avatar from the moment the page loads.
2. **Speaking → Idle on streamed replies.** `speakQueued` enqueues chunks per sentence. If any chunk fails mid-queue the queue can drain to empty without emitting a final `"ended"` for the turn the UI is observing (only the chunk's `"ended"`/`"failed"` events bubble; there is no per-turn close event). When the failed chunk is the last one the UI sees `"failed"` and the 6 s timer resets to idle — but if a later chunk's `"started"` lands after the timer, the badge re-arms with no matching `"ended"`.
3. **No mount-time reset.** `voiceStatus` starts at `"idle"` but is updated only by incoming events. Navigating back to `/companion` after a prior failed turn can land with a stale `"speaking"` state in some HMR/back-nav cases because the listener is mounted on the new instance while `speak.ts`'s module state still holds a non-finalized audio element. There's no `useEffect` that forces `voiceStatus = "idle"` on (re)mount.

### Files involved

- `src/components/companion/Avatar.tsx` — listening overlay placement + glow intensity, eyelid colour, mouth blur
- `src/routes/companion.tsx` — `voiceStatus` reducer, greeting effect, orb-state derivation
- `src/lib/companion/speak.ts` — per-turn lifecycle events, autoplay handling

### Root cause (Issue 2)

Two things compound:
- **The "glow" is a real visual** — the listening radial gradient is centred on the eyes and the inner-ring shadow lights the face. It looks alarming because the gradient peak intersects the iris row of the portrait.
- **The "stuck" feeling** — `voiceStatus` is driven by chunk-level `started/ended/failed` events with no per-turn close and no remount reset, so a single skipped `"ended"` (very common when greeting autoplay is blocked) leaves the avatar speaking-glowing forever.

---

## Why these issues showed up together

The greeting auto-`speak()` is the common thread. It fails silently on first load, freezing `voiceStatus = "speaking"`. The user taps Nova; mic starts; transcript returns; `handleSend` silently returns because `companionOn` is false. Mic goes idle but `voiceStatus` is still `"speaking"`, so the avatar stays glowing. Nothing happens. They reload, repeat.

---

## Recommended Fix (for approval — not yet implemented)

### Voice loop (Issue 1)

1. Remove the `companionOn` gate from `handleSend` and the greeting effect. Either default `assistantMode` to `"companion"` for new sessions or treat the toggle purely as a tone hint, never as a kill switch for replies.
2. Guard against the prefs-not-loaded race: wait for `prefsQ.isSuccess || prefsQ.isError` before allowing voice/text turns, and show a one-line "warming up…" instead of a silent tap.
3. Replace stale-closure reads in the mic auto-stop callback with `useRef` snapshots of `messages`, `prefs`, and the current `handleSend` so the captured callback always operates on the latest state.
4. When the intent router proposes an action, also push a brief assistant text line ("I can do that — confirm below?") and speak it, so the user never perceives silence.
5. On `/api/ai` failure, render an inline "Tap to retry" affordance under the failed assistant bubble in addition to the toast.

### Avatar state (Issue 2)

1. Move the listening overlay off the eye row: lower the gradient centre to `~60% y` (chin/jaw) and drop opacity from `0.18` to `~0.08`. Result: attentive warmth, no eye glow.
2. Cap the inner-ring `boxShadow` opacity for listening to `~0.18` and for speaking to `~0.22`. Keep blink/breath as the primary "alive" signals.
3. Don't auto-`speak()` the greeting before a user gesture. Render the greeting text immediately; defer voice playback to the first tap (the same tap that primes iOS audio). Eliminates the stuck-speaking root cause.
4. Add a per-turn close event in `speak.ts` (`beginSpeakTurn` opens it, queue-drain or any failure closes it) and reset `voiceStatus` to `"idle"` on companion route mount. Guarantees the avatar can't get wedged in a speaking state.
5. Add a 4 s safety watchdog: if `voiceStatus === "speaking"` and no `companion:audio-level` event arrived in the last 2 s, force `"idle"`. Belt-and-braces for any future regressions.
6. Slow blink jitter to 3–8 s with a 1-in-5 double-blink (you asked for this explicitly).

### Out-of-scope but worth doing in the same pass

- Add a `voice_turn_completed` analytics event so we can measure end-to-end success in production.
- Add a Playwright smoke test that signs in, taps Nova, posts a fake transcript, and asserts an assistant bubble appears within 5 s.

---

## What I need from you

Approve this investigation and I'll implement the fixes above in one focused pass on `src/routes/companion.tsx`, `src/components/companion/Avatar.tsx`, and `src/lib/companion/speak.ts`. No other files will be touched.
