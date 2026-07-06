## Answering your questions first (evidence)

**1. Is ElevenLabs streaming?** No. Two independent non-streaming choices stack up:

- **Server (`src/routes/api/tts-elevenlabs.ts`, line 96–116)** calls the **non-streaming** endpoint:
  ```
  POST https://api.elevenlabs.io/v1/text-to-speech/{voiceId}?output_format=mp3_44100_128
  ```
  Not `/v1/text-to-speech/{voiceId}/stream`. ElevenLabs' non-stream endpoint buffers the full MP3 before sending the first byte, so `upstream.body` doesn't actually stream — headers come back only when generation is done.

- **Client (`src/lib/companion/speak.ts`, `playOnce()` line 589)** does `blob = await resp.blob()` — waits for the entire response body, then builds an `objectURL`, then sets `audio.src`. So even if the server streamed, the client would re-buffer to a Blob before playback.

Result: `t4 speakQueued → t5 first audio started` = server generation of the full briefing MP3 + full body download + Blob build. That's your 8.3 s.

**2. Does the streaming endpoint exist?** Yes — `POST /v1/text-to-speech/{voiceId}/stream` with the same body. With `eleven_turbo_v2_5` first bytes typically arrive in 300–600 ms.

**3. LLM step (2.9 s).** `/api/brief` is already a dedicated short-briefing prompt (not the full Companion conversational prompt). Non-streaming completion of ~1–2 sentences on the current model. Real, but secondary — leave it alone this batch as you said.

## Fix (TTS-only; no LLM change, no UI change)

Two coordinated changes plus a client tweak — all confined to the TTS layer. Nothing else in the pipeline moves.

### 1. Server — switch to ElevenLabs streaming endpoint

`src/routes/api/tts-elevenlabs.ts`:

- Change the URL to `.../stream?output_format=mp3_44100_128`.
- Keep the same request body and `eleven_turbo_v2_5` model.
- Return `upstream.body` unchanged (already correct) with `Content-Type: audio/mpeg` and `Cache-Control: no-store`. No `TransformStream` wrapper (would re-buffer).
- Keep all existing error handling (402/429/config/network → fallback envelope) — unchanged.
- Keep the 2.5 s TTFB watchdog on the client — a streaming endpoint returns headers even faster, so the watchdog just becomes safer, not stricter.

### 2. Client — play incrementally instead of buffering to a Blob

`src/lib/companion/speak.ts`, `playOnce()`:

Introduce an `objectURL` built from the streaming `Response` body so `<audio>` can start playing at first bytes:

- On `content-type: audio/mpeg` responses, wrap `resp.body` in a `new Response(resp.body).blob()`-alternative: use **`MediaSource` + `SourceBuffer('audio/mpeg')`** and append chunks as they arrive from `resp.body.getReader()`. Set `audio.src = URL.createObjectURL(mediaSource)`. Call `audio.play()` as soon as the first buffer is appended and `mediaSource.readyState === "open"`.
- Fallback path: if `MediaSource` or `audio/mpeg` isn't supported (older iOS Safari can be flaky here), fall back to today's `await resp.blob()` path so behavior degrades gracefully instead of going silent.
- Do **not** change the audio graph, gain, soft-clip, level meter, or turn-queue semantics. `MediaElementSource` still wraps the same `primedAudio` element, so loudness/EQ/analyser all work identically.
- The response cache (`ttsCache`) stays. For streaming responses we tee the body: play from one branch, accumulate the other into a Blob and store it on `ended` so a repeat play is still a cache hit.

### 3. Cache-key note

Only the audio delivery changes — the same bytes come back for the same `(provider, voice, mode, spoken)` tuple. Existing cached blobs stay valid.

## Expected impact

- **t4 → t5** goes from ~8.3 s to roughly **0.4–0.9 s** (ElevenLabs TTFB with turbo v2.5 + one MSE append).
- **Total** for the same briefing drops from ~11.4 s to roughly **~3.5 s** (LLM 2.9 s dominates).
- No effect on Companion voice chat behavior — it already benefits from small chunk sizes; it'll just also get faster first-byte for its bigger replies.

## Verification before handing back

1. `tsgo` clean.
2. Local `curl` against the deployed `/api/tts-elevenlabs` after publish: check response headers arrive in <1 s and body streams (chunks arrive over time, not all at once).
3. Playwright on `/plan`: tap Voice briefing on a shift day, watch the black timing panel — `t4 → t5` and TTS + play row should each drop to <1 s. Screenshot both.
4. Sanity check Companion voice chat on `/companion` still speaks normally with no regression (same pipeline, same audio graph).

Only after those pass do I publish and ask you to run the on-phone timing test.

## Out of scope for this batch (intentionally)

- LLM step tuning (2.9 s → maybe 1.5 s with a smaller model / streaming completions). Separate proposal if you want it after we see the streamed-TTS numbers.
- The other 5 items from your earlier list (light plan navigation, light toggle, debug scaffolding removal, PWA caching, avatar mismatch) — still their own batch.
