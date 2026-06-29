# Phase 1 — Avatar + Voice Platform Investigation

Desk research only. No code changed, no secrets requested. Pricing and latency figures are vendor-published as of 2026-06; verify before committing budget.

Scoring: **1 = poor, 5 = excellent.** "iOS Safari" weights highest because that is where we have repeatedly failed.

---

## A. Avatar Platforms

| Platform | Quality | Lip sync | Expressions | Emotion | iOS Safari | Desktop | API | SDK | Voice integ. | Perf (TTFB / FPS) | Scale | Cost | License | Maint. | Total |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **Simli** (WebRTC photoreal) | 4 | 5 | 3 | 3 | **5** | 5 | 5 | 5 | 5 (BYO TTS or built-in) | ~300 ms / 30 fps | 5 | ~$0.10/min | Commercial, no lock-in on voice | 5 | **63** |
| **HeyGen Interactive Avatar** | **5** | 5 | 4 | 4 | 4 (WebRTC works; iOS LiveKit quirks) | 5 | 5 | 4 | 4 (their TTS preferred, BYO via text-input) | ~1.5–2 s / 25–30 fps | 5 | $0.12–0.30/min + plan floor | Commercial, avatar-owned likeness | 4 | **62** |
| **Tavus CVI** | 5 | 5 | 4 | 4 | 4 | 5 | 5 | 4 | 4 (built-in pipeline) | ~600 ms–1 s | 5 | $0.15–0.25/min | Commercial, cloned-avatar terms | 4 | **62** |
| **D-ID Agents** | 4 | 4 | 3 | 3 | 4 | 5 | 4 | 4 | 4 (ElevenLabs partner) | ~800 ms–1.2 s | 4 | $0.10–0.20/min | Commercial | 4 | **55** |
| **Soul Machines** | 5 | 5 | 5 | **5** | 3 (heavy WebGL) | 5 | 4 | 3 | 4 | ~1–2 s / variable | 3 | Enterprise ($$$$) | Heavy contract | 2 | **51** |
| **Live2D Cubism** | 3 (stylized) | 4 (viseme) | 4 | 3 | 5 | 5 | 3 | 4 | 5 (any TTS) | local / 60 fps | 5 | Free <$10M rev | Cubism license | 3 | **57** |
| **Rive State Machine** | 2 (vector) | 2 | 3 | 2 | 5 | 5 | 4 | 5 | 5 | local / 60 fps | 5 | Free runtime | MIT runtime | 5 | **53** |
| **RPM + Three.js** (baseline) | 3 | 2 | 2 | 2 | **2** (KTX2/Meshopt fragile) | 4 | 3 | 3 | 5 | local / 30–60 fps | 4 | Free | MIT | 2 | **42** |

### Headline read

- **Simli wins on iOS reliability + latency.** It was designed for voice-agent UX and exposes a documented WebRTC SDK that works in Mobile Safari without WebGL acrobatics.
- **HeyGen / Tavus win on visual fidelity.** Use when "is this a real person?" matters more than 300 ms.
- **Soul Machines** is the only true "digital human" but contracts and weight rule it out for launch.
- **Live2D / Rive** are the right local-render fallback if every cloud option fails QA.
- **RPM + Three.js (current) ranks last** — confirms the pivot.

---

## B. Voice Platforms

| Platform | Naturalness | Emotion | TTFB | Streaming | Languages | iOS audio | Cost | License | Notes |
|---|---|---|---|---|---|---|---|---|---|
| **ElevenLabs Flash v2.5** | 4 | 3 | ~75 ms | ✅ | 32 | ✅ | $0.05–0.10/min | Commercial | Fastest ElevenLabs tier; default candidate. |
| **ElevenLabs Turbo v2.5** (current) | **5** | 4 | ~250 ms | ✅ | 32 | ✅ | $0.08–0.15/min | Commercial | Highest realism we've tested. |
| **OpenAI Realtime (gpt-4o-realtime)** | 5 | **5** | ~300 ms speech-to-speech | ✅ (WebRTC) | many | ✅ | ~$0.06/min audio in + $0.24/min out | Commercial | Speech-to-speech: skips STT+LLM+TTS round-trip. |
| **Cartesia Sonic 2** | 4 | 3 | ~90 ms | ✅ | many | ✅ | ~$0.04/min | Commercial | Lowest TTFB of pure TTS. |
| **PlayHT 3.0 mini** | 4 | 3 | ~150 ms | ✅ | many | ✅ | ~$0.05/min | Commercial | Solid alt to ElevenLabs. |
| **Hume EVI 2** | 4 | **5** | ~500 ms | ✅ | en + few | ✅ | ~$0.10/min | Commercial | Reads user emotion; heaviest pipeline. |
| **Deepgram Aura-2** | 3 | 2 | ~40 ms | ✅ | en | ✅ | ~$0.03/min | Commercial | Fastest, least premium. |

### Headline read

- **Keep ElevenLabs as the realism anchor.** It already passed our hardware QA.
- **OpenAI Realtime is the only way to drop end-to-end latency below ~700 ms** because it removes the STT/LLM/TTS round-trip — but it locks voice quality to OpenAI's catalog.
- **Cartesia Sonic** is the dark-horse alternative if Eleven costs balloon.

---

## C. Top 3 Avatar × Voice Combinations (recommended POC set)

| # | Combo | Why | Risk |
|---|---|---|---|
| **1** | **Simli + ElevenLabs Flash v2.5** | Lowest mobile latency, best iOS Safari odds, keeps our verified voice. | Avatar realism a notch below HeyGen. |
| **2** | **HeyGen Interactive Avatar + ElevenLabs Turbo v2.5** | Highest photoreal fidelity end-to-end; HeyGen's text-in mode lets us drive their lip sync with Eleven audio. | HeyGen TTFB ~1.5 s, plan floor cost. |
| **3** | **Tavus CVI + OpenAI Realtime** | Single-vendor conversational pipeline, lowest implementation effort, strongest emotional realism. | Vendor lock-in; cost ladder steepest. |

---

## What I need from you next

Approve which of the three combos to actually build in Phase 2. Each requires me to request one new API key via `add_secret`:

- **Combo 1:** `SIMLI_API_KEY` (already have `ELEVENLABS_API_KEY`)
- **Combo 2:** `HEYGEN_API_KEY`
- **Combo 3:** `TAVUS_API_KEY` + `OPENAI_API_KEY`

Reply with the combo numbers you want POC'd (e.g. "build 1 and 2") and I'll move to Phase 2.
