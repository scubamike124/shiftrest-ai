# Slice 8 — AI Companion Voice + Action Layer

## Goal
Turn the Companion from a chat + brief surface into an interactive assistant that can propose **typed actions**, get **explicit confirmation**, and execute them safely. Add voice input/reply where supported, with hard privacy rules. Nothing fires silently.

## Investigation Summary

**What already exists (reuse, don't rebuild):**
- `src/routes/companion.tsx` — chat UI, `useMicRecorder` voice input → `/api/stt`, streaming `/api/ai` replies, sound bridge wiring with yes/no confirmation flow already implemented for *sleep sound* intents only.
- `src/lib/voice/intent-router.ts` + `intent-executor.ts` — deterministic intents (`play_track`, `stop_all`, `set_timer`, `sleep_mode`, `goodnight`, `breathing`, `wake_at`, `save_mix`). Used by `/sleep` and the bridge.
- `src/lib/voice/companion-sound-bridge.ts` — narrow allow-list (sound intents only). Returns `handled | confirm | miss`.
- `src/routes/api/tts.ts` — server TTS endpoint already shipped (used by `VoicePlayer`).
- `src/components/CompanionAvatar.tsx` — dashboard pulse chip linking to `/companion`.
- `src/routes/settings.companion.tsx` — settings shell from Slice 7.
- `src/lib/prefs.ts` — `assistantMode`, `assistantName`, `memoryEnabled`, `voiceLanguage` already persisted.

**Gaps this slice closes:**
1. Only *sleep sound* intents reach a confirm/execute flow. Smart-alarm, breathing, navigation to briefs, reminders have no unified action surface.
2. No reusable **Action Card** UI — current confirmation is plain assistant text + free-text yes/no parsing.
3. No voice **reply** (TTS) wired into companion chat (TTS exists but isn't called from `/companion`).
4. Dashboard avatar opens `/companion` but has no "Ask Companion" quick prompt.
5. `/settings/companion` has no voice/actions privacy toggles.
6. No quiet-hours gate for voice output.

## Affected files

**Create**
- `src/lib/companion/actions.ts` — typed `CompanionAction` registry + `executeAction()` + `describeAction()` (title, body, confirm/cancel labels, availability check). One central place for action types.
- `src/components/companion/ActionCard.tsx` — confirmation UI rendered inline in chat: title, explanation, Confirm / Cancel buttons. Disabled state when action is unavailable (e.g. integration not connected) with safe placeholder copy.
- `src/components/companion/VoiceReplyToggle.tsx` — small per-message speaker icon that plays the assistant turn through `/api/tts` (respects pref + quiet hours).
- `src/lib/companion/quiet-hours.ts` — pure helper: `inQuietHours(prefs, now)`.

**Modify**
- `src/routes/companion.tsx` — replace ad-hoc `pendingSoundIntent` text-confirmation with the generic `ActionCard`. Route bridge results and a new LLM-tool-style suggestion path through the same action queue. Auto-play TTS for assistant replies when `voiceRepliesEnabled` and not in quiet hours. Render suggested action chips from period briefs.
- `src/lib/voice/companion-sound-bridge.ts` — return `CompanionAction` objects (not free-text "Want me to…?") so the UI uses ActionCard. Keep the existing allow-list.
- `src/lib/prefs.ts` — extend `Prefs` with `voiceInputEnabled: boolean`, `voiceRepliesEnabled: boolean`, `actionSuggestionsEnabled: boolean`, `requireActionConfirmation: boolean` (default true, non-disable-able in UI for destructive actions), `companionQuietHours: { start: "HH:MM"; end: "HH:MM" } | null`. Round-trip through `user_prefs` JSON column (no migration needed — `prefs` JSON already exists).
- `src/routes/settings.companion.tsx` — new "Voice & Actions" section: voice input, voice replies, action suggestions, quiet hours, microphone privacy explainer, link to `/safety`.
- `src/components/CompanionAvatar.tsx` — keep current pulse chip; add an "Ask Companion" inline button next to it on the dashboard (small popover with quick prompt suggestions for the current period).
- `src/components/companion/DailyBrief.tsx` — surface period-appropriate suggested actions ("Start wind-down", "Prepare tomorrow") as chips that open the Companion with that action pre-selected via search param `?action=...`.

**Untouched**
- `src/routes/api/ai.ts`, `tts.ts`, `stt.ts` — backend stays as-is. All new action logic is client-side.
- `intent-router.ts`, `intent-executor.ts` — reused unchanged.

## Action Framework

```ts
type CompanionAction =
  | { kind: "play_track"; slug: string; label: string }
  | { kind: "stop_all" }
  | { kind: "set_timer"; minutes: number }
  | { kind: "start_breathing" }
  | { kind: "start_meditation" }            // placeholder if unavailable
  | { kind: "wind_down" }                   // wraps sleep_mode preset + timer
  | { kind: "open_route"; to: "/events" | "/sleep" | "/companion" | "/plan"; label: string }
  | { kind: "recommend_smart_alarm"; hour: number; minute: number }
  | { kind: "prepare_tomorrow_summary" }
  | { kind: "create_reminder"; text: string; whenISO: string }      // placeholder
  | { kind: "text_contact"; contactLabel: string; message: string } // placeholder
  | { kind: "calendar_event"; title: string; whenISO: string };     // placeholder
```

`executeAction(action, ctx)` returns `{ ok, message, undo? }`. Placeholder kinds return `{ ok: false, message: "I can't text contacts yet — coming soon." }` so the UI shows the same safe response, never pretends it ran.

**Approval rules:**
- All non-navigation actions require ActionCard confirmation.
- `open_route` may execute immediately (it just navigates).
- `requireActionConfirmation` pref forces confirmation even on `open_route` if user wants it on.

## Voice Layer

- **Input**: existing `useMicRecorder` flow. Mic permission only on tap. Listening pulse + Stop button already present. Add transcript-preview state: after STT returns, show text in composer (already happens) — keep current send-on-press behavior, no auto-send.
- **Reply**: when `voiceRepliesEnabled` and not in quiet hours, after stream finishes call `/api/tts` for the assistant turn and play through an `<audio>` element. User can tap the speaker icon to replay or mute. No background listening, no always-on mic.
- **Fallback**: if `MediaRecorder` / `getUserMedia` unavailable, hide mic button and show "Voice not available on this device" tooltip; text input remains.

## Dashboard avatar

- Keep `CompanionAvatar` chip + pulse.
- Add `<CompanionQuickAsk />` (new, but rendered next to the avatar in `src/routes/index.tsx`): a small button that opens a popover with 2–3 period-aware suggested prompts ("Start my wind-down", "What's tomorrow look like?"). Selecting one navigates to `/companion?prompt=...` which prefills the composer.
- No new animations beyond the existing pulse.

## Settings additions (`/settings/companion`)

New "Voice & Actions" card with:
- Voice input (switch)
- Voice replies (switch)
- Action suggestions (switch)
- Always confirm before actions (switch, default ON, disabled+forced-on with helper text for destructive types)
- Quiet hours (two time pickers, optional)
- Microphone & privacy explainer block (mirrors `/safety` copy, links there)

## Risks

- **TTS cost**: auto-playing every assistant turn could spike usage. Mitigation: only play turns ≤ ~600 chars, throttle to 1 in-flight playback, respect quiet hours, default the toggle OFF.
- **Browser STT/TTS variability**: Safari/iOS quirks already handled in `useMicRecorder`. Audio playback may require a prior user gesture — already true because reply only plays after user sent a message.
- **Action drift**: Future kinds (reminders, SMS) must be added to the union, not bolted on ad-hoc — `executeAction` exhaustively switches so TS catches missing cases.
- **Quiet hours**: must wrap midnight (e.g. 22:00–07:00). Helper handles wrap-around.
- **Regression surface**: existing sound-bridge yes/no parsing replaced by ActionCard. Keep `isYes`/`isNo` exported as fallback for free-text confirmation when the user types instead of tapping.

## Complexity

Medium. ~3 new files, 5 modifications, no DB migration, no new server routes. Most plumbing reuses Slice 4–7 work.

## Quality gates before shipping

- `tsgo --noEmit` clean.
- Manual: send text → action proposed → confirm → executes; cancel path works; placeholder actions return safe message; quiet hours blocks TTS; voice toggle off hides mic; settings persist across reload; dashboard quick-ask prefills composer; existing `/sleep` voice flow unchanged.
- No silent action execution anywhere in the chat path.

Awaiting approval before implementing.
