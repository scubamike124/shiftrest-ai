# Phase 1 — Premium AI Companion Voice System (Investigation)

**Scope:** Research only. No code changes until approved.

---

## 1. Provider Comparison (as of June 2026)

| Dimension | **ElevenLabs** (v3 / Turbo v2.5 / Flash) | **OpenAI Realtime** (gpt-realtime / gpt-4o-mini-tts) | **Cartesia** (Sonic-2 / Sonic-Turbo) | **Hume AI** (Octave / EVI 3) |
|---|---|---|---|---|
| Voice realism | Best-in-class. v3 has the most human prosody, breath, micro-pauses available in TTS today. | Very high on Realtime (speech-to-speech keeps emotion). Mini-tts is good, not class-leading. | Very high, slightly "clean studio" — less breathy than EL v3 but extremely consistent. | High + uniquely expressive; voice acts emotion from context (laughs, sighs). Sometimes overacts. |
| Emotional expression | Explicit `voice_settings` + v3 audio tags (`[whisper]`, `[sigh]`). Excellent. | Implicit via `instructions` ("speak warmly, slowly"). Good but less controllable. | Emotion via `emotion` controls + speed. Good, more neutral baseline. | Strongest — model infers emotion from text + context. Best for empathy. |
| Conversational quality (turn-taking, barge-in) | TTS only — turn-taking is on us. | Native full-duplex speech-to-speech with server-side VAD, barge-in, interruption. Best in class. | TTS + Sonic streaming; Cartesia Line gives realtime agent loop. | EVI is full-duplex realtime, strong empathy, weaker latency. |
| Latency (first audio byte) | Flash v2.5 ≈ 75 ms; Turbo v2.5 ≈ 250–300 ms; v3 ≈ 500–800 ms (not realtime). | ~300–500 ms end-to-end realtime. | Sonic-Turbo ~40–90 ms TTFB — lowest in market. | ~500–900 ms — slowest of the four. |
| Reliability / API stability | Mature, multi-region, 99.9% SLA on Scale tier. Occasional rate-limit spikes. | Very stable, but Realtime API still GA-recent; breaking changes possible. | Very stable, smaller footprint; fewer reported outages. | Smallest provider, more variance. |
| Pricing (typical) | ~$0.10–0.30 / 1K chars on Creator/Pro; ~$0.05 Flash; enterprise volume discounts. | TTS ~$0.015/min input + $0.030/min output (mini-tts); Realtime ~$0.06/min audio in + $0.24/min out. Most expensive at scale. | ~$0.02–0.05 / 1K chars Sonic; cheapest premium tier. | ~$0.10/min EVI; mid-range, no large-scale discounts published. |
| Scalability | Concurrent stream caps by plan; Scale/Enterprise required for >50 concurrent. | Pay-as-you-go, no concurrency cap, but cost scales hard. | High concurrency on standard tier; built for agent workloads. | Lower concurrency ceiling. |
| Multi-language | 32+ languages, v3 strong cross-lingual. | ~50+ via gpt-4o stack. | ~15 languages, English-best. | ~10 languages. |
| Long-conversation consistency | Excellent with request stitching (`previous_text`/`next_text`). | Excellent (single session keeps context). | Excellent; voice drift minimal. | Good; some emotion drift over very long turns. |
| Commercial licensing | Clear, included on Creator+ plans. Voice cloning consented. | Clear, OpenAI ToS. | Clear, commercial-friendly. | Clear, but stricter on cloned voices. |

---

## 2. Recommendation

### Primary: **ElevenLabs** (Turbo v2.5 for live chat, v3 for narration/sleep)
- Best perceived realism — the single biggest driver of "premium" perception.
- Audio tags (`[whisper]`, `[soft]`, `[warm]`) map 1:1 to RestPilot modes (sleep / morning / encouraging).
- Streaming MP3/PCM already wired in the codebase (`/api/tts-elevenlabs`).
- Request-stitching solves long-form coherence — important for guided wind-downs.

### Fallback (auto): **OpenAI gpt-4o-mini-tts** via Lovable AI Gateway
- Already integrated (`/api/tts`).
- No extra key, billed in Lovable credits, multi-region.
- Quality gap vs. ElevenLabs is audible but acceptable as a safety net.
- Current session-level `elevenLabsBlocked` switch already implements this pattern — keep it.

### Future option (Phase 2, separate decision): **OpenAI Realtime** for full-duplex "talk over me" conversation
- Only adopt when product demands true barge-in (interrupting Aura mid-sentence). For today's request/reply loop, ElevenLabs streaming is the right call and ~3-5× cheaper.

### Not recommended now
- **Cartesia** — excellent and cheapest, but voice library is smaller and less "warm" than EL for a wellness brand. Revisit if EL pricing becomes a problem at scale.
- **Hume** — best empathy demo, weakest latency and smallest scale. Watch but don't depend on.

---

## 3. Proposed Architecture

```text
            ┌──────────────────────────────┐
   client ─►│  /api/tts  (router)          │
            │   mode: normal|sleep|morning │
            └─────┬──────────────────┬─────┘
                  │ primary          │ fallback (auto on 5xx / 2.5s stall)
                  ▼                  ▼
        ElevenLabs streaming     OpenAI gpt-4o-mini-tts
        (Turbo v2.5 / v3)        (Lovable AI Gateway)
                  │                  │
                  └────► PCM/MP3 stream ────► Web Audio graph (existing)
```

- **Single unified endpoint** `/api/tts` selects provider; today's split (`/api/tts-elevenlabs` + `/api/tts`) collapses into one router for clean fallback.
- **Streaming-first:** request `output_format=mp3_44100_128` (current) for v2.5; PCM for Realtime later.
- **Stall watchdog:** keep the existing 2.5 s TTFB abort → mark `elevenLabsBlocked` for the session → fallback.
- **Cache:** SHA-256(`provider:voiceId:mode:text`) → blob cache for fixed strings (greetings, brief intros, sleep cues). ~30-50% cost reduction on repeats.
- **Per-mode tuning:**
  - `normal` → Turbo v2.5, stability 0.45, similarity 0.75, style 0.35
  - `sleep`  → v3 with `[whisper][soft]`, stability 0.65, speed 0.92
  - `morning`→ Turbo v2.5, stability 0.40, style 0.55, speed 1.05
  - `encouraging` → Turbo v2.5, style 0.50

---

## 4. Voice Lineup (4 curated personalities)

| Slot | ElevenLabs voice | Fallback (OpenAI) |
|---|---|---|
| Calm Female (default) | `Sarah` — EXAVITQu4vr4xnSDxMaL | `alloy` |
| Calm Male | `George` — JBFqnCBsd6RMkjVDRZzb | `onyx` |
| Warm British | `Charlotte` or `Alice` — Xb7hH8MSUJpSbSDYk0k2 | `nova` |
| Soft Australian | `Matilda` — XrExE9yKIg1WjnnlVkGX | `shimmer` |

All four pre-QA'd in normal + sleep + morning modes before ship.

---

## 5. Estimated Operating Cost

Assumptions: average user has 6 voice turns/day × ~150 chars = ~900 chars/day.

| Users | EL Turbo v2.5 (~$0.10/1K) | OpenAI mini-tts | With 40% cache hit |
|---|---|---|---|
| 1,000 | ~$2,700/mo | ~$540/mo | ~$1,620/mo (EL) |
| 10,000 | ~$27,000/mo | ~$5,400/mo | ~$16,200/mo (EL) |
| 100,000 | EL Enterprise contract needed — target ~$0.04/1K → ~$108K/mo | ~$54K/mo | ~$65K/mo (EL) |

At launch (<10K DAU), EL primary is well within budget. At scale, negotiate EL Enterprise or shift heavy non-emotional traffic (confirmations, timers) to OpenAI mini-tts and reserve EL for emotional content.

---

## 6. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| EL outage | Session-scoped fallback to OpenAI (already in code; keep). |
| EL price hike | Mode-based routing — only sleep/morning forced to EL; confirmations route to OpenAI. |
| iOS streaming stalls (the bug we just fixed) | Keep TTFB watchdog at 2.5 s; keep `outputWarmed` once-per-session; do NOT re-introduce per-chunk warm-up. |
| Voice drift over long sessions | Use ElevenLabs request stitching (`previous_text`/`next_text`) for chunked replies. |
| Licensing | Use only the curated 4 official EL library voices — no cloning, no third-party voice IDs. |

---

## 7. Final Recommendation

**Adopt ElevenLabs as primary (Turbo v2.5 default, v3 for sleep), OpenAI gpt-4o-mini-tts via Lovable AI Gateway as automatic fallback.** Collapse the two existing TTS routes into one mode-aware router with stall-detect failover and a small content cache. Ship 4 curated voices, each tuned per mode.

This is the highest-realism stack available today, keeps a free first-party safety net, reuses ~80% of the audio pipeline already shipped, and stays within budget through 10K DAU without renegotiation.

---

## Next Step

Awaiting approval to proceed to **Phase 2 — Implementation**:
1. Unified `/api/tts` router + mode-aware voice settings
2. Curated 4-voice catalog + picker UI
3. Per-mode prosody presets (sleep whisper, morning energy)
4. Response cache for repeated phrases
5. Real-device QA matrix across all 4 voices × 3 modes
