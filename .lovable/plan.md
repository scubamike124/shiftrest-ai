## Investigation findings

### 1. Which feature is this
The "Voice briefing" button rendered by `src/components/VoicePlayer.tsx`. It appears on the Smart Light Plan page (`src/routes/plan.tsx` line 271) and reads back the personalized recovery-plan script. This is entirely **separate from the Pilot/Companion Realtime voice chat** (`useOpenAIRealtime` + WebRTC to OpenAI Realtime). Voice briefing is a one-shot text→speech pipeline; Companion is a bidirectional realtime session.

### 2. The actual pipeline
Two sequential blocking round-trips, no streaming end-to-end:

```
[tap]
  │
  ├─▶ POST /api/brief                                       ← step A (LLM)
  │     server: chatJSON() — NON-streaming completion via
  │              ai.gateway.lovable.dev /v1/chat/completions
  │              (waits for full JSON script before responding)
  │     server: also does supabase.auth.getUser + a user_prefs
  │              row read to pick language/accent
  │     client: await res.json()                            ← full script in memory
  │
  ├─▶ speakQueued(script)
  │     └─▶ playOnce() → POST /api/tts-elevenlabs           ← step B (TTS)
  │           server: fetch elevenlabs.io /v1/text-to-speech/{voice}
  │                    (NON-streaming endpoint — no `/stream`)
  │                    model_id: eleven_turbo_v2_5, mp3_44100_128
  │           client: await resp.blob()                     ← full MP3 buffered
  │           audio.src = blob URL → audio.play()
  │
[first sound]
```

So the ~15s clock is: `LLM full completion` + client await + `ElevenLabs full-clip synth` + full-blob download + Web Audio warm-up. Both providers support streaming, and neither is being used that way here.

### 3. Instrumentation plan (this is the only code change in this step)

Add lightweight, timestamped `console.info` markers with a per-invocation id so we can read the exact breakdown from the browser console after one tap. No server-side deploy needed for the client marks; I'll also add two server-side `console.log` marks in `/api/brief` and `/api/tts-elevenlabs` that already exist partially — I'll normalize them so we get end-to-end.

Client marks (in `VoicePlayer.generateAndPlay` and a one-shot listener on `companion:voice-status`):
- `t0` — button tapped
- `t1` — `/api/brief` request sent
- `t2` — `/api/brief` response headers received
- `t3` — `/api/brief` JSON parsed (script in hand)
- `t4` — `speakQueued` invoked
- `t5` — first `companion:voice-status` `started` event (first audio scheduled to play)

Each mark logs `Δ from previous` and `Δ from t0`, tagged `[brief-timing #<id>]`.

Server marks (already emit; will normalize wording):
- `/api/brief`: `[brief] provider_start` and `[brief] provider_done ms=<n> tokens=<n>`
- `/api/tts-elevenlabs`: `[tts-elevenlabs] provider_start` (currently only logs `provider_ok` at the end) and `provider_done ms=<n>`

## What I need from you after this deploys

1. Open DevTools → Console before tapping.
2. Tap "Voice briefing" once on the Smart Light Plan page.
3. Paste back the 6 client `[brief-timing]` lines.

I'll cross-reference with server logs on my side (`stack_modern--server-function-logs` for `[brief]` and `[tts-elevenlabs]`) and report the exact breakdown — LLM ms vs. TTS ms vs. network vs. audio-warmup — before proposing the actual fix.

## Files changed in this step

- `src/components/VoicePlayer.tsx` — add 6 timing marks, per-tap id.
- `src/routes/api/brief.ts` — add `provider_start` / `provider_done` log lines around `chatJSON`.
- `src/routes/api/tts-elevenlabs.ts` — add `provider_start` log line before the ElevenLabs fetch (keep existing `provider_ok`).

No behavior change. No pipeline change. This is measurement only, per your request.

## Likely fixes (NOT applied yet — for context only)

Based on the pipeline above, the fix will probably be one or more of:
- Switch `/api/tts-elevenlabs` to the `/stream` endpoint and pass `upstream.body` through as a real stream; on the client, use `MediaSource` (or `<audio>` with the streaming URL) instead of `await resp.blob()`, so playback starts on first bytes.
- Switch `/api/brief` to `chatStream` and pipe deltas — either play as sentences arrive (chunk-level TTS + stitched playback) or at minimum start the TTS request as soon as the first full sentence is ready, rather than after the entire script.
- If ElevenLabs synth latency dominates on `eleven_turbo_v2_5`, evaluate `eleven_flash_v2_5` for the briefing (lower time-to-first-byte, comparable prosody for narration).

Numbers first, then pick.
