# Voice Stutter Fix — Rollback + Targeted Repair (post 2026-06-29T21:10Z)

## Diagnosis

Reading `src/lib/companion/speak.ts` and `src/routes/api/tts-elevenlabs.ts`, three things changed in the 21:10Z build that together produce the "few words → 1-2s pause → continue, and too slow" behavior on iPhone Safari:

1. **ElevenLabs is the default for users who toggled it on** and the route requests `mp3_44100_128` from the upstream `text-to-speech` (non-streaming) endpoint. We then call `resp.blob()` client-side, which forces the full MP3 to buffer before playback starts. On cellular/iOS Safari that's the 1-2 s gap between each sentence chunk.
2. **`speed: 0.96` (normal) / `0.88` (sleep)** in `tts-elevenlabs.ts` plus the "Calm" prosody preset is noticeably slower than the previous OpenAI path.
3. **Per-chunk warm-up**: `warmOutputDevice()` (~40 ms silent buffer) + `ensureContextRunning()` now run before *every* `playOnce`, not just the first. Combined with the sentence-queue splitting, each chunk adds device-warm latency, so the listener hears: word word word — gap — word word.
4. The session-level `elevenLabsBlocked` fallback only trips on HTTP failure, not on stall/timeout, so a slow first byte never demotes the provider.

Headless Chromium did not catch this because Chromium starts MP3 decode the moment bytes arrive; iOS Safari waits for a usable buffer window.

## Fix (do these in one pass, ship behind the existing toggle)

### A. Restore the stable voice path by default
- In `src/lib/companion/renderer-pref.ts`, keep `"elevenlabs"` selectable but treat it as **beta/opt-in only**. No code change to the default (already `"openai"`), but add a `VITE_COMPANION_ELEVENLABS=off` runtime kill switch read in `speak.ts` — when off, ignore stored `getTtsProvider()` and force OpenAI. This is the rollback rule satisfied without deleting the integration.
- Update the Settings copy in `src/routes/settings.companion.tsx` to label ElevenLabs as "Experimental — may stutter on iPhone" so users know what they're opting into.

### B. Stop the per-chunk stall
In `src/lib/companion/speak.ts`:
- Track a module-level `outputWarmed` boolean. Run `warmOutputDevice()` only on the first `playOnce` of a session (or after `audioUnlocked` flips). Subsequent chunks skip it.
- Move `ensureContextRunning()` outside the per-chunk path; it only needs to run when `levelCtx.state !== "running"`.
- Start `audio.play()` as soon as `canplay` fires (not after awaiting the blob fully when streaming is available). For ElevenLabs specifically, switch from `resp.blob()` + `URL.createObjectURL` to a `MediaSource` / direct streaming `Response.body` → `Audio` via `URL.createObjectURL(response)` is not viable; instead, set `audio.src` to a server endpoint URL and let the browser stream the MP3 natively (route already returns `Content-Type: audio/mpeg`).

### C. Restore conversational pace
- In `src/routes/api/tts-elevenlabs.ts`: `speed: 1.0` normal, `0.92` sleep (was 0.96 / 0.88). Lower `style` to `0.35` normal so prosody isn't overly languid.
- In `src/lib/voice/profile.ts`: revert the "Calm" preset's "unhurried" / "tiny natural micro-pauses" wording to the previous shorter prompt; over-prompting OpenAI TTS for breaths is what stretches phrasing.

### D. Stall-aware fallback
- In `playOnce`, race the `fetch` against a 2.5 s first-byte timeout. If ElevenLabs doesn't return headers in time, abort, set `elevenLabsBlocked = true`, and retry against `/api/tts`. Same for `audio.onstalled` / `onwaiting` firing twice within one utterance.

### E. Keep the greeting volume fix
- Leave the `WaveShaperNode` soft-clip + 40 ms pre-roll in place, but only for the **first** utterance (gated by `outputWarmed`). This is the change that solved the quiet greeting and it does not need to run again.

### F. Verify
- Bump `BUILD_STAMP` to `2026-06-29T22:30Z`.
- Headless Chromium: confirm OpenAI is selected when the env flag is off; confirm `warmOutputDevice` is called once per session.
- Manual: ask the user to retest the greeting + a 3-sentence reply on iPhone Safari and report whether the gaps are gone. If ElevenLabs still stutters after C, the env flag stays `off` until we wire true streaming.

## Files touched

- `src/lib/companion/speak.ts` — kill switch, one-shot warm-up, stall-aware fallback, BUILD_STAMP
- `src/lib/companion/renderer-pref.ts` — read env flag
- `src/routes/api/tts-elevenlabs.ts` — speed/style
- `src/lib/voice/profile.ts` — trim Calm preset
- `src/routes/settings.companion.tsx` — beta label

No DB changes. No new dependencies. ElevenLabs code is preserved behind the flag for future debugging.
