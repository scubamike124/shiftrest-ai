# AI Companion — Final Polish Plan

Goal: move Nova from "working" to "premium." Reach a bar where a first-time user instantly feels they're talking to a real, calm assistant.

Implement in 6 focused passes. Each pass is independently shippable and behind feature-detection so we can stop and tune at any point.

---

## Pass 1 — Layered Facial Rig (replace single-image lip-sync)

The painted portrait has hit its ceiling. We keep the portrait as the base layer but add a thin **2.5D facial rig** on top — purely CSS/SVG, no new dependencies, no model loading.

Architecture:

```text
src/components/companion/
  Avatar.tsx                 (orchestrator — unchanged API)
  rig/
    FaceRig.tsx              (positions overlay layers over portrait)
    MouthRig.tsx             (upper lip, lower lip, corners, inner shadow)
    JawRig.tsx               (lower-third translate + scaleY, masked)
    CheekRig.tsx             (two soft warm radial gradients)
    BrowRig.tsx              (existing brows, moved here + rotation)
    EyeRig.tsx               (eyelids, saccades, gaze targets)
    visemes.ts               (amplitude+text → viseme weights)
    expressions.ts           (named expression presets → rig weights)
```

Mouth rig (the big upgrade): two thin SVG paths (upper + lower lip) plus two corner anchors and an inner-mouth radial shadow. We animate **path d-attribute** between viseme shapes using a tiny tween (rAF + cubic interp on control points). Visemes we ship:

- `REST` — closed neutral
- `MBP` — fully closed, slight press (consonants M/B/P)
- `FV` — upper teeth on lower lip (slight under-bite shape)
- `AI` — wide open vowel
- `O` — rounded
- `EE` — wide stretched
- `L/TH` — small open with tongue hint (subtle inner shadow brightening)

Driver: `visemes.ts` blends two signals
1. **Amplitude** from `companion:audio-level` (already shipping) → drives open/close magnitude.
2. **Text peek** — the speak queue already knows the sentence about to play; we run a lightweight grapheme→viseme mapper (no phoneme library) to bias which shape opens. We don't need perfect sync, just *correct mouth posture* for the dominant vowel/consonant in the current ~120ms window.

Cheek + jaw: cheeks lift on `smile`/open vowels (warm radial overlays brighten by ~12%); jaw mask translates the lower third of the portrait 0–4px down with scaleY 1.00–1.012, hiding the seam with a feathered alpha mask.

Performance: all overlays are absolutely-positioned divs/SVG over the existing portrait, mutated by ref + rAF (same pattern as today). No re-render cost.

---

## Pass 2 — Human Voice (TTS prompting & pacing)

Stay on `openai/gpt-4o-mini-tts` via Lovable AI Gateway. Improvements:

1. **Per-mode `instructions`** in the TTS request. Today we send a single calm template. Replace with mode-aware presets in `src/lib/voice/profile.ts`:
   - `default`: "Warm, conversational. Natural breath pauses between clauses. Soften sentence endings."
   - `sleep`: "Slow, hushed, near-whisper. Long pauses. Trailing softer endings. Never bright."
   - `encouraging`: "Slightly brighter, gentle smile in the voice."
   - `thinking-aloud`: "Reflective, unhurried."
2. **Cadence rewriter** in `src/lib/companion/speech-normalize.ts`: insert SSML-style pause hints by punctuation (`, ` → 120ms, `. ` → 280ms, `…` → 500ms) using comma-padding and ellipses the model already respects. Strip exclamation stacks; keep one. Drop trailing "okay?" repetition.
3. **Speed per mode**: 0.95 default, 0.88 sleep, 1.0 encouraging.
4. **Sentence-boundary streaming** (already partly in `speak.ts`) — confirm we flush at sentence boundaries so breath pauses land naturally between requests instead of mid-clause.

No model swap. No new infra.

---

## Pass 3 — Emotion Engine

New module `src/lib/companion/emotion.ts` exposing:

```ts
type Emotion = 'neutral' | 'happy' | 'thinking' | 'listening'
             | 'encouraging' | 'sleep' | 'concerned';
setEmotion(e: Emotion, opts?: { hold?: ms })
```

It dispatches `companion:emotion` and the rig subscribes. Each emotion maps to weights on the existing rig channels (brow lift, eyelid open %, mouth corner up, cheek lift, gaze target, breathing rate, blink interval). Examples:

| Emotion      | brow | lid open | corners | cheeks | gaze        | breath |
| ------------ | ---- | -------- | ------- | ------ | ----------- | ------ |
| happy        | +0.3 | 0.95     | +0.5    | +0.35  | user        | normal |
| thinking     | +0.2 | 1.0      | 0       | 0      | up-left     | normal |
| listening    | +0.1 | 1.0      | +0.1    | +0.05  | user (lean) | normal |
| encouraging  | +0.4 | 0.95     | +0.4    | +0.25  | user        | normal |
| sleep        | -0.2 | 0.55     | +0.15   | +0.1   | down        | slow   |
| concerned    | -0.3 | 1.0      | -0.2    | 0      | down-left   | normal |

Auto-inference: hook `companion:turn-ended` and a lightweight sentiment heuristic on Nova's reply (positive words → happy/encouraging; questions → thinking; sleep keywords → sleep). Manual overrides via the existing skills/routes.

---

## Pass 4 — Idle Presence ("alive while waiting")

Extend the current idle loop in `Avatar.tsx`:
- Randomized blink intervals already in place — keep.
- Add **weight shift**: every 12–25s a slow 1.2s sway on the shoulder wrapper (±2px x, ±0.4° rotate).
- **Gaze drift**: every 8–14s pick a near target (user, slight off-camera, back). 70% return-to-user.
- **Posture micro-adjust**: every 30–60s a tiny head tilt change (±0.6°) held for ~4s.
- **Breath variability**: ±8% period jitter so it doesn't feel metronomic.
- Anti-repeat: store last 3 actions, reject duplicates.

All gated on `prefers-reduced-motion` and `visibilitychange` (already wired).

---

## Pass 5 — Speech-Synced Head & Brow

Driven by the amplitude signal we already capture:
- **Emphasis nod**: peak detector on smoothed amplitude. When current sample exceeds rolling avg × 1.6 for ≥80ms, trigger a 220ms nod (translateY 1.5px, rotate +0.3°).
- **Side momentum**: low-frequency component of amplitude (LPF, ~0.5Hz) maps to ±0.4° head yaw.
- **Brow emphasis**: same peak detector → brow lift +1px for 180ms.
- **Jaw momentum**: small inertial term on jaw (already partial) — add a velocity LPF so jaw doesn't snap to silence.

All amplitudes capped tiny; the rule is "you notice it's gone, not when it's there."

---

## Pass 6 — Sleep Companion Mode

New surface flag `companionMode: 'normal' | 'sleep'` (existing prefs file). When `sleep`:

- Emotion preset `sleep` (see Pass 3).
- TTS profile `sleep` (Pass 2): speed 0.88, hushed instructions.
- Blink rate halved, eyelids rest at 55% open.
- Breath rate −30%, deeper amplitude.
- Idle animation speeds × 0.6.
- **Ambient halo**: warm amber radial aura behind the avatar (replaces cool primary), `box-shadow` glow with a slow 6s pulse.
- Background scrim dims to `bg-background/95` to reduce stimulation.
- Auto-engage when user opens `/sleep` or asks "help me wind down" / "goodnight".

Toggle exposed in `/settings/companion` and via voice command (intent already routed).

---

## Technical Details

**Files added**
- `src/components/companion/rig/{FaceRig,MouthRig,JawRig,CheekRig,BrowRig,EyeRig}.tsx`
- `src/components/companion/rig/visemes.ts`
- `src/components/companion/rig/expressions.ts`
- `src/lib/companion/emotion.ts`

**Files modified**
- `src/components/companion/Avatar.tsx` — delegate overlays to `FaceRig`, subscribe to `companion:emotion`, keep public API identical so `CompanionAvatar.tsx`, `CompanionHero.tsx`, `companion.tsx` need no changes.
- `src/lib/voice/profile.ts` — per-mode instructions + speed.
- `src/lib/companion/speech-normalize.ts` — cadence padding.
- `src/lib/companion/speak.ts` — pass mode to TTS, emit emphasis peaks on `companion:audio-peak`.
- `src/routes/companion.tsx` — wire emotion auto-inference; sleep-mode toggle.
- `src/routes/settings.companion.tsx` — sleep mode switch.
- `src/lib/companion/voice-action-prefs.ts` — add `companionMode`.

**No new dependencies.** No Live2D, no Three.js, no model weights. The 2.5D layered rig delivers Live2D-class realism for a single character at a fraction of the cost and zero load time.

**Performance budget**: all animation via refs + rAF, no React state at audio rate; rig adds ~6 absolutely-positioned overlays — well within mobile budget.

**Accessibility**: every motion respects `prefers-reduced-motion`; emotion changes mirror to ARIA-live label changes only on meaningful transitions.

---

## Acceptance

A first-time user, opening `/companion` on iPhone:
1. Sees Nova breathing, blinking naturally, gaze drifting — feels alive within 2 seconds.
2. Taps. Nova greets in a warm, paced voice with natural breath pauses.
3. Mouth posture matches vowels/consonants, not just open/closed.
4. Brow lifts and head nods land on her own emphasized words.
5. Asks "help me sleep" → ambient warms, voice slows, eyes relax. Immediately calming.

I will implement Passes 1–6 in order, verifying each in the preview before moving on.
