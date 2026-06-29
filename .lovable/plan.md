# Companion Polish — Bug Fix Pass

## Root causes (verified)

1. **"Mustache" mouth** — `src/components/companion/Avatar.tsx` renders a black ellipse (`background: rgba(40,18,22,0.82)`) at `top: 47.5%` of the portrait. On the live portrait the actual lip line sits lower, and an opaque oval at that position reads as a dot/mustache above the chin. The overlay itself is the wrong technique for a painterly portrait — it can never align convincingly.
2. **Robotic delivery + "8 dot 00"** — `src/lib/companion/speak.ts:playOnce` POSTs raw assistant text straight to `/api/tts`. There is no normalization step. `expandForSpeech()` in `src/lib/voice-rewriter.ts` exists but is unused by the companion pipeline, and even it doesn't normalize clock times. Times like `8:00 AM`, `10:30 pm`, decimals `7.5 hours`, and bullet/markdown leftovers all get read literally → "eight dot zero zero".
3. **Stale autoplay banner** — `speak.ts` dispatches `voice-status: "failed" / autoplay_blocked"` on the *very first* play (before the iOS unlock takes effect), and `companion.tsx` latches that into `voiceSkipped` state. Subsequent successful plays never clear it because the listener doesn't reset on `started` / `ended`. Result: the warning sticks even though voice is now working.
4. **"Decorative glow over face"** — the aura div sits behind the head but the per-state ring (`inset 0 0 18px hsl(190…)`), thinking-dots SVG, and listening jaw-warmth gradient compete for attention. Users perceive the face as static because the glow is the loudest signal.

## Fix Plan

### 1. Replace the black mouth overlay with jaw-only motion
- **Delete** the `mouthRef` ellipse element and all `mouthRef.current.style.*` writes in the rAF tick.
- Keep — and amplify — the existing **jaw translate** (`--jaw` CSS var on the portrait `<img>`): widen its range from `0..1.5px` to `0..3px` and add a tiny `scaleY` (`1.000 → 1.006`) on the portrait when speaking so the lower face visibly articulates without any overlay.
- Add a **soft warm shadow** (radial gradient, ~6% mouth area, `mix-blend-multiply`, opacity tied to `gamma`) under the lip line as the only "mouth" cue. This reads as lip darkening on a real face, not a floating mark.
- Keep brow lift, blink, saccades, head sway untouched — those already feel alive.

### 2. Natural-speech normalizer (fixes "8 dot 00" + robotic punctuation)
Create `src/lib/companion/speech-normalize.ts`. Called from `speak.ts` *before* the `/api/tts` POST. Pipeline:
1. Strip markdown leftovers (`**`, `*`, `_`, backticks, headings, bullets, link syntax).
2. **Times**:
   - `8:00` → `eight o'clock`
   - `8:30` → `eight thirty`
   - `8:45` → `eight forty-five`
   - `8:00 AM` / `8 AM` → `8 a.m.`  (TTS reads "a.m." as "ay-em" naturally; for `:00` use `eight a.m.`)
   - `12:00 PM` → `noon`, `12:00 AM` → `midnight`
3. Decimals: `7.5 hours` → `seven and a half hours`; generic `1.5` → `one point five` only when followed by a unit word.
4. Run existing `expandForSpeech()` for units (mg → milligrams, °F → degrees Fahrenheit, etc.).
5. Collapse ellipses, em-dashes → comma+space; strip stray symbols (`#`, `>`, `|`, `~`).
6. Normalize whitespace and ensure final period.

Add unit tests in `src/lib/companion/__tests__/speech-normalize.test.ts` covering each case above.

### 3. TTS instruction polish (less robotic)
- Tighten `PERSONALITY_TEMPLATES.calm` in `src/lib/voice/profile.ts` with explicit sleep-coach guidance: *"Speak slowly and softly, like a calm friend at bedtime. Add gentle breath pauses between sentences. Read times as a person would — never letter-by-letter. Vary pitch naturally; avoid monotone."*
- Lower default `speed` for the companion surface to `0.95` (server-side merge in `/api/tts` when surface header `x-companion-surface: 1` is set, or just pass `speed: 0.95` from `speak.ts`).

### 4. Robust autoplay unlock + smarter banner
- In `speak.ts`, on every successful `audio.play()`, emit a new event `companion:voice-unlocked`. After the first such event, set a module flag `audioUnlocked = true` and from then on **never** emit `failed/autoplay_blocked` again unless the user explicitly muted.
- In `prepareVoicePlayback()`: keep the silent-WAV unlock, but also pre-fetch a tiny TTS warmup *only on the first user gesture* so the gain/compressor graph is fully primed before the real reply arrives.
- In `companion.tsx`, clear `voiceSkipped` on `companion:voice-unlocked` and on every `voice-status: started`. Only show the banner for **persistent** failures (≥ 2 consecutive `failed` events within 5s) — never for the first race-condition failure.
- Suppress `autoplay_blocked` banner copy entirely once `audioUnlocked` is true.

### 5. Tone down decorative glow so the face leads
- Aura: lower default opacity to 0.55, drop max scale pulse from 1.22 → 1.08.
- Remove the per-state inner ring `box-shadow` swap (keep a static subtle ring).
- Remove the listening "jaw warmth" gradient overlay (it muddies the chin where new jaw motion now lives).
- Keep thinking dots but reduce size and move further off-face.

## Files touched
- `src/components/companion/Avatar.tsx` — remove mouth overlay, amplify jaw, add lip shadow, calm glow.
- `src/lib/companion/speech-normalize.ts` — **new**.
- `src/lib/companion/__tests__/speech-normalize.test.ts` — **new**.
- `src/lib/companion/speak.ts` — call normalizer; emit `voice-unlocked`; suppress repeat banner triggers; pass `speed: 0.95`.
- `src/lib/voice/profile.ts` — refine `calm` personality instructions.
- `src/routes/companion.tsx` — listen for `voice-unlocked` + dampen `voiceSkipped` logic.

## Validation (before marking complete)
1. `bunx tsgo --noEmit` clean.
2. `bunx vitest run src/lib/companion/__tests__/speech-normalize.test.ts`.
3. Drive Playwright at iPhone 14 viewport (`390×844`, mobile Safari UA), sign in, open `/companion`, tap Aura, capture a screenshot during a spoken reply. Verify:
   - no black oval / mustache visible
   - jaw shows clear sub-pixel motion across 3 sequential frames
   - no "Voice unavailable" banner after first reply
4. Manual iPhone Safari pass for audio: greeting + reply heard, "8 a.m." not "8 dot zero zero", natural pacing.
5. Provide before/after screenshots in the implementation reply.

## Risks
- Removing the mouth overlay leaves the portrait static below the eyes if the jaw delta is too subtle on low-DPI screens. Mitigation: also animate a faint lip-shadow `opacity` (0 → 0.35) — gives motion cue even when jaw is imperceptible.
- Time regex must not eat dimensions like `16:9` aspect ratios in any future content. Restrict pattern to clock-shaped tokens (`\b([01]?\d|2[0-3]):[0-5]\d\b`) and bail when surrounded by `aspect`, `ratio`, `score`, `vs`.
- `speed: 0.95` slightly lengthens replies; acceptable for sleep-companion tone.

## Effort
~ 90 min implement + 30 min mobile QA.

Awaiting approval to implement.
