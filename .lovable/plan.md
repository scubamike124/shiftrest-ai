## Goal

Swap the placeholder SVG face inside `CompanionAvatarFace` for a premium portrait-style character matching the reference image — calm, warm, modern — without touching the Companion engine (voice, state machine, lip-sync analyzer, audio events, integration points).

## Investigation Findings

- `src/components/companion/Avatar.tsx` is the **only** visual layer. Everything else (speak.ts analyzer → `companion:audio-level` events, state machine, intent router, dashboard/Pilot/Companion mounts) is decoupled and stays untouched.
- The component already exposes the right inputs (`state`, `level`, `size`, `expression`) and consumes the audio-level CustomEvent — we just need to re-render the visual using a portrait image plus a layered overlay rig instead of drawing geometric eyes/mouth.
- True per-feature rigging (rigging eyes/mouth on a photo) at SVG quality requires either Rive/Lottie or pre-rendered frame sets. The user approved Option A (SVG) for Phase 1, so we keep that constraint and use a **hybrid portrait approach**: a single portrait base image + lightweight overlays positioned over the face for blink, mouth, breath, aura, glow.

## Approach — "Portrait Hybrid"

Three stacked layers inside the existing component (same props, same events):

1. **Base portrait (PNG, transparent bg)** — premium AI-generated character matching reference (warm, friendly woman, soft studio lighting, deep indigo background bleed). Generated via `imagegen` at premium tier in two crops:
   - `companion-portrait.png` (head + shoulders, for `md`/`lg`).
   - `companion-portrait-bust.png` round-cropped (for `sm` dashboard chip).
2. **Animation rig overlay (SVG, absolute-positioned)** — invisible by default; activates per state:
   - **Blink:** two thin eyelid shapes color-matched to skin tone, scale-Y from 0→1 on blink tick (existing blink loop already in place).
   - **Mouth (speaking):** a subtle dark ellipse over the mouth region whose `ry` is driven by `audioLevel` (existing analyzer). Soft blur + low opacity so it reads as the lips parting, not a cartoon mouth.
   - **Breath:** existing `companion-breath` keyframe scales the wrapper ±1.5%.
   - **Head sway:** existing `companion-bob` keyframe + a slow sinusoidal `translateX` (≤1px) for natural micro-movement.
   - **Eye glance (thinking):** a 2px horizontal translate on a tiny highlight overlay positioned on each iris (no full eye redraw — just shifts the catchlight).
3. **Aura / glow ring** — keep existing radial aura; tint per state (idle = primary, listening = primary pulse, thinking = violet pulse, speaking = cyan glow synced to `audioLevel`).

Reduced-motion: portrait stays static, only blink runs (matches current behavior).
Tab hidden: pause RAF + blink loop (already implemented).

## Asset Generation

Use `imagegen` premium tier with `transparent_background: true`:
- Prompt anchored to reference: friendly young adult, soft natural smile, large warm eyes, gentle studio key light, deep indigo rim light, painterly-realistic (Pixar-meets-portrait), front-facing, neutral expression, no logos/text, on a clean background.
- Generate two variants and pick best:
  - `src/assets/companion-portrait.png` — 1024×1024 head & shoulders.
  - `src/assets/companion-portrait-sm.png` — 512×512 tighter round crop.

## File Changes

**Edit only:**
- `src/components/companion/Avatar.tsx` — replace SVG face geometry (head/brows/eyes/pupils/mouth path) with `<img>` portrait + overlay rig. Keep all props, hooks, event listeners, keyframes, aura logic, and exports (`CompanionAvatarFace`, `avatarStateLabel`) identical so all call sites continue working.

**Add:**
- `src/assets/companion-portrait.png` (generated).
- `src/assets/companion-portrait-sm.png` (generated).

**Untouched (confirmed):**
- `src/lib/companion/speak.ts` (analyzer + events)
- `src/lib/companion/intent-router.ts`, `intent-executor.ts`, `companion-sound-bridge.ts`
- `src/routes/companion.tsx`, `src/routes/pilot.tsx`
- `src/components/CompanionAvatar.tsx` (dashboard chip — automatically picks up new portrait via the small variant)
- `src/components/companion/CompanionHero.tsx`
- State machine, action layer, history, narration

## Animation Mapping (unchanged contracts)

| State      | Visual                                                                 |
|------------|-----------------------------------------------------------------------|
| idle       | portrait + soft breath + gentle bob + primary aura at 60%            |
| listening  | aura pulse scales with `level`; subtle catchlight brighten           |
| thinking   | violet aura pulse + tiny eye-glance offset + thinking dots (kept)    |
| speaking   | mouth overlay `ry` driven by `companion:audio-level` rms; cyan glow  |

## Risks & Mitigations

- **Mouth overlay looking pasted-on:** keep it small, blurred, low-opacity, and clipped within a soft mask; lip-sync reads as motion not shape. If it still feels off after one pass, fall back to a pure brightness/scale pulse on the lower-face region (no shape).
- **Asset weight:** portrait PNG ≤ ~400KB; use 1024 max and serve same asset for `md`/`lg`. Small variant only for the 40px chip.
- **Reduced motion / SSR:** existing guards already cover both; image renders fine in both paths.

## Acceptance

- Reference-quality portrait visible on `/`, `/companion`, `/pilot`, dashboard chip, and CompanionHero.
- Blink, breath, head sway run at idle.
- Mouth overlay reacts to live TTS audio while speaking.
- Aura color/scale changes per state.
- All existing voice / intent / action flows still work — no engine code modified.
- Typecheck clean.

Reply **approved** to proceed.
