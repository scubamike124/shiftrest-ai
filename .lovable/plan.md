# Phase E — QA Investigation Report

Investigation-only pass over the Phase D code (`src/routes/companion.tsx`, `src/lib/companion/speak.ts`, `src/lib/voice/useMicRecorder.ts`). No code changed yet. Below are confirmed bugs, suspected issues, and the fix list I'd ship before starting Phase E.

## Confirmed bugs

### 1. Voice status can get stuck on "Voice unavailable"
`speak.ts` only emits `failed` → it is never cleared on its own. In `companion.tsx`:
```ts
else if (detail.status === "ended") {
  setVoiceStatus((s) => (s === "failed" ? s : "idle"));
}
```
Once a single TTS call fails (quota, autoplay block, network blip), the badge reads "Voice unavailable" for the rest of the session — even after the next reply speaks successfully (the `started` event flips it to `speaking`, but if the user never sends another message, it stays stuck).

**Fix:** clear `failed` on any new `started`, on a new user message, and after ~6 s timeout.

### 2. Mic "slide-off to cancel" cancels legitimate taps on mobile
```tsx
onPointerLeave={() => { if (micState === "listening") void cancelMicCapture(); }}
```
On touch devices, `pointerleave` fires whenever the finger moves off the 44×44 button — which happens on almost every real tap-and-hold gesture and on scroll. Result: recordings are silently discarded.

**Fix:** only treat as cancel when pointer moves a meaningful distance away (e.g. >40 px outside the button) *and* the gesture began as a hold (pointerdown timestamp > 250 ms). Or remove pointerleave-cancel entirely and rely on the explicit Cancel chip.

### 3. There is no actual "hold to talk"
The mic is `onClick` (tap-to-toggle). The aria label says "Hold or tap to talk" but no `onPointerDown`/`onPointerUp` exists, so holding then releasing leaves the recorder running until silence auto-stop or another tap. Phase D's hold-to-talk requirement is not met.

**Fix:** add `onPointerDown` → start, `onPointerUp` → stop, with a short threshold so quick taps still behave as toggle.

### 4. Mid-stream speech gap on long replies
The streaming loop speaks the first sentence early, then waits until the entire stream finishes to enqueue the remainder as one big chunk. Long replies sit silent between sentence 1 ending and the stream finishing.

**Fix:** continue scanning for sentence boundaries inside the read loop and `speakQueued()` each new complete sentence as it arrives. Only the trailing fragment is flushed in the `done` branch.

### 5. `speakQueued` only checks quiet hours / prefs at enqueue time
If quiet hours begin (or the user toggles voice replies off) after enqueue but before playback, the queued chunk still plays.

**Fix:** re-check `loadLocalPrefs()` + `inQuietHours()` + `isQuietModeOn()` inside `drainQueue()` before each `playOnce`; drop the item with an `emitStatus("skipped", …)` if gated.

### 6. Replay during an in-flight reply silently does nothing visible
`replayMessage` correctly cancels prior speech via `++lastReqId`, but the replay buttons are hidden whenever `sending` is true, so a user cannot replay an earlier message while a new one streams. Not a crash, but inconsistent with "replay is always available."

**Fix:** show replay on all *prior* assistant messages even while a new one streams; hide only on the actively-streaming message.

## Suspected / lower-confidence

- **Replay button accessibility:** `aria-label="Replay this reply"` is fine; missing `type="button"` (it inherits from the surrounding `<form>` context… actually it isn't inside the form, so OK). No fix needed — flagged for the checklist.
- **`micState === "encoding"`:** very brief; not surfaced in the status badge. Probably fine, but the badge will briefly show the prior state during encode.
- **Sequential queue ordering on rapid prompts:** `beginSpeakTurn()` correctly invalidates prior turns. Confirmed safe by reading `speak.ts`.
- **AudioContext reuse for lip-sync:** `MediaElementSource` is created once per element and tracked in a `WeakSet`. Looks correct; no leak path identified.

## Out of scope for this fix pass (Phase E backlog)

- "Aura speaking" animation polish (pulsing glow, waveform). Avatar already has `breath`/`bob`; we'll layer the speaking visual in Phase E proper.
- Real-device verification on iPhone Safari + Android Chrome (headless sandbox cannot drive Bluetooth/lockscreen). I'll document the manual matrix; user must run it before announce.

## Proposed fix pass (before any Phase E feature work)

Single small PR touching only voice/mic surface:

1. `src/lib/companion/speak.ts` — re-check gates inside `drainQueue` (Bug 5).
2. `src/routes/companion.tsx`:
   - Clear `voiceStatus === "failed"` on new turn / timeout (Bug 1).
   - Implement true hold-to-talk with tap-toggle fallback (Bug 3).
   - Replace naive `onPointerLeave` cancel with distance+time threshold (Bug 2).
   - Continue speaking subsequent sentences during streaming (Bug 4).
   - Show replay on prior assistant messages during streaming (Bug 6).
3. Manual + headless verification:
   - Typecheck.
   - Playwright pass at 390 × 844, 1280 × 1800 — verify mic button states, replay click, quiet-hours toggle suppresses audio.
   - Console clean.

## Readiness assessment

**Not ready for Phase E** until Bugs 1–4 are fixed. Bug 2 in particular silently breaks mobile voice input, which is the centerpiece of the Companion experience. Bugs 5 & 6 are quality issues that should ship in the same pass since they touch the same files.

Estimated scope: ~80 lines across two files, no schema or backend changes, no new dependencies.

**Awaiting approval to proceed with the fix pass above. Phase E feature work starts only after these are merged and re-verified.**
