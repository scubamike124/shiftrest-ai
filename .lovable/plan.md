# Plan — Realtime voice diagnostics in `agent-worker/worker.ts`

Diagnostics only. No behavior, VAD, eagerness, model, or voice changes.

Note on path: the worker lives at `agent-worker/worker.ts` (not `agent-worker/src/worker.ts`). All edits are in that one file.

## What we add

A tiny per-turn timing recorder plus structured log lines around the existing `AgentSession` events. Every log line is prefixed `[rt-diag]` and tagged with the same `turnId` (monotonic `t000001`, `t000002`, …) so we can grep one full turn out of Cloud logs.

Recorded phases per turn:

```
turnStart          — UserStartedSpeaking fires
userFinal          — UserInputTranscribed with ev.isFinal === true
assistantFirstOut  — first assistant audio/text signal we can observe
assistantDone      — ConversationItemAdded (role=assistant) with final text
```

Derived metrics logged at `assistantDone`:

```
userSpeechMs       = userFinal - turnStart
vadToFirstOutMs    = assistantFirstOut - userFinal   ← "did model start replying quickly?"
firstOutToDoneMs   = assistantDone     - assistantFirstOut
totalTurnMs        = assistantDone     - turnStart
userTranscriptLen  = ev.transcript.length
assistantTextLen   = joined assistant text length (best-effort)
```

Config echo (once per turn at `turnStart`, once at worker boot):

```
turnDetection={type:"semantic_vad",eagerness:"low",create_response:true,interrupt_response:true}
```

## Which SDK events we hook

All already exist in the current file — we only add listeners, no re-wiring.

- `voice.AgentSessionEventTypes.UserStartedSpeaking` (already conditionally attached; we reuse it to open the turn).
- `voice.AgentSessionEventTypes.UserInputTranscribed` with `ev.isFinal === true` → stamp `userFinal`.
- Assistant-first-audio signal: try in this order, first one available wins, others no-op:
  1. `voice.AgentSessionEventTypes.AgentStartedSpeaking` (if exported by this SDK version).
  2. `voice.AgentSessionEventTypes.AgentSpeechCommitted` / `AgentAudioStarted` (name varies by SDK build) — probed via `(voice.AgentSessionEventTypes as any).*`.
  3. Fallback: the first `ConversationItemAdded` with `role === "assistant"` where item is still streaming, OR the room's `trackPublished` for the agent's audio track. If none of those fire, we still record `assistantFirstOut = assistantDone` and log `assistantFirstOutSource=none` so we can see the gap is fully "model-side".
- `voice.AgentSessionEventTypes.ConversationItemAdded` (assistant role) → stamp `assistantDone` and flush the metrics log.

The greeting turn is tagged `turnId=t000000` and excluded from p50/p95 aggregation so cold-start doesn't skew numbers.

## Log format (single line per event, JSON-ish, greppable)

```
[rt-diag] t=000003 phase=turnStart at=17510000000 config={"vad":"semantic_vad","eagerness":"low"}
[rt-diag] t=000003 phase=userFinal at=17510000480 dtFromStart=480 transcriptLen=42
[rt-diag] t=000003 phase=assistantFirstOut at=17510002110 source=AgentStartedSpeaking vadToFirstOutMs=1630
[rt-diag] t=000003 phase=assistantDone   at=17510005240 firstOutToDoneMs=3130 totalTurnMs=5240 assistantTextLen=187
```

Also emit one boot line:

```
[rt-diag] boot workerVersion=<git sha or "dev"> agent=pilot-realtime turnDetection={"type":"semantic_vad","eagerness":"low","create_response":true,"interrupt_response":true}
```

## Reading the numbers

- Large `vadToFirstOutMs` (> ~800 ms) with small `firstOutToDoneMs` → **turn detection / model TTFB** is the bottleneck (semantic_vad + eagerness:low waits for stable end-of-turn).
- Small `vadToFirstOutMs` with large `firstOutToDoneMs` → **model generation length / TTS streaming**.
- Large `userSpeechMs` where the user actually stopped much earlier → VAD is holding the mic open (again semantic_vad + low eagerness).
- All three small but user perceives lag → **client-side playback / jitter buffer** (out of scope for this diagnostic).

## Files changed

- `agent-worker/worker.ts` — add:
  - module-scope `let turnCounter = 0;` and `formatTurnId(n)`.
  - inside `entry`, per-turn `TimingRecord` object created on `UserStartedSpeaking` and finalized on `ConversationItemAdded (assistant)`.
  - listeners: `AgentSessionEventTypes.UserInputTranscribed` (already there — extend with timing stamp), plus best-effort listeners for `AgentStartedSpeaking` / `AgentAudioStarted` via `(voice.AgentSessionEventTypes as any)`.
  - one boot-time `[rt-diag] boot …` log after `defineAgent`'s `entry` connects.

No changes to:
- `agent-worker/livekit.toml`, `Dockerfile`, `package.json` — pure code addition, no new deps.
- OpenAI Realtime model, voice, `turnDetection`, or greeting behavior.
- The RestPilot app (`src/**`) — this is worker-only.

## Deploy / verification (after approval)

1. Redeploy worker: `cd agent-worker && lk agent deploy` (LiveKit Cloud builds from `Dockerfile`).
2. Open `/lab/pilot-realtime` in the published site, run one short turn + one long turn.
3. In LiveKit Cloud → Agents → `pilot-realtime` → Logs, grep `rt-diag` and read the four lines per turn. Report p50 `vadToFirstOutMs`, `firstOutToDoneMs`, `totalTurnMs`.

## Risks

- Worker cold-start log noise increases by a handful of lines per turn — negligible cost, and easy to strip by removing the block later.
- The `AgentStartedSpeaking` / `AgentAudioStarted` names differ across `@livekit/agents` versions; we probe them via `(voice.AgentSessionEventTypes as any)` and fall back to marking `assistantFirstOut = assistantDone` with `source=none` so nothing breaks if the event isn't exposed.
- No behavior change → zero risk to the production voice UX.

Awaiting approval to implement.
