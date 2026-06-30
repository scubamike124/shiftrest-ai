
# Phase 1 — Restore Original Companion + Premium ElevenLabs Audio

Investigation only. No code changes until you approve.

## A. Restore plan (avatar rollback)

The 3D / Simli avatar work is gated, not the default — the original 2D Companion is still the production path. Concretely:

- `src/routes/companion.tsx` already renders the original `CompanionHero` + `Avatar` (2D portrait). The 3D `Avatar3D` only mounts when `?avatar=3d` is in the URL.
- The Simli POC lives entirely under `/lab/avatar-poc/*` and is reachable only via direct link. It does not affect the production Companion route.
- `AvatarVideo` / `Avatar3D` are not wired into the default Companion flow.

Recommended rollback (minimal, reversible):
1. Remove the `?avatar=3d` branch in `companion.tsx` so the 2D `Avatar` is the only renderer.
2. Hide the "3D" option from `AvatarPickerChip` (keep Aura/Nova/Atlas/Sage 2D avatars).
3. Leave `/lab/avatar-poc/*` in the tree for Phase 2 evaluation but unlinked from any user-facing nav.
4. Keep `Avatar3D.tsx`, `AvatarVideo.tsx`, and `simli/*` files in place (do not delete) — easy to revive in Phase 2.

No DB changes, no package removals.

## B. ElevenLabs audio upgrade — recommendation

Current state: `/api/tts-elevenlabs.ts` and `/api/lab/simli/speak.ts` already call ElevenLabs. The lab route is locked to `eleven_flash_v2_5` for latency. The main app TTS path runs through `/api/tts.ts` which currently uses the Lovable AI Gateway (`openai/gpt-4o-mini-tts`), not ElevenLabs.

### Model recommendation

| Model | Latency | Quality | Recommendation |
|---|---|---|---|
| `eleven_flash_v2_5` | ~75ms | Good | Use for interactive replies (voice command, Q&A) |
| `eleven_turbo_v2_5` | ~250–300ms | Very good | **Default** for Companion — best quality/latency balance |
| `eleven_multilingual_v2` | ~800ms+ | Highest | Use for pre-generated nightly briefs, sleep stories (cacheable, not realtime) |

Proposed split:
- **Realtime voice replies** → `eleven_turbo_v2_5`
- **Daily/voice briefing (cached)** → `eleven_multilingual_v2`
- Keep `eleven_flash_v2_5` available behind a "fastest" flag if needed.

### Voice recommendation (calming, sleep/wellness)

From the curated catalog already wired in the project:

| Voice | ID | Best for |
|---|---|---|
| **Sarah** | `EXAVITQu4vr4xnSDxMaL` | Warm female, primary default — soft and grounded |
| **Matilda** | `XrExE9yKIg1WjnnlVkGX` | Soothing female, sleep stories / wind-down |
| **George** | `JBFqnCBsd6RMkjVDRZzb` | Calm male alternative |
| Alice | `Xb7hH8MSUJpSbSDYk0k2` | Light female alternative |

Recommended voice settings for sleep/wellness:
```
stability: 0.55, similarity_boost: 0.80, style: 0.25,
use_speaker_boost: true, speed: 0.95
```
(Slightly higher stability + lower style than the lab defaults → less expressive, more calming.)

## C. Reliability verification (to perform before implementing)

Browser tool checks against production:
1. Confirm `/companion` loads 2D Avatar with no `?avatar=3d`.
2. Hit `/api/tts-elevenlabs` with a short utterance, verify MP3 returns, plays on desktop Chrome and iPhone Safari.
3. Confirm audio unlock gesture still works on iOS (existing `companion:voice-unlocked` event flow).
4. Confirm service worker does not cache `/api/tts*` responses (it shouldn't — `Cache-Control: no-store` already set in lab route; verify same on main route).

## D. Known risks / regressions to watch

1. `/api/tts.ts` (Lovable Gateway) and `/api/tts-elevenlabs.ts` currently coexist. Switching Companion to ElevenLabs requires picking one path, not both, to avoid voice inconsistency.
2. The voice catalog in `src/lib/voice/*` is already keyed to ElevenLabs IDs — but `VoicePlayer.tsx` posts to `/api/tts`. Need to confirm which endpoint the Companion uses today vs. the Voice Briefing.
3. iOS Safari: MP3 plays reliably, but autoplay still requires a gesture — existing `warmOutputDevice()` + unlock flow must remain intact.
4. ElevenLabs free-tier rate limits — confirm workspace plan supports turbo_v2_5 concurrency before rollout.
5. Cost: turbo_v2_5 ≈ 0.5 credits/char vs flash 0.33. Acceptable for premium tier; consider gating long briefings behind cached generation.

## E. Proposed implementation order (after approval)

One small change per step, verified before the next:

1. Roll back Companion to 2D only (remove `?avatar=3d` branch). Verify on iPhone.
2. Point Companion's TTS calls to `/api/tts-elevenlabs` using `eleven_turbo_v2_5` + Sarah. Verify single utterance works.
3. Apply calming voice_settings tuning. Verify on iPhone Safari.
4. Add response cache for repeated phrases (already partially built — LRU exists). Verify cache hit reduces latency.
5. (Optional) Pre-render daily voice briefing with `eleven_multilingual_v2` and store in Supabase storage; play cached MP3.

No installs needed — `ELEVENLABS_API_KEY` already configured, no new packages required.

## F. What I will NOT do

- Touch `/lab/avatar-poc/*` files (keeps Phase 2 path intact).
- Delete `Avatar3D` / `AvatarVideo` / Simli code.
- Migrate or change any DB schema.
- Change subscription tiers or billing.

---

**Awaiting approval to proceed with Step 1 only** (rollback to 2D Companion). Each subsequent step requires verification before the next.
