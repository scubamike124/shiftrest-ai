
# Investigation: OpenAI Realtime voice timing issues

## 1. Current realtime config

Server (`src/lib/realtime/openai.functions.ts`) mints the session with only two fields:

```json
{ "model": "gpt-realtime", "voice": "alloy" }
```

Everything else uses OpenAI's defaults:

- `turn_detection`: **`server_vad`** with `threshold=0.5`, `prefix_padding_ms=300`, **`silence_duration_ms=500`** — this is the ~1 second cutoff the user is hitting (500 ms of silence + audio buffer flush).
- `instructions`: **none set** — model uses its built-in default persona, which tends toward long, essay-style answers.
- `modalities`: default `["audio","text"]`.
- `input_audio_transcription`: **off** (that's why transcripts often don't render).
- `max_response_output_tokens`: `"inf"` — no cap on reply length.
- `temperature`: `0.8`.

Client (`src/lib/realtime/useOpenAIRealtime.ts`):

- Sends SDP offer to `/v1/realtime` and plays whatever OpenAI returns.
- **Never sends a `session.update`** after connect, so the server-side config above is the whole story.
- Attaches remote audio to a hidden `<audio autoPlay playsInline>` element. No jitter buffer tuning, no `preservesPitch`, no explicit `latencyHint`. This is normal WebRTC playback and is not the source of gaps — inter-chunk pauses come from the model, not from the audio element.

Data channel handling drives UI state but has zero effect on model behavior.

## 2. Root cause hypothesis

Three separate causes for three separate symptoms — none of them are audio-pipeline bugs:

**(a) "AI cuts me off after ~1s pause"**
→ Default `server_vad` treats 500 ms of silence as end-of-turn and immediately triggers a response. Natural mid-sentence pauses (breath, thinking) exceed 500 ms and get interpreted as "user done talking." Increasing `silence_duration_ms`, or switching to `semantic_vad`, fixes this. `semantic_vad` uses the model's own linguistic prediction of turn-end instead of raw silence, and exposes an `eagerness` knob (`low`/`medium`/`high`/`auto`) — `low` waits longer before deciding you're done.

**(b) "AI takes too long to start replying"**
→ Two contributors:
  - With `server_vad`, the 500 ms silence timer must elapse before the model even starts generating. Every reply has a mandatory 500 ms floor before first token.
  - No `instructions` means the model plans a full essay-style response before speaking. First audio delta lands late because the model is still composing.
  Setting a short-reply system prompt and/or `semantic_vad` with higher eagerness reduces both.

**(c) "AI pauses too long between parts of its answer"**
→ Long-form generated text with sentence/paragraph breaks: TTS naturally inserts pauses at punctuation. When the model is told (implicitly) to give thorough answers, it produces multi-sentence outputs with commas, periods, and paragraph breaks that each become audible gaps. Constraining reply length + style (short conversational sentences, no lists/paragraphs) collapses these gaps. Optionally capping `max_response_output_tokens` (e.g. 200) prevents runaway paragraphs.

None of the three symptoms are caused by network, WebRTC jitter, or the `<audio>` element. All three are governed by session config the server currently isn't sending.

## 3. Minimal tuning options

Two levers, both applied in a single `session.update` sent by the client immediately after the data channel opens (or, cleaner, baked into the server-side mint payload so the browser never sees them).

**Lever A — turn detection (fixes cutoffs + start latency):**

Option A1 — Stay on `server_vad`, loosen it:
```json
"turn_detection": {
  "type": "server_vad",
  "threshold": 0.5,
  "prefix_padding_ms": 300,
  "silence_duration_ms": 900,
  "create_response": true,
  "interrupt_response": true
}
```
Pro: predictable, no model-side judgment.
Con: still a fixed silence floor before every reply.

Option A2 — Switch to `semantic_vad` (recommended):
```json
"turn_detection": {
  "type": "semantic_vad",
  "eagerness": "low",
  "create_response": true,
  "interrupt_response": true
}
```
Pro: no fixed silence timer; model decides based on whether your sentence sounds finished. Fewer false cutoffs, faster start when you clearly are done.
Con: newer, occasionally over/underwaits on ambiguous phrasing.

**Lever B — reply shape (fixes long inter-part pauses + slow first audio):**

Add an `instructions` string and a token cap:
```json
"instructions": "You are RestPilot, a warm sleep and rest companion. Reply like a person on a phone call: one or two short sentences at a time, plain conversational language, no lists, no headings, no long paragraphs. Pause only when the user might want to speak. If the user asks something big, give the shortest useful answer first and offer to go deeper.",
"max_response_output_tokens": 200,
"modalities": ["audio","text"],
"input_audio_transcription": { "model": "whisper-1" }
```

Enabling `input_audio_transcription` also fixes the empty transcript panel.

**Bundled recommendation (single stable batch, per user's workflow preference):**

Apply A2 + B together — this is the smallest change set that plausibly addresses all three symptoms in one iteration. If A2 misbehaves on ambiguous phrasing, fall back to A1 with `silence_duration_ms: 900`.

Where to set: cleanest is server-side in the session-mint payload (`session.turn_detection`, `session.instructions`, `session.max_response_output_tokens`, `session.input_audio_transcription`), so behavior is defined once and can't be tampered with from the browser. The client can still send `session.update` for future per-user tweaks.

## 4. No implementation until approved

Awaiting go-ahead to apply the bundled recommendation (semantic_vad + short-reply instructions + transcription + 200-token cap), or to pick a different option combination.
