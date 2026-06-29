## Goal

Replace the flat portrait + SVG-overlay rig with a real 3D Ready Player Me (RPM) head powered by Three.js, driven by the existing speech pipeline. Add ElevenLabs as a switchable voice provider (off by default) so we can A/B against `openai/gpt-4o-mini-tts` on real iPhone Safari before committing.

Everything that already works — greeting volume fix (WaveShaper soft-clip + 40ms warm-up), the new prosody prompts, the avatar picker chip, `/settings/avatar` custom photo, `companion_avatar_id` persistence — stays intact. The 3D layer is additive and falls back to the current 2D rig if WebGL/RPM fails or the user opts out.

---

## Scope

### 1. 3D Avatar System (Ready Player Me + Three.js)

Stack:
- `three` + `@react-three/fiber` + `@react-three/drei` for rendering.
- RPM `.glb` head models loaded by URL (no SDK runtime cost). Each preset (Aura / Nova / Atlas / Sage) maps to an RPM model URL stored in `src/lib/companion/avatars.ts`. Custom-photo avatars keep using the 2D portrait path — RPM photo-to-avatar is out of scope for this slice.
- Models requested with `?morphTargets=ARKit,Oculus%20Visemes&textureAtlas=1024&pose=A&lod=1` so we get viseme + ARKit blendshapes and a small file.

New component `src/components/companion/Avatar3D.tsx`:
- Suspense-wrapped `<Canvas>` (transparent bg, `dpr={[1, 2]}`, `frameloop="demand"` flipped to `"always"` only while speaking/listening to save battery).
- Single `<directionalLight>` + soft `<ambientLight>` for a calm, sleep-friendly key/fill. No HDRI.
- Camera framed shoulders-up; matches current portrait crop so the picker chip overlay stays positioned.
- Idle rig (driven from a rAF hook, not React state):
  - **Breathing**: subtle Y-scale on chest bone + tiny camera dolly (±0.005).
  - **Head sway**: low-amplitude perlin noise on neck rotation (±2°).
  - **Eye saccades**: random gaze targets every 1.8–4.2s, eased.
  - **Blinks**: asymmetric `eyeBlinkLeft`/`eyeBlinkRight` morphs, double-blinks ~12% of the time, suppressed during visemes.
- Speech rig (consumes the existing `companion:voice-status` + analyser tap from `speak.ts`):
  - Map analyser level → `jawOpen` + `mouthFunnel`/`mouthPucker` (smoothed 60 Hz).
  - Map current viseme estimate → matching `viseme_*` morph weights.
  - Brow flashes (`browInnerUp`) on emotion = "warm"; subtle frown on "concern".

Integration:
- New hook `useAvatarRenderer()` returns `"3d" | "2d"` based on: WebGL2 support, user pref (`localStorage: companion.renderer`), and a feature flag `VITE_COMPANION_3D` (default on once shipped, instant kill-switch).
- `CompanionAvatarFace` (existing wrapper) chooses `<Avatar3D>` or the current `<Avatar>` portrait. Same outer dimensions, same tap target — keeps `handleMicTap`, the AvatarPickerChip, and orb-state ring untouched.
- `useAvatar` adds `modelUrl?: string` to preset entries; missing URL → 2D fallback automatically. Custom-photo avatars keep working unchanged.

### 2. ElevenLabs Voice (behind a flag)

- Standard connector flow (`standard_connectors--connect` → `elevenlabs`). `ELEVENLABS_API_KEY` becomes available in server env.
- New server function `src/lib/companion/tts-elevenlabs.functions.ts` mirrors the existing `tts.functions.ts` shape: same input (text, mode, voiceId), same MP3 binary output, no client API surface change.
- `src/lib/companion/speak.ts` selects provider via:
  - User setting `localStorage: companion.tts.provider` = `openai` (default) | `elevenlabs`
  - Runtime kill-switch: if ElevenLabs returns non-200, fall back to OpenAI for the rest of the session and emit a debug log line.
- New `/settings/companion` row: "Voice provider" toggle with helper text "Experimental — compare on your device". When ElevenLabs is selected, surface a voice picker (Sarah / Charlie / River / Liam / Matilda — calm/companion-leaning).
- Audio graph (WaveShaper soft-clip + 40ms warm-up) is provider-agnostic, so greeting-volume parity is preserved.

### 3. Persistence & Compatibility

- `companion_avatar_id` in `public.profiles` unchanged.
- Add `companion_renderer text default '3d'` and `companion_tts_provider text default 'openai'` to `public.profiles` via a single migration with GRANTs (authenticated select/update, service_role all). Hydrated by the existing profile hook, mirrored to localStorage for instant first paint.
- `/settings/avatar` keeps the same grid + custom-photo upload. 2D preview thumbnails stay (cheaper than rendering 4 GLB scenes). Selection writes both id and (if present) modelUrl.

### 4. Performance Guardrails

- Lazy-load Three.js bundle (`React.lazy`) so the landing page / non-companion routes stay light.
- Render loop runs on demand when idle, throttled to 30 FPS; switches to 60 FPS only while `orbState ∈ {listening, speaking, thinking}`.
- WebGL context loss handler reverts to 2D for the session.
- QA HUD adds: renderer (2d/3d), FPS, GLB load time, current viseme, TTS provider.

### 5. Validation (iPhone Safari)

- Soak: 25 min continuous use with auto-mic reopen on; assert no FPS drop > 10%, no audio fade-in regression, no memory growth > 80 MB.
- Avatar persistence: pick Nova → refresh → still Nova; toggle 3D→2D in settings → persists.
- Greeting parity: first word of greeting matches loudness of replies (manual A/B with phone at fixed distance).
- ElevenLabs flag: default OFF on a fresh session; turning it on uses ElevenLabs end-to-end; turning it off restores OpenAI immediately (no reload).
- Falls back cleanly when: WebGL disabled, GLB 404s, ElevenLabs returns 4xx/5xx.

---

## Technical Notes

- Deps to add: `three`, `@react-three/fiber`, `@react-three/drei`. RPM models are fetched as plain URLs — no RPM SDK.
- Files created: `src/components/companion/Avatar3D.tsx`, `src/lib/companion/use-renderer.ts`, `src/lib/companion/tts-elevenlabs.functions.ts`, `src/lib/companion/tts-elevenlabs.server.ts`, migration for two new profile columns.
- Files edited: `src/lib/companion/avatars.ts` (modelUrl), `src/components/companion/Avatar.tsx` wrapper to delegate, `src/lib/companion/speak.ts` (provider routing only — audio graph untouched), `src/routes/settings.companion.tsx`, `src/components/companion/DebugHUD.tsx`, `BUILD_STAMP`.
- Untouched: greeting/volume audio graph, AvatarPickerChip behavior, mic recorder, intent router, normalization, `_authenticated` gating.
- Out of scope this slice: RPM photo-to-avatar generation, full-body rig, lip-sync from phonemes (we drive visemes from analyser amplitude + sentence emotion — phoneme-accurate sync would require ElevenLabs alignment data and is a follow-up if needed).

---

## Acceptance

1. Tapping the avatar on `/companion` shows a breathing, blinking 3D head with idle gaze and speech-driven mouth on iPhone Safari.
2. Switching avatars via the picker chip swaps the 3D model live and persists across refresh.
3. Greeting starts at full volume — no fade-in regression vs current build.
4. `Voice provider` toggle in settings flips between OpenAI and ElevenLabs without reload; OFF by default.
5. WebGL-off / GLB failure / ElevenLabs failure all fall back gracefully with a visible debug log entry.
6. 25-minute soak on iPhone Safari shows stable FPS and no audio drift.

Ready to implement on approval.