# Avatar Strategy Pivot — Investigation & Recommendation

The Three.js + GLB pipeline has been retired for the launch path. Below is a head-to-head of the four directions you asked for, scored against the constraint that matters most: **reliable rendering on iPhone Safari, today.**

## Option Comparison

| Criterion | Live2D (Cubism Web) | Rive | Video/State Crossfade | Commercial SDK (D-ID / HeyGen / Soul Machines) |
|---|---|---|---|---|
| iOS Safari reliability | Good (WebGL1, well-trodden) | Excellent (Canvas2D/WebGL, tiny runtime) | Excellent (native `<video>`, HLS/MP4) | Variable — depends on vendor (most stream MP4/WebRTC, generally fine) |
| Visual quality | High, anime/illustrated look | Vector/illustrated, very stylized | **Photoreal possible** (pre-rendered) | Photoreal, real-time generated |
| Lip sync | Viseme-driven, needs audio analyser | Manual state-machine, weakest of the four | Mouth-frame crossfade or short loop per phoneme | Built-in, server-side from TTS |
| Listening / thinking states | Yes (parameters) | Yes (state machine — its strength) | Yes (one clip per state) | Yes |
| Blinking / idle motion | Built-in physics | Hand-authored, smooth | Baked into idle loop | Built-in |
| Customization | Needs Live2D artist + Cubism Editor | Needs Rive designer | Needs one render pass per avatar/state | Vendor presets, limited |
| Dev complexity | Medium (runtime + rig + viseme map) | Low–Medium | **Low** | Low integration, high vendor lock-in |
| Bundle / payload | ~600 KB runtime + model | ~150 KB runtime + .riv | 2–6 MB video per avatar (cached) | Streamed |
| Cost | Free for <$10M rev (Cubism Free SDK), else paid license | Free runtime, paid editor tiers | Free runtime; one-time render cost (Runway/Pika/Sora ~$5–20/avatar) | $0.05–0.30/min streaming, ongoing |
| Long-term maintenance | Medium (rig edits need editor) | Low | **Very low** (static files on CDN) | Low code, high vendor risk |
| Estimated time to ship | 5–8 days | 4–6 days | **1.5–2 days** | 2–3 days integration + legal |

## Recommendation — Video/State Crossfade

Ship the **video-state avatar** for launch. It is the only option that gives you photoreal quality, near-zero runtime risk on iOS Safari, and a path to live in 2 days.

### Why this wins for RestPilot

- **iOS Safari is a solved problem** for `<video playsinline muted>` with MP4/H.264. No WebGL, no decoders, no Meshopt, no KTX2 — the exact stack that has failed three times.
- **Premium look beats premium tech.** A 4-second pre-rendered idle of Nova breathing looks better than any real-time 3D head we can ship this month.
- **States map cleanly to what the Companion already emits**: `idle`, `listening`, `thinking`, `speaking`. We already have these signals wired in `Avatar3D`.
- **Lip sync is "good enough" with a speaking loop** crossfaded over the existing audio-amplitude jaw pulse. We can upgrade later to viseme-frame swapping without changing the architecture.
- **Reversible.** If we later want true 3D or Rive, the `<CompanionAvatar />` component becomes the only swap point.

### Architecture (Technical Section)

```
src/components/companion/
  AvatarVideo.tsx          # <video> per state, crossfade, audio-reactive jaw overlay
  avatar-states.ts         # url maps: { aura: { idle, listening, thinking, speaking } }
src/assets/avatars/<name>/
  idle.mp4   (3–5s loop, 720p, ~800 KB)
  listening.mp4
  thinking.mp4
  speaking.mp4
  poster.jpg
```

- Two stacked `<video>` elements; fade between them on state change (200ms opacity).
- All clips: `playsinline`, `muted`, `loop`, `preload="auto"`, H.264 baseline, AAC stripped.
- Reuse existing `useAudioLevel()` to drive a subtle SVG mouth overlay during `speaking` — gives lip motion synced to *this* TTS playback, not a baked loop.
- Skeleton + poster image cover the <300ms first-frame decode.
- Files served via Lovable Assets CDN (already in stack).

### Asset Production Plan

Four avatars (Aura, Nova, Atlas, Sage) × 4 states = 16 clips. Two production paths:

1. **Fast path (recommended for launch):** Generate with Runway Gen-3 or Pika — portrait, subtle breathing/listening/thinking head motion, 4s loops. ~$60 total, same day.
2. **Premium path (post-launch):** Commission a single shoot or use HeyGen avatars exported as MP4. ~$200–400, 1 week.

We can launch on path 1 and silently swap CDN URLs to path 2 later — no code change.

### Rejected Options — One-line Why

- **Live2D** — Best long-term feel but needs an illustrator + 1 week of rig work per avatar; overkill for launch.
- **Rive** — Great runtime, but weakest lip sync and the vector look fights the "premium photoreal" brand.
- **Commercial SDK** — Ongoing per-minute cost and vendor lock-in; D-ID/HeyGen streaming adds 400–800ms latency on top of ElevenLabs.

## What Happens to the Existing 3D Code

- Keep `Avatar3D.tsx` behind a `?avatar=3d` query flag for internal testing only.
- New default everywhere (`/`, `/companion`, hero, dock) is `AvatarVideo`.
- Delete the GLB asset and Meshopt/KTX2 wiring after one stable release.

## Ship Checklist (post-approval)

1. Build `AvatarVideo.tsx` + `avatar-states.ts`.
2. Generate 4× idle clips for Nova first; wire end-to-end on `/companion`.
3. Verify on iPhone Safari (hard refresh, cold cache).
4. Backfill listening/thinking/speaking for Nova, then the other three avatars.
5. Swap hero and dock to the new component.
6. Publish.

**Estimated total time to a verified iPhone Safari pass: 1.5–2 days.**

Reply **approve video-state** to start, or name a different option and I'll re-plan.
