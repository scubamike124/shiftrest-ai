
# Pilot AI Polish Pass — Pre-Launch Plan

Goal: Pilot should feel like a calm friend on the phone, not a chatbot reading a report. Six priorities, each mapped to concrete changes. Nothing ships until every Acceptance Criterion passes.

---

## Priority 1 — Response Speed (1–3s perceived start)

### Where the 7–8s comes from today
- STT: full recording uploaded after user stops → Whisper round-trip (~1–2s).
- LLM: `/api/ai` streams tokens, but Pilot waits for the *entire* reply before calling TTS.
- TTS: one big request for the whole answer (~2–4s before first audio byte).
- Net effect: user hears nothing until LLM + TTS both finish.

### Fixes
1. **Sentence-streamed TTS.** As tokens arrive in `pilot.tsx`, buffer until we hit a sentence boundary (`. ! ? \n`) or ~60 chars, then fire `/api/tts` for that chunk and enqueue the resulting MP3 in a tiny audio queue. Subsequent sentences play back-to-back with no gap. First audible word arrives ~1.5–2s after the user finishes speaking.
2. **Filler audio while we think.** The moment STT returns, immediately play one of 6 pre-generated MP3s ("Let me think about that…", "One sec…", "Looking at that now…", "Hmm, good question…", "Okay…", "Got it — one moment."). Cached in `public/audio/fillers/` so they ship in the PWA shell and play instantly. Filler is interrupted as soon as the first real sentence is ready.
3. **Audio queue + barge-in.** New `useTtsQueue()` (extracted from `useTtsPlayer`) handles ordered playback, cancellation on barge-in, and "playing" state transitions for the orb.
4. **Cache common Q&A.** Add a small server-side LRU keyed by `sha256(normalized_question + user_id_or_anon)` for non-personal questions (e.g. "what is sleep debt?", "should I nap before a night shift?"). Hits return cached `text + audio_url` instantly. TTL 24h, max 200 entries per process. Skip cache for anything that references user state.
5. **STT speedup.** Switch `/api/stt` to send the audio blob with `Content-Type: audio/webm` directly (no base64 round-trip if any). Confirm we're already using fastest Whisper variant.
6. **Shorter prompt → faster first token.** New `PILOT_VOICE_SYSTEM` (see P2) is ~40% shorter than COACH_VOICE; less context = faster TTFB from Gemini.

### Target timings after fix
- Filler audio playing: < 800ms after mic stop.
- First real sentence audible: < 2.5s after mic stop.
- Full answer: streams continuously, no silent gaps.

---

## Priority 2 — Make Pilot Sound Human

### Voice contract for spoken intent
New `PILOT_VOICE_SYSTEM` in `src/lib/ai/prompts.server.ts`, used only by `intent: "coach"` (visual cards keep COACH_VOICE):

```
You are Pilot, the user's personal sleep & energy companion.
You're talking out loud, not writing a document.
- No markdown. No headings. No bullet lists. No bold. No numbered steps.
- Speak in 2–4 short sentences, ~20–40 seconds when read aloud.
- Sound like a calm friend or coach. Contractions, natural rhythm.
- If you need more info to answer well, ASK ONE question instead of guessing.
- Offer to go deeper at the end ("Want me to walk through it?") only when relevant.
- Never say "As an AI". Never say "Here are some recommendations".
```

### Post-processing safety net
In `pilot.tsx`, run final text through `stripMd()` already in place AND a new `humanize()`:
- Strip `**`, `__`, `#`, leading `- `, `1. `, table pipes.
- Collapse multi-newlines to single space for TTS only (keep newlines in transcript).
- Drop trailing `Note:` / `Disclaimer:` paragraphs longer than 120 chars.

Transcript on screen renders the lightly-formatted version; TTS gets the fully-flattened version.

---

## Priority 3 — Conversation Quality (ask, don't dump)

1. Add to `PILOT_VOICE_SYSTEM`:
   - "If the user's first message lacks key context (wake time, last shift, how they feel, caffeine, sleep hours), ask ONE clarifying question before giving advice. Pick the most useful one."
2. Seed examples in the system prompt with 3 short dialogues showing the ask-first pattern.
3. Soft cap: if model output > 600 chars on the first turn of a topic, the post-processor truncates at the last sentence boundary before 600 and appends "Want the full breakdown?" — but only when no question mark exists in the response.

---

## Priority 4 — Voice Personalization Discovery

Settings already exist in `/profile` → Voice Settings (built last turn). Make them easier to find:

1. **In Pilot UI**: add a small "Voice & personality" link beneath the orb that deep-links to `/profile#voice-settings`.
2. **First-run nudge**: if `user_prefs.voice_id` is null on Pilot's first open, show a one-line dismissible chip "Tap to pick Pilot's voice →".
3. **Voice Settings audit**: confirm Male/Female grouping, accent dropdown (American, British, Australian, Canadian, Irish, South African), speed slider 0.7–1.3, Pilot name field, and 6 personality presets (Calm, Friendly, Professional, Motivational, Energetic, Companion) are all present with working previews. Add any missing accents.
4. Anchor `id="voice-settings"` on the section so the deep link scrolls to it.

---

## Priority 5 — Companion Personality (real memory)

The `ai_memory` + ranking engine already exists. Wire it into Pilot's opening turn and ongoing context:

1. **Arrival line.** On Pilot route mount, server fn `getPilotGreeting()` builds a one-liner using:
   - Last conversation timestamp ("Welcome back" / "Good morning" / "How was the night shift?").
   - Top-ranked memory ("Last time you mentioned an early shift Thursday — that's today.").
   - Latest sleep delta vs. baseline ("You got an hour more than yesterday — nice.").
   Shown as a soft text bubble above the orb. Tap to hear it spoken.
2. **Context injection.** `buildSystemPrompt({ intent: "coach" })` already pulls memory; verify top 5 ranked memories + last 3 user turns are included. Add `lastSeenAt` and `currentLocalTime` so Pilot can greet correctly.
3. **Natural recall language.** Add to prompt: "When recalling a memory, say it the way a friend would — 'Last week you said…', 'You mentioned…' — never 'According to my records'."

---

## Priority 6 — Reduce Information Overload

Covered by P2 + P3, plus:
1. Default `max_tokens` for `intent: "coach"` lowered from current default → 220.
2. Server-side check: if response > 4 sentences and user didn't ask "explain" / "details" / "walk me through", trim to first 3 sentences + "Want more on that?".
3. UI: add small "Tell me more" chip after each Pilot reply that re-sends the same context with `{ expand: true }`, which raises `max_tokens` and removes the brevity instruction for that turn.

---

## Technical Details

### Files touched
- `src/routes/pilot.tsx` — sentence-streamed TTS, filler trigger, "Tell me more" chip, voice-settings link, arrival bubble.
- `src/routes/api/ai.ts` — new `PILOT_VOICE_SYSTEM`, `expand` flag, response-length cap, cache lookup hook.
- `src/lib/ai/prompts.server.ts` — export `PILOT_VOICE_SYSTEM`, `humanize()` helper.
- `src/lib/voice/useTtsPlayer.ts` → split into `useTtsQueue.ts` (ordered playback) + thin compat wrapper for existing callers (`VoicePlayer`, `coach.tsx`).
- `src/lib/voice/fillers.ts` — list of filler MP3 URLs + random picker.
- `public/audio/fillers/*.mp3` — 6 pre-generated clips (generated once via the existing tts skill, committed as static assets).
- `src/lib/ai/qa-cache.server.ts` — tiny in-memory LRU for cached Q&A.
- `src/lib/pilot/greeting.functions.ts` — `getPilotGreeting()` server fn using ranked memory.
- `src/components/voice/VoiceSettings.tsx` — add `id="voice-settings"`, confirm accent list completeness.

### Out of scope
- No schema changes. Memory tables already exist.
- No new paid models. Same `google/gemini-3-flash-preview` + `openai/gpt-4o-mini-tts`.
- No native iOS work.

---

## Acceptance Criteria (must all pass before "Launch Ready")
1. Filler audio plays within 800ms of mic stop; first real sentence within 2.5s.
2. Zero markdown (`*`, `#`, `-`, `1.`) in any Pilot spoken text across 10 sample prompts.
3. Average spoken reply 20–40s; long answers gated behind "Tell me more".
4. Cold-start question without context produces a clarifying question, not advice.
5. Voice, accent, speed, name, personality all changeable from `/profile`; "Voice & personality" link from Pilot reaches them in one tap.
6. On second visit, Pilot greets with a memory-grounded line referencing a prior turn or recent sleep.
7. Barge-in stops both filler and main audio cleanly; no overlapping playback.
8. Manual QA on iPhone Safari + Desktop Chrome confirms no regressions in transcript, mic, or settings.

---

Approve and I'll start with **Priority 1 (speed + filler + sentence streaming)** since it unlocks the rest.
