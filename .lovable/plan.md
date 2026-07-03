## Investigation Results

### Issue 1 — Remaining voice pauses

**Root cause: serial fetch → play pipeline in `drainQueue()`**

In `src/lib/companion/speak.ts`, `drainQueue()` awaits `playOnce()` for chunk N before starting chunk N+1. Inside `playOnce()`, the TTS network fetch (`/api/tts`) happens first, then playback starts. That means while chunk N's audio is playing, chunk N+1 has not begun fetching. Every chunk boundary pays the full OpenAI TTS round-trip (typically 300–800 ms), which the user hears as a pause between sentences.

Contributing factors (not root cause, safe to leave alone):
- The 220-char first-flush gate delays only the first chunk, not the inter-chunk gaps the user is describing.
- No-greeting / reasoning prompt changes affect *content* but do not add pauses on their own; the audible pauses line up with chunk boundaries, not clause boundaries inside a chunk.
- Punctuation/sentence splitting in `companion.tsx` (lines 879–915) is fine — chunks are reasonable sentence-sized units.

**Files involved**
- `src/lib/companion/speak.ts` — `drainQueue()` and `playOnce()`.

**Smallest safe fix (pipeline the fetch, keep playback serial)**

Split `playOnce()` into two phases: `fetchTts(text, opts)` returns a `Promise<Blob>`, `playBlob(blob, ...)` handles the audio wiring/playback. `drainQueue()` keeps a single `nextBlobPromise` — as soon as chunk N starts playing, it kicks off `fetchTts` for chunk N+1. Playback stays strictly ordered; only the network fetch overlaps. Cache, fallback, `stillValid()` gating, and `ensureAudioGraph()` behavior are preserved verbatim.

No changes to the 220-char gate, prompts, providers, or ElevenLabs paths.

### Issue 2 — Repeated microphone permission prompt after sign-in

**Root cause: mic permission is browser-scoped, not app-scoped, but we never check `navigator.permissions` before calling `getUserMedia()`**

`src/lib/voice/useMicRecorder.ts` only calls `getUserMedia()` from `start()`, which fires on the user's tap-to-talk gesture (correct — we do not request on page load or sign-in). However:

- On sign-out we navigate away from `/companion`; the hook unmounts and `release()` calls `track.stop()` + `ctx.close()`, dropping the `MediaStream`.
- On next sign-in the user taps the mic; `ensureStream()` sees no live stream and calls `getUserMedia()` again.
- Safari (and iOS PWAs in particular) treat each fresh `getUserMedia()` call as needing a re-confirmation when the previous grant was session-scoped, so the prompt appears again.

We never consult `navigator.permissions.query({ name: "microphone" })` first, so we cannot short-circuit or provide friendly messaging when the OS/browser has already granted or denied.

**Files involved**
- `src/lib/voice/useMicRecorder.ts` — `ensureStream()` and `start()`.

**Smallest safe fix**

In `ensureStream()`, before calling `getUserMedia()`:
1. If `navigator.permissions?.query` is available, check microphone state.
2. If `"granted"` → proceed straight to `getUserMedia()` (browsers reuse the grant without a prompt in this state).
3. If `"denied"` → set `MicState = "denied"` with a clear error and return without prompting.
4. If `"prompt"` or the API is unsupported (Safari desktop historically) → proceed to `getUserMedia()` as today.

This does not eliminate Safari's session-scoped re-prompt (that is an OS behavior we cannot override from the web), but it (a) never asks unnecessarily on browsers that persist the grant, (b) gives a clean denied-state UI instead of a raw error, and (c) sets us up to skip the redundant request path on Chrome/Android where `"granted"` is stable across sessions.

We also confirmed sign-out flow does not itself trigger `getUserMedia()` — the re-prompt is strictly on the first mic tap after re-entry.

### Risk assessment

**Voice pipeline change** — low risk. The prefetch pattern is a standard producer/consumer split; playback ordering, cache keys, fallback branch, and `stillValid()` gating are unchanged. Failure mode is at worst a same-as-today serial playback if the prefetch promise rejects.

**Mic permission check** — very low risk. `navigator.permissions` is feature-detected; unsupported browsers fall through to current behavior. No change to when we call `getUserMedia()` (still only on user gesture).

### QA plan

Voice:
1. Ask Pilot a 3–4 sentence answer; confirm inter-sentence pauses are noticeably shorter than current build.
2. Cache hit path (repeat a fixed greeting) still plays without regression.
3. Stop-mid-turn (barge-in) still cancels remaining chunks — `stillValid()` gating preserved.
4. Slow network throttling (Fast 3G) — playback should still be gapless-ish because fetch overlaps.

Mic:
1. Fresh sign-in on Chrome desktop → tap mic → prompt once → sign out → sign in → tap mic → no re-prompt.
2. Safari iOS PWA → tap mic → grant → sign out/in → tap mic → prompt may still appear (Safari OS-level), but no double-prompt within the same session.
3. Deny mic → clear "microphone blocked" state instead of raw error.
4. Existing tap-to-talk flow, silence auto-stop, and release button unchanged.

### Stop here

No implementation until you approve. Constraints honored: OpenAI stays default, no provider switching, no Smart Alarm / Fitbit / Oura work, all prior fixes preserved.