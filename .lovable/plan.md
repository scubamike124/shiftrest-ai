# Plan — Recovery label fix + Realtime voice wiring

Two independent fixes shipped in one publish.

## 1) Relabel the schedule-shape score

Rename the `100 - circadian debt` number everywhere it appears, so it stops colliding with the wearable-aware "Recovery" score in the AI Coach Brief. No math changes.

**`src/components/home/CompanionHero.tsx`** — hero context strip:
- `Recovery {recoveryScore}% · Sleep debt {debtScore}` → `Schedule stability {recoveryScore}% · Sleep debt {debtScore}`

**`src/routes/dashboard.tsx`** — the "Today's Readiness" card at ~line 365-394:
- Eyebrow `"Recovery"` → `"Schedule"`
- Title `"Today's Readiness"` → `"Schedule stability"`
- Keep the `stability` number, rotation label, and "Circadian debt: X/100" line as-is.

The `CompanionHero` internal prop name stays `recoveryScore` (it's just a variable), so no other call sites change. The AI Coach Brief keeps its "Recovery" label — that one is the true wearable-aware score.

## 2) Wire Profile voice/personality/speed to the live Realtime session

All changes in **`src/lib/realtime/openai.functions.ts`**.

### Load the user's voice profile
Add a helper that loads the same six `user_prefs` columns `/api/tts.ts` reads (`voice_id`, `voice_language`, `voice_accent`, `voice_personality`, `voice_speed`, `voice_instructions`) using `supabaseAdmin` inside the handler (same pattern as the greeting-name lookup already there). Returns `DEFAULT_VOICE_PROFILE` on any miss so a signed-in user with no saved prefs still gets a sensible session.

### Map to session config
- **Voice**: validate `voice_id` against `VOICE_OPTIONS` from `src/lib/voice/profile.ts`. If invalid or missing, fall back to `"marin"` (per OpenAI's Realtime voice recommendations); update `DEFAULT_VOICE` accordingly. Feed into `session.audio.output.voice`.
- **Speed**: clamp `voice_speed` to `[0.25, 1.5]` (Realtime API range) and set `session.audio.output.speed`. Default 1.0.
- **Instructions**: build a combined string:
  1. Existing reply-shape rules (short sentences, clear follow-up question, no lecturing) — kept verbatim.
  2. `buildInstructions({ personality, accent, language, instructionsOverride }, "normal")` from `src/lib/voice/profile.ts` — adds tone, accent, language.
  3. A pacing hint derived from the speed tier — e.g. `speed < 0.95` → "Pace yourself calmly and unhurried."; `speed > 1.05` → "Keep a brisk, energetic pace."; otherwise "Speak at a measured, natural pace." Per OpenAI guidance the model doesn't self-adjust cadence from the speed multiplier alone; this closes the gap.

If the user has a non-empty `voice_instructions` override, `buildInstructions()` already returns that verbatim — respected as-is.

### Return shape
Add `voice` (validated) to the existing `RealtimeSessionResult` (already there) and leave the greeting fields untouched. The client hook already reads `session.voice` for logging only, so nothing else needs to change.

## Technical notes

- All lookups happen server-side inside `.handler()` — no client changes, no new server functions.
- `supabaseAdmin` is loaded lazily inside the handler (same pattern already used for greeting-name), safe under Cloudflare Worker rules.
- `VOICE_OPTIONS` and `buildInstructions` are already client-safe pure modules; importing them at the top of the server-fn file is fine.
- Speed can only change between turns (OpenAI constraint). We set it once at session mint; that matches the pref surface — users pick once in Profile.
- The Realtime API sends the greeting `response.create` from the client hook (`useOpenAIRealtime.ts:381-405`). The session-level `instructions` set at mint time apply to that greeting *and* every subsequent turn, so no changes are needed in the client hook.

## Verification before publishing

1. Typecheck.
2. Read back the file to confirm the `createServerFn(...).middleware(...).inputValidator(...).handler(...)` chain is intact.
3. Publish.
4. Ask you to switch to a distinctly different voice (e.g. Ash — male, steady) + Coach personality + speed 1.2 in Profile, start a Companion session, and confirm both voice timbre and pacing changed.

## Files touched

- `src/components/home/CompanionHero.tsx` — one line, label swap
- `src/routes/dashboard.tsx` — two strings in the Readiness card
- `src/lib/realtime/openai.functions.ts` — profile lookup + session-config wiring
