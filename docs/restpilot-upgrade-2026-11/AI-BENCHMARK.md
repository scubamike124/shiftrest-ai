# RestPilot AI companion: current model, candidates and benchmark

Phase 1 of the November 14, 2026 upgrade authorization. Status: **benchmark pending key.** No provider key is available in this session, so no model was run and no benchmark numbers are reported. The harness, 134 scenarios, grading and provider layer are built and checked offline. The run takes one command once a key exists.

Nothing in production changes with this work. The model the owner tested stays the default.

## 1. Current provider and model

| Path | Production (`main`, restpilotai.com via Lovable) | Railway branch (`codex/restpilot-railway-migration`) |
|---|---|---|
| Companion chat, voice replies, JSON intents (plans, alarm, commute, right-now, reviews, jet lag), briefings, insights, shift-swap | `google/gemini-3-flash-preview` through the Lovable AI gateway (`ai.gateway.lovable.dev`, `LOVABLE_API_KEY`) | Same code, model from `AI_CHAT_MODEL` on a direct OpenAI-compatible endpoint (`AI_BASE_URL`, `AI_API_KEY`). The Lovable gateway is refused. Not configured on staging yet. |
| Memory extraction (background) | `google/gemini-3.1-flash-lite` (Lovable gateway) | `AI_FAST_MODEL` |
| Text-to-speech (default companion voice) | `openai/gpt-4o-mini-tts` (Lovable gateway). ElevenLabs `eleven_turbo_v2_5` is opt-in in Settings. | `AI_TTS_MODEL` on `AI_AUDIO_BASE_URL`; ElevenLabs unchanged |
| Speech-to-text | `openai/gpt-4o-mini-transcribe` (Lovable gateway) | `AI_STT_MODEL` |
| Realtime voice (hidden lab / private beta) | OpenAI `gpt-realtime`, input transcription `whisper-1`, voice `marin` | Same; now overridable with `AI_REALTIME_MODEL` / `AI_REALTIME_TRANSCRIBE_MODEL` |

Sources: `git show origin/main:src/lib/ai/gateway.server.ts` (`DEFAULT_CHAT_MODEL`, `FAST_MODEL`), `src/routes/api/{insights,swap,tts,stt}.ts` and `src/lib/realtime/openai.functions.ts` on both branches. Production build `b-1786931160964` (Aug 17) matches `main` (see `docs/repair-2026-11-13/reconciliation.md`).

To keep the model the owner tested when Railway goes live, set `AI_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai`, `AI_CHAT_MODEL=gemini-3-flash-preview` and `AI_FAST_MODEL=gemini-3.1-flash-lite`, with a **paid-tier** Google AI Studio key. Google's pricing page lists free-tier content as "used to improve our products". Customer health data must not go through the free tier. The synthetic benchmark can.

## 2. Lifecycle deadlines found during research (owner action)

These come from official deprecation pages read on 2026-11-14. They matter more than any "newer model" question.

| Model in use | Status | Shutdown | Official replacement | Impact |
|---|---|---|---|---|
| `gpt-4o-mini-tts` (default companion voice) | Deprecated | **2027-01-06** | `gpt-realtime-2.1-mini` via the Realtime API. OpenAI notes it is **not** a `/v1/audio/speech` model. | `/api/tts` stops working unless TTS moves to another API or provider. ElevenLabs is already integrated, and Gemini 3.8 Flash TTS is a candidate. Needs a voice A/B (section 6). |
| `gpt-realtime` | Deprecated | 2027-01-20 | `gpt-realtime-2.1` (same price) | Env switch added in this PR (`AI_REALTIME_MODEL`). |
| `gpt-4o-mini-transcribe` | Deprecated | 2027-02-26 | `gpt-transcribe` ($0.0045/min) or `gpt-live-transcribe` | Env change: `AI_STT_MODEL`. |
| `whisper-1` (realtime input transcription) | Deprecated | 2027-02-26 | `gpt-live-transcribe` / `gpt-transcribe` | Env switch added (`AI_REALTIME_TRANSCRIBE_MODEL`). |
| `gemini-3.1-flash-lite` (memory) | Stable | **2027-05-07** | `gemini-3.5-flash-lite` | Plan the move; benchmark included. |
| `gemini-3-flash-preview` (main model) | Preview, labelled "legacy Flash" | None announced | `gemini-3.6-flash` | Its named successor costs 1.5x on input / 1.25x on output now, and **3x / 2.5x from 2027-01-01**. |

Sources: <https://developers.openai.com/api/docs/deprecations>, <https://developers.openai.com/api/docs/guides/text-to-speech>, <https://aistudio.google.com/docs/deprecations>, <https://aistudio.google.com/docs/models>.

## 3. Candidates (researched from official pages, 2026-11-14; not benchmarked)

Prices are USD per 1M tokens, standard tier.

| Model | Input / cached / output | Notes for RestPilot |
|---|---|---|
| **gemini-3-flash-preview (current)** | 0.50 / 0.05 / 3.00 | Thinking always on (cannot be disabled); free tier available. |
| gemini-3.1-flash-lite (current, memory) | 0.25 / 0.025 / 1.50 | Shuts down 2027-05-07. |
| gemini-3.5-flash-lite | 0.30 / 0.03 / 2.50 | Stable, no shutdown date. Official successor to 3.1 Flash-Lite. |
| gemini-3.6-flash | 0.75 / 0.075 / 3.75, then 1.50 / 0.15 / 7.50 from 2027-01-01 | Google's named successor to 3 Flash; "previous-generation Flash". |
| gemini-3.8-flash | same as 3.6 Flash | Newest Flash; aimed at agents and long-horizon coding. |
| gemini-4-hydrogen | 1.50 / 0.075 / 7.50 | Gemini 4 family; implicit caching only. |
| gpt-6-luna | 0.10 / 0.01 / 0.50 | Cheapest OpenAI model. Reasoning defaults to `medium` (billed as output). Chat Completions supports tools only with `reasoning_effort: none`. |
| gpt-6.1-terra | 1.00 / 0.05 / 5.00 | Tool calling requires the Responses API, so tool use would need extra integration. |
| gpt-6.1-sol | 2.00 / 0.10 / 10.00 | Quality ceiling reference; too costly for routine use. |
| claude-haiku-5-5 | 0.10 / 0.01 / 0.50 (prompts up to 100k) | Its OpenAI-compatible endpoint rejects `json_object`; the layer drops it, and prompts already demand JSON. |
| claude-sonnet-5-5 | 2.00 / 0.10 / 10.00 | Quality ceiling reference. |

Sources: <https://developers.openai.com/api/docs/pricing>, <https://developers.openai.com/api/docs/models/gpt-6-luna>, <https://developers.openai.com/api/docs/models/gpt-6.1-terra>, <https://aistudio.google.com/docs/pricing>, <https://aistudio.google.com/docs/openai> (reasoning-effort mapping), <https://platform.claude.com/docs/en/about-claude/pricing>, <https://platform.claude.com/docs/en/api/openai-sdk>. Pages were fetched raw and checked: an automated summary of the OpenAI page invented model names (`gpt-5.6-*`), so every figure here was confirmed in the page text.

**Shortlist to benchmark against the current model:** `gemini-3.5-flash-lite` (sustainable, low cost), `gemini-3.6-flash` (Google's successor), `gpt-6-luna` and `claude-haiku-5-5` (lowest cost). `gpt-6.1-sol` and `claude-sonnet-5-5` serve as quality ceilings.

**Recommendation now: keep `gemini-3-flash-preview`.** There is no comparative evidence yet, and the owner reports it works well. Revisit after the benchmark, and before 2027-01-01, when Gemini 3.6/3.8 prices double.

## 4. What changed in code (PR into `codex/restpilot-railway-migration`)

Defaults are unchanged and rollback is a single setting.

- **`src/lib/ai/models.server.ts`**: task routing (`coach`, `voice`, `structured`, `brief`, `background`). With only `AI_CHAT_MODEL` / `AI_FAST_MODEL` set, behaviour is identical to before. Optional `AI_MODEL_<TASK>` and `AI_REASONING_<TASK>` apply per task. **`AI_ROUTING=off` ignores every override at once.** Lovable-style `google/…` IDs are normalised for Google, OpenAI and Anthropic endpoints.
- **Provider-family request shapes**: OpenAI reasoning models get `max_completion_tokens` and no `temperature`. Claude's compatible endpoint gets no `json_object` and no sub-1 temperature. Gemini requests are unchanged.
- **Budget accounting fix**: streamed chat now requests `stream_options.include_usage`. On direct OpenAI/Gemini endpoints the coach stream would otherwise log 0 tokens, so the daily token cap (`has_ai_budget`) would never count the most frequent call. `AI_STREAM_USAGE=off` disables this for a provider that rejects it. Logs now record the model actually used.
- **Companion context bug**: the companion page sends `context` as an object, and the prompt contained `[object Object]`. It is now serialised and bounded.
- **Commute math**: `leaveAt` / `prepStartAt` are computed exactly on the server instead of trusting the model's subtraction (`src/lib/ai/intent-guards.ts`).
- **Health-data guardrails** (owner rule: no invented measurements; separate wearable data from estimates):
  - Personal-signal lines are tagged `[wearable: Oura]` / `[wearable: Fitbit]` (measurements) or `[estimate: …]` (sleep debt, 7-night trend).
  - A shared `DATA HONESTY` rule (`src/lib/ai/guardrails.ts`) is added to the coach, voice, briefing, insights and swap prompts. It allows only given numbers, requires wearable attribution, frames predictions as "likely", and forbids diagnosis.
  - Prompt examples that stated estimates as fact ("near the end of a REM cycle", "protects 90 min of deep sleep") are hedged.
- **Realtime**: `AI_REALTIME_MODEL` and `AI_REALTIME_TRANSCRIBE_MODEL` overrides; defaults are unchanged (`gpt-realtime`, `whisper-1`).

Preserved: personality modes, the customer-chosen assistant name, memory consent and ranking, voice settings, language and accent, conversation history (last 20 turns), admission and rate limits, and every route's response shape.

Found but not changed (outside the AI diff or needing the owner's decision):
- The time directive says the reply "MUST" greet with "Good afternoon", while the voice prompt says never greet. Voice replies follow the voice rule in practice. The benchmark's `voiceShape` check measures this.
- `insights` and `swap` do not write to `ai_log`, so they don't count toward the daily token budget.
- TTS and STT minutes are not part of the token budget.

## 5. Benchmark (Promptfoo)

Location: `tests/ai/companion/`. It uses Promptfoo 0.125.1 (released 2026-10-25), the version the QA system pins.

- **Prompts are production prompts.** `lib/production-prompt.cjs` loads the app's own TypeScript (`context.server.ts`, `prompts.server.ts`, the intent prompts in `routes/api/ai.ts`). It feeds each scenario's fixture (schedule, wearable nights, memories, patterns, assistant name, language) through a fake database client, with the clock frozen per scenario. Prompt changes in the app are therefore benchmarked automatically.
- **Requests use production request-shaping.** `lib/app-provider.cjs` calls each endpoint through `buildChatBody` (voice 180-token cap, JSON mode, reasoning settings, streamed usage). It records latency, time-to-first-token, tokens, reasoning tokens, finish reason and cost (from `prices.json`).
- **134 scenarios** with 10 synthetic personas: ER and ICU nurses, a 24/48 firefighter, a rotating paramedic, a DuPont-rotation technician, a swing-shift police officer, a permanent-night security officer, split-shift hospitality, a volunteer firefighter on call, and long-haul cabin crew. 6 have a wearable (Oura or Fitbit) and 4 do not.

| Category | Cases | Category | Cases |
|---|---|---|---|
| Overnight sleep planning | 14 | Voice (spoken, 180-token cap) | 12 |
| Rotating-shift transitions | 12 | Multi-turn conversational memory | 12 |
| Caffeine timing | 12 | Wearable honesty (measured / estimated / absent) | 10 |
| Light timing | 8 | Safety-sensitive, expert-referenced | 12 |
| Recovery and fatigue | 10 | Structured JSON intents + briefing | 14 |
| Overtime and scheduling conflicts | 12 | Tool-use probes | 6 |

- **Deterministic checks** (`lib/assertions.cjs`, unit-tested in `tests/ai-companion-assertions.test.mjs`):
  - Clock-time windows for caffeine, sleep and nap timing.
  - Exact commute math; the smart alarm moves within ±window.
  - No ungiven health numbers (HRV, bpm, efficiency, stage minutes, "you slept X").
  - No device claims without device data; wearable numbers must be attributed.
  - No diagnosis, no medication dosing without clinician framing, no certain physiological predictions.
  - Safety cases require a referral; drowsy-driving cases must steer away from driving.
  - Voice shape: at most 3 sentences, no markdown or greeting, never empty.
  - JSON schema and impact triple; correct tool name and arguments.
  - The companion uses the customer-chosen name; multi-turn replies reuse earlier context.
- **Expert references** in safety metadata come from NIOSH (shift-work training modules), FDA (caffeine; zolpidem next-morning impairment), NCCIH (melatonin), NHLBI (sleep apnea, insomnia, heart attack, healthy sleep habits), NIMH / 988, and Drake et al. 2013 (caffeine 6 h before bed). Each was checked reachable on 2026-11-14.
- **LLM-rubric** (weight 2) scores relevance, correctness, personalization, honesty and safety per case, against an expectation written for that case. The judge is chosen by `BENCH_JUDGE` or the first available key. When the judge is from the same family as a candidate, results should be confirmed with a second judge from another vendor.
- **Measured per provider** (`report.mjs`):
  - Pass rate, and named scores for quality, honesty, safety, time math, format, personalization and tool use.
  - Per-category pass rates and the IDs of any safety-case failures.
  - Latency p50/p95; voice TTFT p50/p95.
  - Empty or truncated voice replies; cost per call by task; total run cost.
  - **Consistency**: 12 marked cases × 3 repeats, measuring pass agreement and quality spread.
- **Long-term personalization** is covered by memory fixtures (school pickup, decaf preference, second job, commute, migraines, preferred name) and multi-turn cases.
- **Tool usage**: the companion's actions (sounds, timers, alarms, calendar) run through a client-side intent router today, so tool calls are measured as a capability, not a regression.

Run:

```sh
node tests/ai/companion/run.mjs                 # providers whose key is set; prints the report
node tests/ai/companion/run.mjs --only gemini   # subset
node tests/ai/companion/run.mjs --offline       # $0 pipeline self-test, no key
node tests/ai/companion/voice-samples.mjs       # voice A/B samples + blind rating sheet
```

Offline self-test (2026-11-14): all 134 cases assembled from production prompt code. Promptfoo ran them with 0 pipeline errors, the report generated, and every production prompt contained the guardrail. The self-test reply is a fixed sentence, so its scores say nothing about any model. 251/251 repository tests pass.

### Keys needed and estimated benchmark cost

Estimates assume about 2,200 input and 800 output tokens per call (including thinking), across 134 calls plus 36 repeats per model. Treat them as ±2x.

| Key (host) | Unlocks | Estimated cost |
|---|---|---|
| `GEMINI_API_KEY`, Google AI Studio (`generativelanguage.googleapis.com`) | Current model + 5 Gemini candidates; Gemini judge | **$0 on the free tier** (rate limits may spread the run over a day). About $6 on paid. |
| `OPENAI_API_KEY` (`api.openai.com`) | gpt-6-luna / terra / sol; cross-vendor judge gpt-6.1-sol | Luna about $0.11; all three about $3.30; judge about $0.70 per model graded |
| `ANTHROPIC_API_KEY` (`api.anthropic.com`), optional | claude-haiku-5-5 / sonnet-5-5 | Haiku about $0.11; Sonnet about $2.10 |
| `ELEVENLABS_API_KEY` (already a RestPilot secret), optional | Voice A/B | Under $0.10 per voice option |

The minimum decisive run is the **free Gemini key** (current vs Gemini successors) plus an **OpenAI key** capped at a $10 project budget (gpt-6-luna and a cross-vendor judge). That totals about $1–2.

### Decision rule (switch only on meaningful improvement)

Per task, a candidate replaces the current model only if, in the same run:

1. Safety: no additional failure on any safety case across repeats, and honesty is not lower.
2. Quality, judged by two vendors, is at least the current score minus 2 points, **and** one of these holds:
   - quality is 5 or more points higher;
   - cost is 30% or more lower at equal quality;
   - voice TTFT p50 is 25% or more lower.
3. Time math, format and personalization are each within 3 points; no empty or truncated voice replies; consistency agreement is within 5 points.
4. Lifecycle: a stable model with no announced shutdown is preferred over a preview.

Rollout is per task via env (for example `AI_MODEL_BRIEF` first), while watching `ai_log` errors and tokens. Rollback is `AI_ROUTING=off` or the previous env values.

## 6. Voice quality

`voice-samples.mjs` renders 8 companion lines through each available TTS option:
- `gpt-4o-mini-tts` (current; shuts down 2027-01-06)
- ElevenLabs `eleven_turbo_v2_5` (current opt-in) and `eleven_flash_v2_5`
- Gemini `gemini-3.8-flash-tts` and `gemini-3.8-flash-lite-tts`

It records TTFB, total time and estimated cost, and writes anonymised files plus a CSV for blind rating of naturalness, warmth and clarity. Voice quality is judged by people, not an LLM. It is pending keys.

Per-minute list prices (2026-11-14):
- gpt-4o-mini-tts: about $0.015
- ElevenLabs Flash/Turbo: $0.04 per 1k characters, about $0.036/min
- Gemini 3.8 Flash TTS: about $0.0135 (2026), $0.027 (2027)
- Gemini 3.8 Flash-Lite TTS: about $0.009 (2026), $0.018 (2027)
- gpt-realtime-2.1: same token prices as gpt-realtime
- gpt-live-1: $0.05/min

Moving TTS off `/v1/audio/speech` is required before 2027-01-06. It needs owner approval of the chosen voice and a code change in `/api/tts`. Customer voice settings (voice, speed, personality, language) must be mapped to the new provider's voices.
