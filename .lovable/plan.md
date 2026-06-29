# AI Companion Avatar — Investigation, POC, and Recommendation

No production code will be touched until you approve the winning stack after Phase 4. All POC work lives behind `/lab/*` routes and is gated from the main app.

---

## Phase 1 — Investigation (Desk Research)

Deliverable: a comparison matrix saved to `docs/avatar-poc/PHASE1_MATRIX.md`.

### Avatar platforms evaluated
1. **HeyGen Interactive Avatar (Streaming API)** — photoreal, WebRTC, server-driven lip sync.
2. **D-ID Agents / Live Portrait** — photoreal, WebRTC stream from a still image or preset avatar.
3. **Simli** — low-latency (sub-300ms) WebRTC photoreal avatars built for voice agents.
4. **Tavus CVI (Conversational Video Interface)** — photoreal cloned avatars, WebRTC.
5. **Soul Machines** — premium digital humans, enterprise pricing.
6. **Ready Player Me + Three.js (current)** — included as the baseline we are replacing.
7. **Live2D Cubism Web** — stylized 2D, viseme-driven.
8. **Rive State Machine** — vector, hand-authored states.

### Voice platforms evaluated
1. **ElevenLabs** (current) — Turbo v2.5 / Flash v2.5, multilingual, streaming.
2. **OpenAI Realtime API (gpt-realtime / gpt-4o-realtime)** — speech-to-speech, lowest latency.
3. **Cartesia Sonic** — ~90ms TTFB streaming TTS.
4. **PlayHT 3.0 / Play 3.0 mini** — conversational TTS, streaming.
5. **Hume AI EVI 2** — emotionally aware voice.
6. **Deepgram Aura-2** — fastest streaming TTS, lower realism.

### Scoring axes (1–5, with notes)
Avatar quality · lip sync · facial expressions · emotional realism · iPhone Safari · Desktop (Mac/Win) · API quality · SDK quality · Voice integration · Performance (TTFB, FPS) · Scalability · Cost ($/min) · Licensing · Long-term maintenance.

### Output of Phase 1
- Filled matrix in `docs/avatar-poc/PHASE1_MATRIX.md`.
- Shortlist: **Top 3 avatar + voice combinations**, ranked, with rationale.
  - Likely candidates (pre-research hypothesis, subject to change):
    1. **Simli + ElevenLabs Flash v2.5** — lowest latency photoreal.
    2. **HeyGen Streaming + ElevenLabs Turbo v2.5** — highest photoreal fidelity.
    3. **D-ID Agents + OpenAI Realtime** — simplest end-to-end stack.

---

## Phase 2 — Proof of Concept (Isolated)

Build one POC route per shortlisted combo. **Not wired into `/companion`, `/`, or any production surface.**

### Route layout
```
src/routes/lab/
  avatar-poc.index.tsx       # picker: choose combo 1/2/3
  avatar-poc.simli.tsx       # combo 1
  avatar-poc.heygen.tsx      # combo 2
  avatar-poc.did.tsx         # combo 3
```
Each route is `noindex`, behind a `?key=` query gate to avoid casual discovery, and renders only the avatar + a single text input + state HUD.

### Feature checklist per combo
- Real photoreal avatar visible in <2s
- Natural blinking (idle)
- Breathing / micro-motion
- Eye saccades / gaze
- Listening state (mic open, no speaking)
- Thinking state (between user finish and first audio)
- Speaking state with real-time lip sync
- Streaming voice (TTFB measured)
- Smooth state transitions (no pop)
- Latency budget: user-stop-talking → first audio < 1.2s target

### Server wiring
- Per provider, one `/api/lab/<provider>/session.ts` server route that mints short-lived session tokens (no provider keys in client).
- Secrets requested via `add_secret` only after you approve a provider to test (HEYGEN_API_KEY, DID_API_KEY, SIMLI_API_KEY, etc.). Nothing requested upfront.
- ElevenLabs uses existing `ELEVENLABS_API_KEY`.

### Instrumentation
- `docs/avatar-poc/perf.md` records TTFB, FPS, dropped frames, CPU/GPU hints, audio glitches, per device.

---

## Phase 3 — Hardware Testing

You run a fixed script on each combo across:
- iPhone Safari (your device)
- Android Chrome
- Mac Safari
- Windows Chrome
- Windows Edge

For each: PASS/FAIL on performance, stability, latency, voice quality, avatar quality, battery (qualitative), and browser compat. Results captured in `docs/avatar-poc/PHASE3_RESULTS.md`. I cannot run these — you'll fill in the matrix and reply with the data.

---

## Phase 4 — Recommendation

Final deliverable in `docs/avatar-poc/RECOMMENDATION.md`:
- Winning avatar platform + why
- Winning voice platform + why
- Estimated implementation effort (days)
- Estimated monthly operating cost at three usage tiers (100 / 1k / 10k active users)
- Known limitations
- Screenshots / screen recordings from the POC (you capture on device, I embed)
- Go/No-Go: whether quality is sufficient to be RestPilot's flagship

Only after you approve does production integration begin — that becomes a separate plan.

---

## What I need from you to start

1. **Approval to begin Phase 1** (desk research, no secrets, no code).
2. After Phase 1, approval of which 1–3 combos to actually POC in Phase 2 (each commercial provider POC needs an API key).

Reply **approve Phase 1** to start. I will hold all production code as-is until Phase 4 sign-off.
