# Confirm the 20s cutoff cause before changing the cap

Strong suspicion: `max_output_tokens: 200` in the session config is being hit. 200 tokens ≈ 15–25 seconds of speech, which matches the reported cutoff timing exactly. But we should not raise it blindly — a WebRTC timeout, a data-channel drop, or a `response.error` event would produce the same subjective symptom (voice stops mid-sentence, doesn't resume) and raising the cap wouldn't fix any of those.

## Step 1 — Add diagnostic logging only (no behavior change)

In `src/lib/realtime/useOpenAIRealtime.ts`:

- On **every** `response.done` / `response.completed` event, log the full event object — specifically `response.status`, `response.status_details.type`, `response.status_details.reason`, and `response.usage.output_tokens`. This tells us definitively whether the model finished (`completed`), was truncated by the cap (`incomplete` + reason `max_output_tokens`), was interrupted (`cancelled` + `turn_detected`), or errored (`failed`).
- Log any `error` and `response.error` event types on the data channel with the full payload.
- Add `dc.onerror`, `dc.onclose`, and `pc.oniceconnectionstatechange` handlers that log with timestamps, so a channel drop around the 20s mark would be visible in the console alongside the cutoff.

No config changes. No cap changes. No behavior changes. Just visibility.

## Step 2 — User runs one long-answer turn

Ask a question that would normally produce a 30+ second response ("Give me a detailed wind-down routine for someone with racing thoughts, walk me through each step"). Watch the console at the moment the voice stops.

## Step 3 — Decide based on evidence

- If the log shows `response.done` with `status: "incomplete"` and `reason: "max_output_tokens"` → confirmed token cap. Raise `max_output_tokens` (likely to 800–1200, or remove and rely on the "short sentences" system prompt) in `openai.functions.ts`.
- If the log shows `status: "failed"` or a `response.error` / `error` event → different bug (model error, content filter, etc.); fix at that layer.
- If the log shows the data channel closed or ICE disconnected around 20s → WebRTC-level issue (connection instability, NAT/keepalive); different fix entirely.
- If nothing distinctive is logged at cutoff → something upstream is silently killing the audio stream; investigate the peer connection stats.

## Technical detail

Files touched in step 1:
- `src/lib/realtime/useOpenAIRealtime.ts` — expand the existing `handleEvent` `response.done` branch, add data-channel + ICE error/close logging in `connect()`.

Nothing else changes until step 3.
