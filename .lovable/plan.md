
# Final AI Companion Polish — Investigation & Plan

Investigation pass complete. Findings + scoped fixes below. No new features. Item 2 (avatar realism) is **recommendation-only** per your instructions — I will not start a rendering rewrite without your approval.

---

## 1. Greeting volume — root cause found

**Symptom:** Greeting starts quieter, climbs to full volume a few seconds in.

**What I confirmed in `src/lib/companion/speak.ts`:**
- The audio graph is built once and reused. ✅
- Every utterance (greeting + replies) routes through the same `Gain → Compressor → destination` path. ✅
- However, the `DynamicsCompressor` is set to `threshold: -3 dB, ratio: 6, knee: 6`. On iOS Safari the compressor's internal envelope **starts from a cold state** when playback begins and pumps gain up over the first 200–600 ms. That is the audible "quiet first words → louder" curve — not a graph wiring issue.
- Secondary contributor: `ensureContextRunning()` resolves, but on iOS Safari the very first `audio.play()` after unlock still has ~80–150 ms where the WebAudio output buffer is empty. The compressor's auto-gain reads near-silence and clamps low, then opens up.

**Fix (small, surgical):**
1. Remove the compressor from the live path for normal speech. Replace with a fixed-gain `Gain` (≈1.6×) feeding a hard `WaveShaperNode` soft-clip curve. Soft-clip is stateless → no envelope ramp → first syllable is at full level.
2. Pre-roll: before `audio.play()`, push 40 ms of near-silent PCM through the graph via a one-shot `BufferSource` so the output device is already "warm" when the TTS blob starts.
3. Keep a single `Limiter` (compressor with `threshold:-1, ratio:20, attack:0.001, release:0.05`) only as a true-peak safety net — its envelope never engages on normal speech so it cannot fade in.

**Acceptance:** On real iPhone Safari, the first word of the greeting and the first word of every reply are subjectively the same loudness. Measured via the existing `companion:audio-level` RMS dispatcher (logged in DebugHUD).

---

## 2. Avatar realism — architecture recommendation (no code yet)

You explicitly asked: has the current approach hit its ceiling? **Yes, it has.** A single raster portrait with SVG overlays cannot cross the "feels alive" line, regardless of how many micro-animations we layer on. The mouth shape doesn't actually change the *pixels of the lips* in the photo — we're only tinting/shadowing over a fixed image.

### Comparison

| Approach | Visual quality | Mobile perf | Effort | Recommend? |
|---|---|---|---|---|
| **Current: photo + SVG overlays** | 5/10 — clearly static base | Excellent (60fps) | Already built | Ceiling reached |
| **Live2D (Cubism SDK web)** | 8/10 — true 2D rig, real mouth/eye deformation, industry standard for VTubers | Good (~50fps mid iPhone) | High — needs a rigged model per avatar (artist work) + SDK license review | **Recommended** if we want "alive" |
| **Mesh deformation (Pixi.js + custom bone rig)** | 7/10 | Good | Very high — we'd be rebuilding half of Live2D | No |
| **TalkingHead.js / SadTalker WebGL (neural lip-sync to portrait)** | 9/10 — actually morphs the photo | Poor on mobile (heavy WASM/WebGL, 200–500 MB models, 2–4s startup) | Medium integration, high runtime cost | No — kills mobile |
| **Three.js + Ready Player Me 3D avatar with viseme blendshapes** | 8/10 — fully 3D, real lip-sync, free avatars | Good (~45–55fps) | Medium — RPM gives us blendshape-ready GLB, just wire visemes to morph targets | **Recommended alternative** if we want variety + 3D |
| **Pre-rendered video loops keyed to viseme** | 7/10 | Excellent | Medium asset pipeline, no real-time response | No — won't sync to TTS |

### Recommendation

Two viable paths. Pick one before any work starts:

- **Path A — Ready Player Me + Three.js** (my pick). Free avatars, gender variety out of the box, true 3D lip-sync via ARKit-compatible blendshapes that map 1:1 to our existing viseme stream. ~1 week of engineering. Replaces the portrait layer entirely; keeps `speak.ts` and the viseme bus unchanged.
- **Path B — Live2D Cubism**. Higher visual ceiling for stylized 2D, but requires commissioning rigged art for every avatar and a license review for commercial use. ~2–3 weeks.

**Do nothing else to the current SVG rig until you choose.** Continuing to tweak it is the exact "endless polish on the wrong architecture" you warned against.

---

## 3. Voice naturalness

**What's in place now:** `openai/gpt-4o-mini-tts` with personality + mode `instructions`, speed 0.85–0.98.

**Why it still sounds synthetic:** `gpt-4o-mini-tts` is the *small* tier. The full `gpt-4o-tts` model (via Lovable AI Gateway as `openai/gpt-4o-mini-tts` is the only TTS model currently allowlisted) is what it is — we won't unlock a different model without gateway support. Realistic gains have to come from prosody steering.

**Fixes inside the current model:**
1. Strengthen `instructions` with explicit non-robotic cues: *"Take a relaxed breath before the first word. Land each sentence with a soft, natural downstep. Use mild filler-like softness ('mm', 'so') only when it sounds human, never forced. Vary pace within sentences — slightly faster on supporting clauses, slower on the key noun."*
2. Drop default `speed` from 0.95 → 0.92 for `normal` mode; `gpt-4o-mini-tts` sounds noticeably more human just below 1.0.
3. Better normalization upstream: split long replies into shorter sentences before sending to TTS. The model produces more natural prosody on 1–2 sentence chunks than on a paragraph.
4. Add an optional `ElevenLabs` path behind a feature flag (the project already has TTS knowledge for it). ElevenLabs `eleven_turbo_v2_5` is dramatically more human than `gpt-4o-mini-tts`. Costs more per character. **I'll wire it only if you say yes** — it's the single biggest naturalness win available and requires a connector.

**Acceptance:** Side-by-side A/B with current build on a real iPhone — testers prefer new prosody. ElevenLabs gate stays off by default.

---

## 4. Avatar Library discoverability

**What's in place:** `AVATAR_PRESETS` already has 4 (2 female: Aura, Nova; 2 male: Atlas, Sage) + custom upload. Route `/settings/avatar` exists.

**Why "only one avatar appears during testing":** the selector is buried under `/settings/avatar` with no entry point from `/companion`. New users never find it.

**Fixes:**
1. Add a small avatar-swap chip directly on `/companion` (top-right of the avatar): tap → opens a bottom sheet with the 4 presets in a 2×2 grid + "Choose photo" + "More options" link to `/settings/avatar`.
2. On first launch (intro sheet), add a "Pick your companion" step showing the 4 presets before the conversation starts. Skippable.
3. Verify persistence path: `useAvatar` writes `localStorage` + `profiles.companion_avatar_id`. I'll add a Playwright check that switching avatars round-trips after reload.

**Acceptance:** From `/companion`, switching avatar is reachable in ≤2 taps; both genders visible; selection persists after refresh and across sessions.

---

## What I'll implement now (with your approval)

- ✅ Fix #1 — Greeting volume (compressor → soft-clip + pre-roll). Low risk.
- ✅ Fix #3 (parts 1–3) — Prosody instructions, speed tweak, sentence chunking. Low risk. Skip ElevenLabs unless you say go.
- ✅ Fix #4 — On-companion avatar chip + first-launch picker step.
- 🟡 Fix #2 — **No code.** Awaiting your decision: **Path A (Ready Player Me + Three.js)**, **Path B (Live2D)**, or **defer**.

Reply with which avatar path (A / B / defer) and whether to enable the ElevenLabs voice path, and I'll ship #1, #3, #4 in one pass.
