
# Migrate voice stack: LiveKit → OpenAI Realtime WebRTC

## 1. Migration plan

Today the realtime pilot path is:

```
browser ──WebRTC──▶ LiveKit room ──▶ agent-worker (Node, LiveKit Cloud) ──▶ OpenAI Realtime
```

Three moving parts we don't need. The new path:

```
browser ──WebRTC (SDP)──▶ OpenAI Realtime
    ▲
    │ ephemeral client_secret (60s)
    │
server (TanStack serverFn) ──HTTPS──▶ OpenAI /v1/realtime/sessions
```

Flow:
1. Browser clicks "Start" → calls server fn `mintRealtimeSession()`.
2. Server fn (auth-gated) calls `POST https://api.openai.com/v1/realtime/sessions` with `OPENAI_API_KEY`, returns the ephemeral `client_secret.value` (short-lived, ~60s).
3. Browser creates `RTCPeerConnection`, adds mic track, creates data channel `oai-events`, generates SDP offer.
4. Browser POSTs the SDP to `https://api.openai.com/v1/realtime?model=gpt-realtime` with `Authorization: Bearer <ephemeral>` and applies the returned SDP answer.
5. Remote audio track auto-plays through a hidden `<audio>` element (same as today).
6. Data channel receives `response.*` events → drives listening/thinking/speaking UI states and latency diagnostics.

The `OPENAI_API_KEY` never leaves the server. The ephemeral token is single-use and short-lived, safe to hand to the browser.

## 2. Files that will change

New:
- `src/lib/realtime/openai.functions.ts` — `mintRealtimeSession` server fn (auth-gated, calls OpenAI sessions endpoint, returns `{ clientSecret, expiresAt, model, voice }`).
- `src/lib/realtime/useOpenAIRealtime.ts` — client hook: mic capture, `RTCPeerConnection`, SDP handshake, data-channel event parsing, status machine (`idle | connecting | listening | thinking | speaking | error`), latency metrics (connect ms, time-to-first-audio, per-turn response latency).

Edit:
- `src/routes/_authenticated/lab.pilot-realtime.tsx` — swap `useRealtimePilot` for `useOpenAIRealtime`; keep the same UI shell (mic button, status pill, transcript, mute, diagnostics panel).
- `package.json` — remove `livekit-client`, `livekit-server-sdk` from the app (kept only if still referenced elsewhere — grep confirms only these three files use them).
- `.env.example` — add `OPENAI_API_KEY=`.

Delete (after new path verified):
- `src/lib/realtime.functions.ts` (LiveKit token + preflight).
- `src/lib/realtime/useRealtimePilot.ts`.
- `agent-worker/` (entire folder — worker, Dockerfile, livekit.toml, README).
- `.github/workflows/deploy-agent-worker.yml`.
- `.lovable/plan.md` (stale LiveKit plan).

Keep untouched:
- Companion UI, mic permission flow, `<audio>` element pattern, auth gate, lab-only routing.

## 3. New secret

- `OPENAI_API_KEY` — server-only. Requested via `add_secret` in the implementation turn. An existing `OPENAI_REALTIME_API_KEY` may already be set; we can reuse it by reading either name, but the canonical name going forward is `OPENAI_API_KEY`.

No `VITE_*` version. The browser only ever sees the ephemeral `client_secret`.

## 4. Risks

- **Browser compatibility**: OpenAI Realtime WebRTC needs modern `RTCPeerConnection` + `getUserMedia`. Safari iOS 17+ works; older iOS may fail. Mitigation: keep behind the existing `VITE_ENABLE_REALTIME_PILOT` lab flag until validated on target devices.
- **Ephemeral token TTL**: ~60s. If the user hesitates between mint and "Start", the SDP POST 401s. Mitigation: mint on click, not on page load; auto-retry once on 401.
- **Mobile background suspend**: iOS may kill the peer connection when the tab backgrounds. Same behavior as today's LiveKit path; surface as `reconnecting` state.
- **Autoplay policies**: remote audio must attach to an `<audio>` element that was created inside the click gesture that started the session. Same pattern as current hook — low risk.
- **Cost visibility**: direct OpenAI billing (no LiveKit hop). Add a session-length hard cap (e.g. 5 min) to prevent runaway sessions during testing.
- **Persona / tools**: LiveKit agent worker was where the future tool bridge (memory, signals, schedule) was going to live. With WebRTC direct, tools become browser-side function calls dispatched from the data channel, which is fine but a different implementation shape. Phase-3 tool work will need re-planning — not in this migration.
- **Diagnostics reduction**: we lose LiveKit's server-side preflight surface. Replaced with client-side timings only (connect ms, first-audio ms, per-turn latency).

## 5. Step-by-step implementation

1. Add `OPENAI_API_KEY` via `add_secret` (or confirm reuse of `OPENAI_REALTIME_API_KEY`).
2. Create `src/lib/realtime/openai.functions.ts` with `mintRealtimeSession` server fn:
   - `.middleware([requireSupabaseAuth])`
   - POST to `https://api.openai.com/v1/realtime/sessions` with `{ model: "gpt-realtime", voice: "alloy" }` (voice/model configurable later).
   - Map upstream errors to friendly messages.
3. Create `src/lib/realtime/useOpenAIRealtime.ts`:
   - `connect()` — mint session → build `RTCPeerConnection` → `getUserMedia({ audio: true })` → add track → create `oai-events` data channel → `createOffer` → POST SDP to `/v1/realtime?model=...` with bearer → `setRemoteDescription(answer)`.
   - Attach remote audio track to `remoteAudioRef`.
   - Data channel: parse `input_audio_buffer.speech_started/stopped`, `response.created/output_audio.delta/done` → drive `status` (`listening | thinking | speaking`) and `metrics` (first-audio ms, per-response latency).
   - Expose `connect`, `disconnect`, `toggleMute`, `status`, `error`, `transcript`, `metrics`, `remoteAudioRef`.
4. Rewrite `src/routes/_authenticated/lab.pilot-realtime.tsx` to use the new hook. Preserve existing controls, transcript panel, and add a diagnostics block: "connect ms / first audio ms / last turn ms".
5. Verify end-to-end in preview: mint call succeeds, WebRTC connects, mic captured, model audio plays, states cycle, latencies render.
6. Remove LiveKit code:
   - Delete `src/lib/realtime.functions.ts`, `src/lib/realtime/useRealtimePilot.ts`.
   - Delete `agent-worker/` and `.github/workflows/deploy-agent-worker.yml`.
   - `bun remove livekit-client livekit-server-sdk` from the app.
   - Clear the stale `.lovable/plan.md`.
7. Publish once stable and hand to user for final acceptance testing.
