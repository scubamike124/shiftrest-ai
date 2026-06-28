# Pilot AI Personalization — Plan

## Goal
Give every user a settings surface to fully personalize their Pilot companion, with selections that persist across devices and apply to **every** voice surface (Pilot, Voice Briefings, Coach TTS).

## Provider decision (important — please confirm)

The current TTS provider is **Lovable AI Gateway → `openai/gpt-4o-mini-tts`**. It is fast, already wired, and free of extra connector setup, but it has real limits relative to your spec:

- **Voices:** ~9 fixed voices (alloy, ash, ballad, coral, echo, sage, shimmer, verse, nova). They cover male / female / neutral tones but are not labeled by accent. Language is auto-detected from the input text; there is no "British English" vs "American English" toggle at the voice level — the same voice speaks whatever language you send it.
- **Accents:** not selectable as a first-class control. We can *steer* tone via the `instructions` field ("Speak with a calm British accent") but quality varies and is not guaranteed.
- **Personality / speed:** fully supported via `instructions` + `speed` (0.7–1.2).

To deliver the spec **literally** (true British/Australian/Mexican voices, dozens of named voices per language, voice library previews), we need to add **ElevenLabs** as a second provider. ElevenLabs has the named multi-accent voice catalog, 29-language support, and a `speed` control, and an `elevenlabs` standard connector already exists.

**Recommendation — two-tier rollout:**

- **Tier 1 (this ship, no new connectors):** Ship the full settings UI now against OpenAI TTS. Voice = 9 curated options labeled by tone/gender. Language = auto. Accent = steered via instructions (clearly labeled "best effort"). Personality, speed, name, previews, persistence, global application — all real.
- **Tier 2 (follow-up, behind ElevenLabs connector):** Swap the voice catalog to ElevenLabs' named multi-accent voices, add explicit language + accent dropdowns backed by their voice library, keep the same settings UI. This is a provider swap inside `/api/tts`, not a UI rewrite.

If you want Tier 2 in this ship, I'll add a step to link the ElevenLabs connector first. **Please confirm Tier 1 now / Tier 1+2 now / Tier 2 only.** The rest of the plan assumes Tier 1 with Tier 2 wiring stubbed.

## What we'll build

### 1. Schema (one migration)
Add to `public.user_prefs`:
- `voice_id text` (default `'sage'`)
- `voice_provider text` (default `'openai'`, future `'elevenlabs'`)
- `voice_language text` (default `'en-US'`, BCP-47)
- `voice_accent text null` (free-form label, optional)
- `voice_personality text` (default `'calm'` — calm | friendly | professional | motivational | companion | coach | energetic)
- `voice_speed numeric` (default `1.0`, clamped 0.7–1.2)
- `voice_instructions text null` (computed server-side from personality, stored for transparency)

No new table. `assistant_name` already exists and becomes the "Pilot Name" field.

### 2. Server: unified voice config
- New `src/lib/voice/profile.server.ts` — loads `user_prefs` voice fields, returns a normalized `VoiceProfile`.
- `src/routes/api/tts.ts` rewrite: accepts `{ text, userId? }`, loads the profile, applies `voice`, `speed`, and a personality-derived `instructions` string. Backward-compatible with current `{ text, voice }` callers.
- New `src/routes/api/tts/preview.ts` — same as `/api/tts` but takes ad-hoc overrides (so the settings UI can preview a voice/speed/personality before saving). Short sample text per language.

### 3. Client: settings surface
- New `src/components/voice/VoiceSettings.tsx`:
  - Pilot Name (reuses `assistant_name`).
  - Voice picker grid (gender/tone label per voice, tap to preview, "Use this voice" to save).
  - Language dropdown (all locales currently in any RestPilot string + the list above).
  - Accent dropdown (filtered by language; "Best effort" badge on Tier 1).
  - Personality chips.
  - Speed slider (Slow 0.85 / Normal 1.0 / Fast 1.15) — also a fine slider.
  - Live "Preview" button per change.
- Mount in **Profile → Assistant** (alongside `AssistantSettings.tsx`) and add a "Voice & Personality" entry-point card on `/pilot`.

### 4. Global application
- `useTtsPlayer`, `VoicePlayer`, `AIBriefCard`, Coach TTS, and `/pilot` all stop hard-coding `voice: "sage"`. They call `/api/tts` with no voice override; the server resolves from the profile.
- Remove the legacy `rp.voice.voiceId` / `rp.voice.speed` `localStorage` keys; migrate once into prefs on first load if present.

### 5. Persistence + sync
- Writes go through a new server fn `updateVoicePrefs` (auth-protected) that upserts `user_prefs`.
- Same React Query invalidation pattern as existing `user_prefs` consumers, so other tabs / devices pick it up.

### 6. Acceptance verification
- Playwright: change voice + speed + personality + name on `/profile`, refresh, log out / in, confirm values persist; trigger Voice Briefing on `/dashboard` and assert outbound `/api/tts` POST carries no `voice` override and the server picks the saved one.
- Manual matrix: iPhone Safari, Android Chrome, desktop Chrome.

## Out of scope (call out to user)
- True per-language native voices for every locale (needs Tier 2 / ElevenLabs).
- STT language selection — Whisper auto-detects today; we can add a forced-language hint to `/api/stt` in a follow-up if you want.
- Voice cloning / custom uploaded voices.

## Risks
- Accent fidelity on Tier 1 is steered, not native. UI will label these clearly so we don't oversell.
- Speed extremes (<0.85 or >1.15) on `gpt-4o-mini-tts` degrade naturalness; we clamp.
- iOS Safari still needs a user gesture for preview playback — reuse the existing gesture-arm pattern from `useTtsPlayer`.

## Deliverables checklist
- [ ] Migration adds voice fields to `user_prefs`
- [ ] `/api/tts` resolves from profile; `/api/tts/preview` accepts overrides
- [ ] `VoiceSettings.tsx` mounted on Profile + entry on Pilot
- [ ] All TTS callers drop hard-coded voice
- [ ] Legacy localStorage migrated then removed
- [ ] Playwright persistence + cross-surface check passes
- [ ] Tier 2 (ElevenLabs) ticket filed if not shipping now

**Please confirm: Tier 1 only, Tier 1 + Tier 2, or Tier 2 only?** Then I'll execute.