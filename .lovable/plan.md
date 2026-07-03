# Next-Generation Pilot Voice — Investigation & Migration Plan

Investigation only. No code changes until approved.

## 1. Recommended Architecture

**Primary: OpenAI Realtime API (`gpt-realtime`) transported via LiveKit Agents (Cloud).**

Why this pairing:
- OpenAI Realtime is a single speech-to-speech model — no separate STT/TTS/LLM chain, so latency drops from ~1.5–3s (our current OpenAI TTS pipeline) to ~300–800ms end-of-user-speech → first audio.
- Native server-side VAD + barge-in (interruption) is built in. Our custom chunker/queue in `speak.ts` becomes obsolete for the live path.
- LiveKit handles the hard parts we do NOT want to own: WebRTC SFU, mobile Safari/PWA quirks, network jitter, reconnection, echo cancellation, and background-noise suppression (Krisp).
- LiveKit Agents SDK (Node/Python) runs the OpenAI Realtime plugin server-side; the browser only speaks WebRTC to LiveKit, never directly to OpenAI. This keeps `OPENAI_API_KEY` server-only and gives us mid-call tool calls to our existing intelligence.

Flow:

```text
iOS PWA ──WebRTC──> LiveKit Cloud (SFU) <──WebSocket──> LiveKit Agent worker
                                                          │
                                                          ├── OpenAI Realtime (gpt-realtime)
                                                          └── Tool calls → RestPilot server fns
                                                                (personal-signals, memory,
                                                                 sleep engine, schedule, recovery)
```

Everything non-voice stays as-is: memory, sleep engine, Smart Light, recovery, schedule, Companion UI, prefs, Partner Mode, Stripe, Supabase.

## 2. Required APIs

- **OpenAI Realtime API** — model `gpt-realtime` (GA). Ephemeral client secrets via `POST /v1/realtime/client_secrets` (only needed if we ever go browser-direct; with LiveKit we don't).
- **LiveKit** — room + token REST API, server SDK, and the `@livekit/agents-plugin-openai` Realtime plugin.
- **Existing OpenAI TTS + Whisper** — kept as fallback for the legacy path.
- **Existing RestPilot server functions** — exposed to the Agent as tools (personal-signals, ai-memory read/write, sleep summary, schedule lookup, recovery calc).

## 3. Required Keys / Secrets

New secrets (all server-only, added via `add_secret`):
- `OPENAI_REALTIME_API_KEY` (can reuse existing OpenAI key; separate key recommended for cost tracking)
- `LIVEKIT_URL` (wss://…livekit.cloud)
- `LIVEKIT_API_KEY`
- `LIVEKIT_API_SECRET`

No new client-exposed keys. Browser gets a short-lived LiveKit JWT (60–120s) from a Supabase Edge Function.

## 4. Required Infrastructure

- **LiveKit Cloud** (recommended) — managed SFU + TURN. Self-hosting is possible but wastes engineering time.
- **Agent worker runtime** — LiveKit Agents worker. Options:
  1. LiveKit Cloud Agents (managed, autoscaled) — recommended.
  2. Small container on Fly.io / Render / Cloudflare Container — if we want full control.
  Cloudflare Workers / Supabase Edge Functions cannot host the Agent worker (needs long-lived WS + WebRTC egress).
- **Supabase Edge Function** `realtime-token` — mints LiveKit JWT after `requireUser`, records session start in `ai_log` for budget accounting.
- **Client** — `livekit-client` in the PWA. Works on iOS Safari 16.4+ / PWA. No native wrapper needed.

## 5. Cost Analysis

Assumptions per active user: 6 voice sessions/month × 3 min avg = **18 min/user/month**.

Unit costs (Nov 2026 public pricing):
- OpenAI `gpt-realtime` audio: ~$0.06/min input + $0.24/min output → blended ~$0.20/min conversational.
- LiveKit Cloud: $0.005/participant-minute (Build tier) → ~$0.005/min per user (1 participant + 1 agent bot free on agents plan; treat as $0.01/min to be safe).
- Infra fixed: agent workers autoscale; ~$50–500/mo base.

| Scale       | Voice min/mo | OpenAI Realtime | LiveKit    | Infra fixed | **Total/mo** | Cost/user | Rev @ $12 ARPU | **Gross margin** |
|-------------|--------------|-----------------|------------|-------------|--------------|-----------|----------------|------------------|
| 100         | 1,800        | $360            | $18        | $50         | **$428**     | $4.28     | $1,200         | 64%              |
| 1,000       | 18,000       | $3,600          | $180       | $150        | **$3,930**   | $3.93     | $12,000        | 67%              |
| 10,000      | 180,000      | $36,000         | $1,800     | $500        | **$38,300**  | $3.83     | $120,000       | 68%              |
| 100,000     | 1,800,000    | $360,000        | $18,000    | $2,000      | **$380,000** | $3.80     | $1,200,000     | 68%              |

Findings:
- **70% blended gross margin is achievable but tight.** Levers to reach 72–78%: cap free-tier voice minutes (already have `has_ai_budget`), route short "quick check" queries through cheaper `gpt-4o-mini-realtime` (~40% cheaper), keep non-voice chat on Gemini Flash, negotiate OpenAI enterprise discount at 10k+ users.
- Elite-tier users (higher ARPU, heavier use) subsidize Core-tier. Recommend Realtime as an **Elite/Premium-only feature** at launch, with a 5-min/day trial for lower tiers. This alone lifts blended margin to ~74%.

## 6. Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| iOS PWA WebRTC audio session conflicts w/ existing unlock code | Medium | Reuse `iosAudioUnlock`; test on iOS 17/18 PWA before flag flip |
| Realtime cost overrun from long idle sessions | High | Server-side 5-min idle timeout, hard cap via `has_ai_budget`, force disconnect |
| Vendor lock-in to OpenAI Realtime pricing | Medium | LiveKit Agents supports Google/ElevenLabs realtime — swap is a plugin change |
| Voice persona drift (loses "Sarah/Sage" identity) | Medium | Pin Realtime `voice: "cedar"` or `"marin"`; keep persona in system prompt |
| Tool-call latency erases the speed win | Low | Preload personal-signals into session context at connect time |
| LiveKit Cloud outage | Low | Fallback flag flips users back to current OpenAI TTS pipeline |
| Regression in memory / reasoning quality | Medium | Same system prompt + tool interface; run side-by-side A/B for 2 weeks |

## 7. Migration Phases

Each phase gated by explicit approval.

**Phase 0 — Foundations (0.5 day)**
- Add secrets, feature flag `PILOT_REALTIME_ENABLED` (default false).
- Add `pilot_realtime_beta` role gate.

**Phase 1 — Hidden beta route (2 days)**
- New route `/lab/pilot-realtime` (gated, not in nav).
- Edge Function `realtime-token` mints LiveKit JWT.
- Minimal LiveKit Agent worker w/ OpenAI Realtime plugin, no tools yet.
- Owner-only smoke test.

**Phase 2 — Tool bridge (2 days)**
- Wire existing server fns as Agent tools: `getPersonalSignals`, `readMemory`, `writeMemory`, `getSleepSummary`, `getSchedule`, `getRecovery`.
- Port persona + reasoning contract from `prompts.server.ts`.

**Phase 3 — Side-by-side testing (1 week)**
- Toggle in `/settings/labs` for beta users.
- Log latency, cost per session, user-reported quality to `ai_log`.
- Compare vs current pipeline on same prompts.

**Phase 4 — Elite rollout (3 days)**
- Enable for Elite subscribers by default; other tiers get 5-min/day trial.
- Keep legacy path as automatic fallback on Agent connect failure.

**Phase 5 — General availability (1 week soak)**
- Flip default for all authenticated users.
- Legacy TTS pipeline stays in codebase for 60 days as rollback.

**Rollback:** single flag flip in `flags.ts` → all clients revert on next reload; UpdateBanner forces refresh. Zero-downtime because both stacks coexist.

## 8. Estimated Implementation Time

- Total engineering: **~3 weeks** to Phase 4, **~4 weeks** to GA.
- Owner testing: ~1 week distributed across phases.

## 9. Recommendation

**Proceed** — with three conditions:
1. Gate Realtime to Elite tier at launch (protects margin, gives Elite a real reason to upgrade).
2. LiveKit Cloud managed, not self-hosted.
3. Keep the current OpenAI TTS pipeline as the automatic fallback for the full 60-day soak.

This is the single highest-leverage upgrade left before scale — it moves Pilot from "good custom voice" to genuinely category-leading, without touching any of the intelligence layers that make RestPilot itself.

Stop here. Awaiting approval before Phase 0.
