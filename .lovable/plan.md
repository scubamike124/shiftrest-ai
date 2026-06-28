
# Pilot Launch Blockers — Root Cause + Fix Plan

Investigation done across `src/routes/pilot.tsx`, `src/routes/api/ai.ts`, `src/lib/ai/context.server.ts`, `src/lib/ai/gateway.server.ts`, `src/routes/api/stt.ts`, `src/routes/api/tts.ts`, and `src/components/voice/VoiceSettings.tsx`. No code changes yet.

---

## 1. Voice settings not discoverable — root cause

The settings exist and work. They live in `src/components/voice/VoiceSettings.tsx` (language, voice, gender filter, accent, personality, speed presets, Pilot name, live preview) and are mounted on `/profile` at the anchor `id="voice-settings"`. Pilot already has a small header link "Voice" pointing to `/profile#voice-settings`.

Why testers miss it:
- The link is a tiny ghost button in the top-right corner next to "Text", visually weighted the same as the chat link. On a 375px viewport it reads as a secondary action, not a primary entry into customization.
- There is no inline affordance near the orb (where the user's attention is) and no first-run nudge.
- The label "Voice" is ambiguous — sounds like "voice mode" not "voice customization".

### Fix
- Promote the link to a visible, labeled chip directly under the orb: `⚙ Voice & personality — {currentVoiceName} · {accent} · {speed}`. One tap → `/profile#voice-settings`.
- Keep the header icon, but rename it `Customize`.
- First-run nudge: if `prefs.voice_id` is null on Pilot mount, show a dismissible banner above the orb: "Pick Pilot's voice, accent, and personality →".
- Confirm `VoiceSettings` exposes every requested control (it does: language, voice w/ gender filter, accent dropdown, personality presets, speed slow/normal/fast, Pilot name, live preview button). No schema work needed.

---

## 2. ~30s response latency — root cause

Measured pipeline stages (from code, not yet from live trace — Step A below will confirm with `ai_gateway_logs`):

| Stage | Current | Notes |
|---|---|---|
| STT (`/api/stt` → Whisper) | ~1–2s | Synchronous; client waits for `await sttRes.json()` before doing anything else. |
| LLM TTFB (Gemini 3 flash preview via Lovable AI) | ~1–3s typical, but the **system prompt is enormous** — `buildSystemPrompt` for "coach" pulls 25 ranked memories + active patterns + 14-day feedback summary + previous recommendation + full TZ block + live context. On a cold path that's 2–4k tokens of context the model has to read before emitting a token. | Biggest single contributor to slow first token. |
| LLM completion to end | 2–8s | Replies are long (P3 below). |
| TTS (`/api/tts`) | ~600–1200ms per chunk | Already chunked sentence-by-sentence — good. |
| Filler audio | Fires after STT returns, **not** at mic-stop | So the user hears nothing for the full STT roundtrip (~1.5s) before the filler even starts. |

The ~30s the tester sees is the sum of (1) STT silence + (2) huge prompt assembly + (3) long completion + (4) first TTS chunk. The streamed-TTS path works, but the user only hears it after the first sentence lands, which can be 6–10s in.

### Fixes (in order of impact)
1. **Trim the voice system prompt aggressively.** For `surface: "voice"` reduce ranked memories from 25 → 5, drop the feedback summary and previous-recommendation blocks (text-chat only), keep TZ block compact (one line, not four). Target: <600 tokens of system context. Expected TTFB drop: 1.5–3s.
2. **Pre-generate filler audio** as 6 static MP3 files under `public/audio/fillers/` and start playback the instant the user releases the mic (before STT returns). Acknowledge < 800ms guaranteed.
3. **Parallelise STT + filler** — already partly done; move the filler call to the mic-stop callback, not after STT.
4. **Cap completion length server-side** for `surface: "voice"` via `max_tokens: 180` on the upstream call (currently unbounded). This halves end-to-end on long answers.
5. **Add stage timing logs** at every boundary (`stt_ms`, `prompt_build_ms`, `ttft_ms`, `tts_first_ms`, `total_ms`) so we can prove the fix and catch future regressions. Log via existing `logAIRequest`.
6. **(Investigate, not commit)** switch the voice path to `google/gemini-3.1-flash-lite` if Step A's traces show Gemini-3-flash TTFB > 2.5s consistently. Lighter model = faster first token; quality is fine for 2–4 sentence conversational replies.

Target after fixes: filler audible < 800ms, first real word < 2.5s, full reply < 8s.

---

## 3. Replies too long — root cause

`PILOT_VOICE_SYSTEM` already says "2 to 4 short sentences", but:
- No server-side length cap — the model freely overshoots.
- The `expand: true` branch adds "up to ~6 sentences" which can leak into normal turns if the flag is ever sticky.
- The prompt mixes "ask one clarifying question" with "give the best single tip", so the model often does both.

### Fix
- Add `max_tokens: 180` to the upstream chat call when `surface === "voice"` and `expand !== true`.
- Tighten `PILOT_VOICE_SYSTEM`: "Default to 1–3 sentences (~10–20 seconds spoken). Never exceed 4 sentences unless the user says 'tell me more' or 'details'."
- Server-side trim: after streaming completes, if the reply has > 4 sentences and `expand !== true`, the UI's "Tell me more" chip is already there to expand — no truncation needed mid-stream (would break TTS).
- The existing "Tell me more" chip remains as the user-controlled depth toggle.

---

## 4. Voice UX polish — verification matrix

Will verify on iPhone Safari + Desktop Chrome with Playwright + manual:
- **Barge-in**: tap-to-interrupt path exists (`onMicTap` cancels queue when `orbState === "speaking"`). Verify it also cancels the in-flight LLM stream (currently it doesn't — the SSE reader keeps draining; need to abort). Add `AbortController` to `/api/ai` fetch and abort on barge-in.
- **Markdown never spoken**: `stripMd()` is applied per chunk before TTS; verify across 10 sample prompts.
- **Conversational transcripts**: covered by P3 prompt tightening.
- **Streaming starts on first sentence**: `takeSpeakableChunks` already flushes at `. ! ?`. Verified in code; will confirm with timing logs.

---

## Investigation Step A (before code)

Use `ai_gateway_logs--list_ai_gateway_requests` filtered to `model: google/gemini-3-flash-preview` over the last 48h, then `get_ai_gateway_request` on 3–5 coach calls to capture real prompt token counts and durations. This confirms whether the bottleneck is prompt size (fix in P2 #1) or model choice (fix in P2 #6). I'll attach the numbers to the implementation PR.

---

## Deliverables when implementation lands
1. Stage-by-stage timing table from real traces, before + after.
2. Screenshots: Pilot screen with new "Voice & personality" chip; first-run nudge; trimmed reply length.
3. Short Playwright run proving barge-in cancels both audio and LLM stream.
4. Updated `PILOT_VOICE_SYSTEM` and `buildSystemPrompt` diff.

---

## Files that will change (preview only)
- `src/routes/pilot.tsx` — visible Voice chip under orb, first-run nudge, barge-in abort, filler-on-mic-stop, timing logs.
- `src/lib/ai/context.server.ts` — slimmer voice prompt (5 memories, no feedback/prev blocks, compact TZ).
- `src/lib/ai/prompts.server.ts` — tighter `PILOT_VOICE_SYSTEM` length rule.
- `src/lib/ai/gateway.server.ts` — accept `maxTokens`, forward to upstream.
- `src/routes/api/ai.ts` — pass `max_tokens: 180` for voice coach turns; emit timing log.
- `public/audio/fillers/*.mp3` — 6 pre-generated clips (created via the AI gateway script).

No DB schema changes. No new dependencies.

---

Approve and I'll start with **Investigation Step A** (pull real gateway timings), then implement P1 → P2 → P3 → P4 in that order.
