## AI Companion Final Polish — Investigation Report

Investigation only. No code changed. Awaiting approval before any edits.

---

### 1. Volume consistency

**Findings**
- The Companion's main chat path (`speak.ts`) routes every TTS chunk through a single shared audio graph (`Gain → Makeup → WaveShaper → destination`). Greeting, replies, and queued sentences all share that path, so within `/companion` they should already be matched. But several *other* playback paths bypass it:
  - **VoiceSettings preview** (`src/components/voice/VoiceSettings.tsx`) creates a raw `<audio>` element and calls `audio.play()` directly with no Gain/Shaper. Previews play at full native loudness — noticeably louder than chat.
  - **`/api/tts-elevenlabs`** sends `use_speaker_boost: true` on every preset, including normal. Speaker boost adds ~+3 dB and varies turn-to-turn based on phrase energy → "some replies suddenly louder."
  - **Sleep mode** preset uses `[soft] [slowly]` SSML tags. EL's `[soft]` lowers RMS by ~3–4 dB relative to the normal preset, so flipping in/out of sleep mode produces audible loudness jumps.
  - **OpenAI fallback** (`/api/tts`) returns audio mastered ~2–3 dB hotter than EL turbo v2.5 at the same VOICE_GAIN. When EL fails once and the session is "blocked" (`elevenLabsBlocked = true`), every subsequent reply is louder.
  - **Mode auto-pick** in `playOnce()`: `mode = opts.mode ?? (companionMode === "sleep" ? "sleep" : "normal")`. Greeting is always "normal" even when the user has Sleep Mode on → opener is the loudest thing of the night.

**Root cause**: loudness is not centrally normalized; it depends on (provider, preset, speaker_boost, SSML prefix, mode at greeting time).

**Smallest safe fix**
- `tts-elevenlabs.ts`: set `use_speaker_boost: false` for `normal` and `sleep` (keep on for `encouraging`).
- `tts-elevenlabs.ts`: drop `[soft]` prefix from sleep (keep `[slowly]`); the lower stability/speed already softens it. Eliminates the sleep-vs-normal jump.
- `speak.ts`: when companion mode is `sleep`, force the greeting to `mode: "sleep"` so opener matches the rest of the bedtime session.
- `speak.ts`: lower the OpenAI-fallback path through an additional `0.85` makeup gain when `provider === "openai"` so fallback ≈ EL loudness.
- `VoiceSettings.tsx`: route preview playback through the shared `speak()` gate (or apply `audio.volume = 0.55`) so settings preview matches actual conversation loudness.

**Effort**: ~30 min. **Risk**: low — all changes are amplitude-only and reversible.

---

### 2. Remove remaining avatars (Phase 1)

**Remaining render sites** (`rg CompanionAvatarFace|Avatar3D|AvatarVideo|AvatarPickerChip`):

| File | Where it shows |
|---|---|
| `src/components/CompanionAvatar.tsx` | dashboard header chip |
| `src/components/home/GreetingHeader.tsx` | home greeting (top-right) |
| `src/components/companion/CompanionHero.tsx` | dashboard "Companion" hero card |
| `src/components/companion/CompanionDock.tsx` | floating corner dock on every authenticated page |
| `src/routes/index.tsx` (line 231, 1443) | marketing index hero + secondary block |
| `src/routes/pilot.tsx` (line 622) | `/pilot` voice screen |

Plus the underlying `Avatar.tsx` / `Avatar3D.tsx` / `AvatarVideo.tsx` / `AvatarPickerChip.tsx` files (no longer rendered after edits — keep in repo for Phase 2).

**Smallest safe fix**
- Replace each `<CompanionAvatarFace …>` with a small `<PilotOrb state="idle" />` sized to the same slot (or a simpler `OrbBadge` wrapper for the 44×44 / 56×56 chip variants).
- Delete `AvatarPickerChip` usage from `/companion` (already done last pass — verify none remain).
- Leave `Avatar.tsx`, `Avatar3D.tsx`, `AvatarVideo.tsx`, `AvatarPickerChip.tsx` files in place, just unused.
- Add a small `<OrbBadge size="sm|md|lg" />` shim in `src/components/PilotOrb.tsx` so the chip slots don't need 224 px PilotOrb scaling.

**Effort**: ~45 min (6 files + 1 new shim). **Risk**: low — layout-only; PilotOrb already exists.

---

### 3. Voice defaults (further tuning)

**Current normal preset**: `stability 0.65, similarity 0.82, style 0.12, speed 0.92, speaker_boost true`.

**Findings**: speed 0.92 + speaker_boost still produces "energetic" delivery. For a bedtime sleep coach the target is roughly EL's "narrative & story" recipe but slowed.

**Smallest safe fix** (one-file change in `tts-elevenlabs.ts`):

| Param | Current | Proposed |
|---|---|---|
| stability | 0.65 | **0.72** |
| similarity_boost | 0.82 | 0.80 |
| style | 0.12 | **0.05** |
| speed | 0.92 | **0.88** |
| use_speaker_boost | true | **false** |

Sleep preset: drop `[soft]` prefix; keep `[slowly]`; `speaker_boost: false`.

**Effort**: ~5 min. **Risk**: very low; preset-only.

---

### 4. Sleep sound integration

**Findings**
- `src/lib/voice/intent-router.ts` already maps `rain`, `ocean`, `waves`, `sea`, `storm`, etc. to `play_track` intents.
- `companion.tsx` already calls `parseIntent(text) → intentToAction → proposeAction → runAction → executeAction`. So "play rain" should already work.
- Two real gaps explain the "I can't do that" replies:
  1. **No "music" / "relaxing music" / "sleep sounds" / "white noise" / "noise" aliases** in `intent-router.ts`. "Play relaxing music" → `parseIntent` returns confidence `< 0.6` → falls through to the AI, which (correctly per its system prompt) says it can't play media.
  2. **Bare phrases** like "ocean sounds", "play some ocean" parse at confidence 0.6 — at the threshold. Combined with no "sounds" stripping, edge phrasings miss.
- System prompt for the voice surface does not tell the model the Companion *can* play sounds, so when intent parsing misses, the AI denies the request instead of saying "tap the play button" or letting the user retry.

**Smallest safe fix**
- `intent-router.ts`: add aliases — `music → soundscape (curated default, e.g. brown noise / mix)`, `relaxing music`, `sleep sounds`, `white noise → white-noise track`, `pink noise`, `brown noise`, `nature sounds → forest/rain`, strip trailing "sounds".
- `intent-router.ts`: raise confidence to 0.8 when the phrase contains an explicit play verb ("play", "start", "put on") + a known sound noun.
- `src/lib/ai/prompts.server.ts` (voice surface): add one sentence — *"You can play sleep sounds (rain, ocean, storm, white/brown noise, music, custom mixes) and set sleep timers. If asked, confirm and the app will start them."*
- Verify `proposeAction` cards render an inline confirm/cancel — they already do.

**Effort**: ~25 min. **Risk**: low — alias-only + one prompt line.

---

### Recommended implementation order

1. (~5 min) Voice presets (item 3) — biggest perceived improvement, smallest change.
2. (~30 min) Volume consistency (item 1) — directly user-visible.
3. (~25 min) Sleep sound aliases + prompt (item 4).
4. (~45 min) Remove remaining avatars (item 2) — most file-touches, last.

Total effort: ~1.5–2 h. Combined risk: low. No schema, no API contract, no AI logic changes beyond a single prompt line.

---

### Risks (combined)

- VoiceSettings preview being rerouted through `speak()` would inherit its quiet-hours/voice-off gates → may surprise users testing voices during quiet hours. Mitigation: bypass quiet-hours check for explicit preview calls.
- Disabling `use_speaker_boost` slightly reduces clarity on phone speakers in noisy rooms. Mitigation: raise `VOICE_GAIN` from 1.15 → 1.20 to compensate.
- Adding "music" alias mapped to a curated track means "play music" always plays the same thing. Acceptable for Phase 1; better catalog routing is a Phase 2 task.

Awaiting approval before any code changes.
