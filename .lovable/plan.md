## Investigation Findings

**1. Lip animation — root cause**
`src/components/companion/Avatar.tsx` lines 685–700 draw two visible SVG `<path>` strokes (`stroke="rgba(110,40,40,0.55)"`) on top of the portrait with `mixBlendMode: "multiply"`. Those strokes are the "painted lines" the user sees — the rig itself, not lip morph. The inner-mouth ellipse already darkens correctly when the jaw opens; the lip strokes only exist to outline shape but read as drawn-on contours at every size.

**2. Avatar selection — root cause**
There is no selector. `src/assets/` contains a single `companion-portrait.png` and every surface (Avatar, Hero, Dock, CompanionAvatar) imports it directly. No catalog, no persistence, no settings UI. The "selector not working" report is correct because none exists.

**3. Audio fade-in — root cause**
In `src/lib/companion/speak.ts`:
- `DynamicsCompressorNode` at `threshold:-12, ratio:2, attack:6ms, release:220ms` clamps the first loud syllables and recovers slowly — perceived as a 200–400 ms ramp-up at the start of every utterance.
- `levelCtx.resume()` is fire-and-forget (`.catch(() => undefined)`), so on iOS Safari the AudioContext can still be `suspended` at the moment `audio.play()` resolves; the graph then resumes a few hundred ms into playback, producing exactly the "quiet first seconds" symptom.
- `GainNode.gain.value = 2.2` is set once at graph construction — no ramp involved there, so the gain node itself is innocent.

**4. Microphone permission**
iOS Safari scopes mic permission per origin. Lovable preview subdomains (`id-preview--<uuid>.lovable.app`) and the published `shift-rest-ai.lovable.app` are *different* origins, so iOS will re-prompt the first time on each. Within a single origin Safari currently keeps the grant for the tab lifetime only — closing the tab also re-prompts. This is correct iOS behavior, not a bug.

## Implementation

### Item 1 — Invisible, natural lip animation
File: `src/components/companion/Avatar.tsx`

- Delete the two `<path>` strokes (upper/lower lip outlines) and their refs (`upperLipRef`, `lowerLipRef`) plus all `setAttribute("d", …)` writes.
- Keep only the soft inner-mouth shadow:
  - Switch fill to a radial gradient (`rgba(30,8,12,0.55)` core → transparent) for feathered edges.
  - Raise blur (`stdDeviation 0.4 → 1.1`) and add a soft mask so edges fade into skin.
  - Drive `opacity` purely from `finalOpen` (0 when closed → ~0.55 at full open) so the rig vanishes when not speaking.
- Increase jaw-drop translate slightly (×1.25) to compensate for losing the lip-shape cue; the portrait's own painted mouth then carries the movement.
- Keep `mixBlendMode: "multiply"` so the shadow tints the existing painted lips instead of overlaying a new shape.

### Item 2 — Avatar selector
New files:
- `src/lib/companion/avatars.ts` — catalog: `[{ id, name, gender, src, voiceHint }]`. Seed with 4 entries (Aura/female default, Nova/female, Atlas/male, Sage/male) using the existing portrait for now plus 3 newly-generated portraits via `imagegen` (premium, square 1024, transparent off).
- `src/routes/settings.avatar.tsx` — grid selector route. Persists `companion_avatar_id` to `localStorage` and (when authenticated) `profiles.companion_avatar_id` so it follows the user across devices.
- `src/lib/companion/use-avatar.ts` — hook returning the active avatar record; reads localStorage synchronously for SSR-safe first paint, hydrates from Supabase on mount.

Edits:
- `src/components/companion/Avatar.tsx`, `CompanionHero.tsx`, `CompanionDock.tsx`, `CompanionAvatar.tsx` — replace direct `portraitUrl` import with `useAvatar().src`.
- `src/routes/settings.companion.tsx` — add "Choose avatar" link card pointing to `/settings/avatar`.
- Migration: add `companion_avatar_id text` column to `profiles` with GRANT + RLS already covered by existing profile policies.

Custom-upload path: an "Upload your own" tile on the selector writes to existing `avatars` Storage bucket (or creates one if missing) and stores the public URL as `companion_avatar_id = "custom:<url>"`. The hook resolves `custom:` prefix to that URL.

### Item 3 — Audio at full volume from the first word
File: `src/lib/companion/speak.ts`

- Replace the compressor settings with a soft-limiter profile that does not pre-attenuate normal speech:
  - `threshold: -3`, `knee: 6`, `ratio: 6`, `attack: 0.003`, `release: 0.08`.
  This only catches true peaks (>-3 dBFS) and recovers fast enough that no ramp is audible.
- In `playOnce`, await `levelCtx.resume()` before `audio.play()` so playback never starts on a suspended context.
- In `prepareVoicePlayback`, also await the resume; if the resume rejects, fall back to a 50 ms silent prime before resolving.
- Lower `VOICE_GAIN` from `2.2` to `1.9` — combined with the looser compressor, perceived loudness is the same but headroom prevents compressor from engaging on the first vowel.
- Verify no `gain.linearRampToValueAtTime` exists anywhere (it doesn't today — confirming none is introduced).

### Item 4 — Microphone permission documentation
- Append a "Microphone & Preview URLs" section to `docs/qa/REAL_DEVICE_CHECKLIST.md` explaining that each Lovable preview subdomain is a new iOS origin and a re-prompt is expected; the published domain prompts once per Safari install.
- Add a one-line note under the mic toggle in `src/routes/settings.companion.tsx`: *"iOS asks for the mic again whenever the site URL changes (e.g. a new preview link). Granting once on the published site is permanent for that tab."*

## Verification (real-device, before marking done)

1. iPhone Safari on the latest preview URL:
   - Open `/companion`, tap avatar, confirm greeting starts at full volume on the first word (record audio level meter via `DebugHUD`).
   - Visually confirm no painted lip lines remain at rest or while speaking.
2. `/settings/avatar`:
   - Switch to each preset, hard-reload, confirm choice persists.
   - Upload a custom image, switch away and back, confirm it persists.
3. Mic prompt: confirm on first visit only per origin; document the preview-URL behavior in the report.
4. Update `BUILD_STAMP` and capture before/after screenshots for the report.

## Out of Scope

- No changes to viseme engine, emotion engine, TTS chunking, or speech-normalize.
- No new TTS provider work.
