# Phase 2 — Investigation Report: OpenAI Realtime + LiveKit

**Status:** Investigation only. No code changes. Awaiting approval before Phase 2 implementation.

---

## 1. Current Voice Pipeline (baseline)

Turn = mic → STT → chat LLM → TTS → speaker. Each hop is a discrete HTTP round-trip:

```text
User speaks
  └─► useMicRecorder (MediaRecorder, WebM/Opus, VAD by silence timer)
       └─► POST /api/stt        (Lovable Gateway → openai/gpt-4o-mini-transcribe)
            └─► pilot orchestration (companion/speak, intent-router, memory,
                signals, gateway.server → chat LLM)
                 └─► POST /api/tts (Lovable Gateway → openai/gpt-4o-mini-tts)
                      └─► useTtsPlayer plays MP3 chunk
```

Root cause of the remaining pauses: **four serial network hops per turn, no streaming across the boundaries.** STT waits for end-of-utterance, chat waits for full transcript, TTS waits for full chat completion, playback waits for full MP3. Barge-in and mid-sentence interruption are not physically possible in this shape.

Files that own the pipeline today:

- `src/lib/voice/useMicRecorder.ts` (mic + silence VAD)
- `src/lib/voice/useTtsPlayer.ts` (MP3 playback queue)
- `src/lib/voice/wav-encoder.ts`, `intent-executor.ts`, `intent-router.ts`, `profile.ts`, `companion-sound-bridge.ts`
- `src/lib/companion/speak.ts` (673 lines — the orchestrator)
- `src/lib/companion/speech-normalize.ts`, `narration.ts`, `emotion.ts`, `visemes.ts`
- `src/routes/api/stt.ts`, `src/routes/api/tts.ts`, `src/routes/api/tts-elevenlabs.ts`
- Surfaces: `src/routes/companion.tsx`, `src/routes/pilot.tsx`, `src/routes/coach.tsx`, `src/routes/automations.tsx`, `src/routes/qa.voice.tsx`, `src/components/voice/VoiceSettings.tsx`, `src/components/sleep/VoiceCommandButton.tsx`

---

## 2. How OpenAI Realtime Replaces STT + Chat + TTS

`gpt-realtime` is a single bidirectional model. One WebSocket/WebRTC session carries:

- inbound: PCM audio frames from the user
- outbound: PCM audio frames of the assistant + text transcript + tool-call events

That collapses the four hops into **one persistent duplex stream**:

```text
mic PCM ──►  gpt-realtime  ──► speaker PCM (starts within ~400 ms of end-of-speech)
                │ ▲
                │ └── tool_call events  ──► RestPilot server fns ──► tool_result
                ▼
              text transcript (for logs, memory, UI)
```

Server-side VAD, semantic turn detection, and barge-in are native to the model. There is no separate Whisper call and no separate TTS call. Voice never "switches" mid-answer because a single voice model owns generation start-to-finish.

---

## 3. Why LiveKit and What It Solves

The browser cannot hold a raw WebSocket to OpenAI Realtime reliably on mobile Safari / PWA. It also cannot survive network jitter, echo, or backgrounding without a media server. LiveKit is the transport:

```text
iOS PWA / Web
  │  WebRTC (livekit-client)
  ▼
LiveKit Cloud SFU  ── room: pilot-<userId> ──►  LiveKit Agent worker
                                                  │  Realtime plugin
                                                  ▼
                                          OpenAI gpt-realtime
                                                  │  tool_call
                                                  ▼
                                        RestPilot server fns (existing)
```

LiveKit gives us: WebRTC (Opus + jitter buffer + echo cancellation + AGC), auto-reconnect, mobile Safari compatibility, backgrounding survival, SFU-level barge-in, one stable audio track the Agent worker owns, and a managed Agent runtime so we do not host a long-lived WebSocket process ourselves (the TanStack Cloudflare Worker cannot).

Result: no serial hops, streamed audio in both directions, barge-in in ~50 ms, first audible token in ~400–800 ms after end-of-user-speech (vs today's ~1.5–3 s).

---

## 4. What Stays Unchanged

RestPilot's intelligence lives in server functions and Supabase, not in the voice pipeline. The Agent worker calls the **same** functions as tools, so behavior is preserved:

| Subsystem | Current entry point | Under Realtime |
| --- | --- | --- |
| AI memory (read/write/propose) | `src/lib/ai/memory-*.server.ts`, `src/lib/memory*.ts` | exposed as `readMemory` / `writeMemory` tools |
| Personal signals | `src/lib/ai/personal-signals.server.ts` | `getPersonalSignals` tool |
| Sleep / recovery | health surfaces + server fns | `getSleepSummary`, `getRecovery` tools |
| Fitbit / Oura | existing connectors, unchanged | consumed via the tools above |
| Schedule / calendar | `src/lib/calendar*`, `src/lib/trips.functions.ts` | `getSchedule` tool |
| Smart Alarm | dispatch code + DB, unchanged | not exposed as a tool in Phase 2 |
| Reasoning / prompts / persona | `src/lib/ai/prompts.server.ts`, `context.server.ts` | injected as the Realtime `session.instructions` |
| Coach personality, preferred-name, no-email-prefix, no-duplicate-greeting | existing rules | folded into the same system prompt |
| Billing, subscriptions, auth, RLS | unchanged | unchanged |

No Supabase schema change is required for Phase 2.

---

## 5. Files That Change

**New (added):**

- `src/lib/realtime/agent-tools.ts` — thin adapters that wrap the existing server fns as Realtime tool schemas (server-only)
- `src/lib/realtime/session.ts` — session config, persona/instructions builder (reuses existing prompt modules)
- `src/lib/realtime/useRealtimePilot.ts` — client hook: mint token → connect livekit-client → publish mic → subscribe assistant audio → surface transcript + tool events
- `src/components/voice/RealtimePilot.tsx` — beta UI shell (Connect, mute, VU meter, transcript, status)
- `agent-worker/` (separate repo or subfolder, deployed to LiveKit Cloud — **not** the TanStack app): worker entry using `@livekit/agents` + `@livekit/agents-plugin-openai`, plus the tool bridge
- New public route stays hidden: `src/routes/lab.pilot-realtime.tsx` (already exists from Phase 1) becomes the beta surface

**Extended (small, additive, flag-gated):**

- `src/routes/companion.tsx`, `src/routes/pilot.tsx` — behind `ENABLE_REALTIME_PILOT` + role gate, render `<RealtimePilot />` instead of the legacy path
- `src/lib/realtime.functions.ts` (Phase 1) — add an optional `endRealtimeSession` fn that logs into `ai_log` for cost tracking

**Unchanged (explicitly preserved for rollback):**

- `src/lib/companion/speak.ts`, `src/lib/voice/useMicRecorder.ts`, `src/lib/voice/useTtsPlayer.ts`, `src/routes/api/stt.ts`, `src/routes/api/tts.ts`, `src/routes/api/tts-elevenlabs.ts`, all normalization / emotion / narration / visemes modules.

No file is deleted in Phase 2. Legacy stays live and is the default.

---

## 6. New Packages, Env Vars, Infrastructure

**npm (browser):** `livekit-client`
**npm (agent worker, external repo):** `@livekit/agents`, `@livekit/agents-plugin-openai`, `livekit-server-sdk`, `zod`
**Already installed:** `livekit-server-sdk` (in main app, Phase 1)

**Env / secrets — already added in Phase 1:**
`OPENAI_REALTIME_API_KEY`, `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `VITE_ENABLE_REALTIME_PILOT` (default `false`).
**No new secrets in Phase 2.**

**Infrastructure:**
- LiveKit Cloud project (SFU + managed Agent worker runtime)
- No new Supabase Edge Function required (token minting is already a TanStack server fn from Phase 1)
- No Cloudflare Worker change

---

## 7. Feature-Flag Isolation & Production Safety

- `ENABLE_REALTIME_PILOT` stays `false` in production.
- Companion / Pilot surfaces branch at the top of the component: flag off → legacy pipeline (byte-for-byte unchanged); flag on → `<RealtimePilot />`.
- Even with the flag on, a role check (`admin` or `tester`) gates access. Regular users never see the beta.
- Token endpoint 404s when LIVEKIT_* env is missing, so a misconfigured deploy fails closed.
- Legacy `/api/stt`, `/api/tts`, `/api/tts-elevenlabs` remain reachable and are the automatic fallback if `RealtimePilot` fails to connect within 3 s.

---

## 8. Latency, Quality, Cost

**Latency (end-of-user-speech → first assistant audio):**
- Today: ~1500–3000 ms (STT + chat + TTS + MP3 assemble)
- Realtime + LiveKit: ~400–800 ms first token; barge-in ~50 ms; no mid-answer pauses

**Voice quality:** `gpt-realtime` is a single generative voice model — no vendor swap mid-turn, no MP3 seam artifacts, prosody stays consistent. Currently the closest thing to human conversational feel available on a general-purpose LLM API.

**Per-minute cost (blended, one active voice minute):**

| Component | Cost/min |
| --- | --- |
| OpenAI `gpt-realtime` (audio in+out, tool calls) | ~$0.18–0.22 |
| LiveKit bandwidth + SFU minutes | ~$0.01 |
| **Total per active voice minute** | **~$0.20** |

**Monthly cost by scale (kept from Phase 1 economics, revalidated):**

| Users | Voice min/mo | OpenAI | LiveKit | Fixed | **Total/mo** | Cost/user | Rev @ $12 | **Margin** |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 100 | 1,800 | $360 | $18 | $50 | **$428** | $4.28 | $1,200 | 64% |
| 1,000 | 18,000 | $3,600 | $180 | $150 | **$3,930** | $3.93 | $12,000 | 67% |
| 10,000 | 180,000 | $36,000 | $1,800 | $500 | **$38,300** | $3.83 | $120,000 | 68% |

Mitigation to hit ≥72%: gate to Elite tier at launch, cap free/basic to 5 min/day trial, route short queries through `gpt-4o-mini-realtime` (~40% cheaper).

---

## 9. Risks

| Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- |
| iOS PWA WebRTC quirks (mic release, backgrounding) | Med | Med | LiveKit handles most; explicit unmount/teardown; keep legacy fallback |
| Realtime API cost overrun | Med | High | Elite-only launch, per-tier minute caps, mini-realtime routing, hard daily cap in `ai_log` |
| Vendor lock-in (OpenAI + LiveKit) | Med | Med | Tool bridge is provider-agnostic; can swap to Gemini Live or Deepgram Voice Agent later |
| Persona / memory regression vs current prompt | Med | High | Reuse existing prompt modules verbatim as `session.instructions`; A/B against legacy for 1 week |
| Tool-call latency inside voice loop | Low | Med | Only fast fns exposed; slow work stays async |
| LiveKit outage | Low | High | Automatic fallback to legacy pipeline on connect failure |
| Agent worker deploy complexity (external repo) | Med | Low | LiveKit Cloud managed runtime; one-command deploy |

---

## 10. Rollback Plan

1. Set `VITE_ENABLE_REALTIME_PILOT=false` and redeploy — every surface flips back to legacy in one env-var change. No code change required.
2. Legacy pipeline is never removed in Phase 2, so rollback is instantaneous and side-effect-free.
3. If a bad Agent worker deploy is the only fault, stop the LiveKit Agent worker; token endpoint keeps minting but client falls back to legacy on connect timeout.
4. 60-day soak: legacy code stays in the repo. Removal is a separate, later phase.

---

## 11. Is This the Best Voice AI We Can Ship Today?

Yes, for RestPilot's constraints (React PWA on iOS, tool-calling into existing server fns, sub-second first-token, barge-in, one consistent voice):

- OpenAI Realtime (`gpt-realtime`, GA) is currently the strongest general-purpose voice LLM with native tool use and server VAD.
- LiveKit is the reference WebRTC transport for AI voice agents and solves the mobile PWA hard problems that a raw WebSocket cannot.
- Alternatives considered and rejected: Gemini Live (weaker tool ecosystem for our stack), Deepgram Voice Agent (excellent latency but weaker reasoning), ElevenLabs Conversational AI (great voice, weaker reasoning + tool control), custom Whisper+GPT-4o+TTS streaming (still 2–3 hops, no true barge-in).

---

## 12. Estimated Implementation Time (for the eventual Phase 2, not now)

- Agent worker + tool bridge: 1.5 days
- Client hook + beta UI: 1 day
- Persona + memory prompt port: 0.5 day
- Side-by-side telemetry (`ai_log` extensions): 0.5 day
- Soak + fixes: 3 days
- **Total: ~6.5 working days** from approval to Elite-gated GA.

---

## Awaiting Approval

No files will be modified until you approve Phase 2. On approval I will implement in the order above, keep everything behind `ENABLE_REALTIME_PILOT` + role gate, and stop at Elite-gated beta for your sign-off before general rollout.
