
# Companion voice → OpenAI Realtime WebRTC

## Current state (verified)

- **LiveKit is already fully removed.** No `agent-worker/`, no `.github/workflows/` directory. Nothing to delete.
- **A working OpenAI Realtime WebRTC prototype already exists** at `/lab/pilot-realtime` (feature-flagged, hidden). Files:
  - `src/lib/realtime/openai.functions.ts` — server fn that mints a session via `POST /v1/realtime/sessions`
  - `src/lib/realtime/useOpenAIRealtime.ts` — client hook: `RTCPeerConnection`, mic capture, `oai-events` data channel, SDP exchange, transcript + metrics
  - `src/routes/_authenticated/lab.pilot-realtime.tsx` — beta UI
- **Secrets present:** `OPENAI_REALTIME_API_KEY` (used by the pilot). No separate `OPENAI_API_KEY` — I'll reuse the existing one; server code already falls back correctly. No new secret needed.
- **/companion (production)** still runs the classic push‑to‑talk loop: `useMicRecorder → /api/stt (Whisper) → /api/ai → /api/tts (ElevenLabs) → auto-reopen`. This is what we're replacing.

## Scope of change

1. **Upgrade the server mint** to the newer `POST /v1/realtime/client_secrets` endpoint (returns `ek_…`) so the client can POST its SDP to `https://api.openai.com/v1/realtime/calls`. Keep the same session config already tuned (semantic VAD, low eagerness / long silence window, interrupt on, `gpt-realtime`, `alloy`, short-reply instructions).
2. **Client hook update** (`useOpenAIRealtime.ts`):
   - Fetch mic permission (`getUserMedia`) **before** minting the token (avoids the ~60s token expiring while the iOS permission prompt is up).
   - Switch SDP POST from `/v1/realtime?model=…` to `/v1/realtime/calls` with `Authorization: Bearer <ek_…>`.
   - Add four latency marks: `tokenFetchStart`, `tokenReceived`, `pcConnected`, `firstRemoteAudio` — exposed on the hook's `metrics` and `console.info`'d for debugging.
3. **Wire /companion to the new hook** while preserving the existing UI:
   - Replace the `useMicRecorder` → STT → AI → TTS chain with the realtime hook.
   - Map `rt.status` → existing orb/portrait states (`idle | listening | thinking | speaking`) so the mic button, PilotPortrait, ThinkingShimmer, and speaking indicator behave identically.
   - Keep mic tap → `connect()` on first press; subsequent taps toggle mute/end. Preserve barge-in (already server‑side via `interrupt_response`).
   - Keep text-chat send path (`/api/ai`) as a fallback for typed messages; it feeds the same conversation UI. The realtime channel handles voice turns.
   - Emit assistant transcripts into the existing message list so history/UX is unchanged.
   - Remove the `companion:turn-ended` auto-reopen loop (no longer needed — realtime is always-listening while connected).
4. **Retire the `/lab/pilot-realtime` beta** once /companion is on the new path (delete the flag, route, and lab page) — or keep it as a diagnostic. I'll keep it for now and remove in a follow-up after your acceptance test.

## Files touched

**Modify**
- `src/lib/realtime/openai.functions.ts` — switch to `client_secrets` endpoint, same session config.
- `src/lib/realtime/useOpenAIRealtime.ts` — mic-before-token, `/v1/realtime/calls` SDP POST, 4 latency marks.
- `src/routes/companion.tsx` — swap voice engine, map states, drop STT/TTS/auto-reopen for voice turns.

**Unchanged / not touched**
- `/api/ai`, `/api/stt`, `/api/tts*` — left in place (text chat still uses `/api/ai`; STT/TTS routes stay for other callers and easy rollback).
- All other Companion UI components.
- Secrets, DB, RLS, edge functions.

**Nothing to delete** — LiveKit and its CI are already gone.

## Rollback

If Realtime misbehaves in production, reverting `src/routes/companion.tsx` restores the STT/AI/TTS loop with no other side-effects (all endpoints still live).

## What I need

Approve and I'll implement, verify with a Playwright run against a local `/companion`, publish once, and hand it back for your single iPhone acceptance test.
