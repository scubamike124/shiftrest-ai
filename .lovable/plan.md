# AI Companion — Phase 1: Conversation Experience

Investigation complete. Below is the proposed plan, scoped to ship in five sequenced slices behind the existing `/companion` route. No code written yet.

## 1. Quick Action Cards

**Findings**
- `companion.tsx` currently shows a bare transcript + composer. There is an existing `WindDownQuickAction` but no action grid.
- Each suggested action already has a backing system:
  - Fall Asleep → `BreathingOverlay` + `sleep-engine`
  - Sleep Sounds → `sounds/mixer` + `SleepSoundsCard`
  - Calm Me Down → `BreathingOverlay` (4-7-8 preset)
  - Smart Alarm → `aiSmartAlarm` in `ai-client.ts`
  - Review My Sleep → `aiDailyReview`
  - Plan My Morning → `aiTomorrowPreview` / `MorningBrief`

**Approach**
- New `CompanionQuickGrid.tsx`: 2-column grid on mobile (3-col ≥640px), 6 tiles with emoji + label + 1-line subtitle. Glass tiles matching the bento dashboard palette.
- Tile press → dispatches a typed `QuickIntent` to a new `useCompanionIntent()` hook that either (a) opens the relevant overlay, (b) injects a pre-templated user message into the chat ("Help me fall asleep tonight"), or (c) deep-links to the matching route.
- Collapses to a single horizontal scroller once the conversation has ≥2 assistant turns to keep the transcript dominant.

**Files**: `src/components/companion/CompanionQuickGrid.tsx` (new), `src/lib/companion/intents.ts` (new), `src/routes/companion.tsx`.

## 2. Natural Conversation Experience

**Findings**
- `PILOT_VOICE_SYSTEM` already enforces short, non-robotic replies. Gaps: no time-of-day greeting variation, no follow-up memory across turns, no "one question back" behavior surfaced in UI.

**Approach**
- Add `buildCompanionSystem({ tod, lastTurnSummary, memorySnippet })` in `prompts.server.ts`.
- Time-of-day aware opener bank in `narration.ts` (morning/afternoon/evening/late-night) with light randomization seeded by date so it changes daily but not mid-conversation.
- Rolling 4-turn summary stored in conversation state and prefixed to system prompt → gives the model continuity without ballooning tokens.
- Server hint `expects_followup: boolean` so the UI can render a subtle "Pilot is waiting for your answer…" affordance instead of looking idle.

**Files**: `src/lib/ai/prompts.server.ts`, `src/lib/companion/narration.ts`, `src/routes/api/coach.ts` (or whichever route serves companion), `src/routes/companion.tsx`.

## 3. AI Memory Integration

**Findings**
- `ai-memory.ts` + `setMemoryEnabled` already exist. `memory_enabled` defaults to **false** at the prefs layer — good. `/memory` route handles review/edit/delete.
- Not yet surfaced: an in-companion consent prompt or visual indicator that memory is active.

**Approach**
- First-run sheet (once, gated by `memory_consent_seen` flag in localStorage + `user_prefs`): explains memory, offers Enable / Not now / Manage. No silent enablement.
- Status chip in the companion header: 🔒 "Memory off" or 🧠 "Remembering" — tap opens `/memory`.
- Server prompt only includes `MEMORY:` block when `memory_enabled = true`. When enabled, Companion references memory using natural phrasing already mandated in `PILOT_VOICE_SYSTEM` ("Last time you mentioned…").
- Every assistant message that *used* memory carries a `usedMemoryIds[]` field so we can render a tiny "Used your saved routine" link under the bubble → opens that memory in `/memory`.

**Files**: `src/components/companion/MemoryConsentSheet.tsx` (new), `src/components/companion/MemoryStatusChip.tsx` (new), `src/lib/ai/context.server.ts`, `src/routes/api/coach.ts`.

## 4. Avatar Personality

**Findings**
- 3D `Avatar3D.tsx` renders the GLB with Meshopt now. State plumbing exists for `idle | listening | thinking | speaking`. Idle breathing/blink rigs only partial; no thinking/listening signatures.

**Approach** (incremental, no model swap)
- `useAvatarAnimator(state, audioLevel)` hook centralizing rAF loop:
  - **Idle**: chest/neck 0.18Hz sine breathing, asymmetric blinks every 3-7s, micro saccades every 1.2-2.4s.
  - **Listening**: head tilt 3° toward mic side, brow raise +0.15, blink rate +30%, subtle nod on detected speech RMS peaks.
  - **Thinking**: eyes look up-left briefly, brow furrow morph 0.2, mouth closed neutral, slight head turn.
  - **Speaking**: existing viseme map + jaw drop, eye contact returns to camera, occasional emphasis nod tied to `EmotionEngine`.
- Crossfade between states over 250ms via tweened morph weights to kill the "snap" between modes.

**Files**: `src/components/companion/Avatar3D.tsx`, `src/lib/companion/avatar-animator.ts` (new), `src/lib/companion/emotion.ts`.

## 5. Voice Improvements

**Findings**
- ElevenLabs path is in place with cache + stall watchdog. Missing: barge-in (interrupt while speaking), faster TTFB via streamed TTS, tighter pause flattening already addressed by `bulletsToProse`.

**Approach**
- **Streamed TTS**: switch `/api/tts-elevenlabs` to `stream=true` and pipe chunks into a `MediaSource` / queued `AudioBuffer` chain. Cuts first-audio latency from ~1.5s to ~400ms.
- **Barge-in**: keep the mic VAD warm during playback at a higher threshold; on detected speech ≥250ms, fade TTS gain to 0 over 120ms, stop source, flip to listening. Recovery: the cut response is marked `interrupted` so the next turn doesn't repeat it verbatim.
- **Natural pauses**: SSML-ish `<break>` tags inserted by `speech-normalize.ts` at sentence boundaries scaled to comma/period weight.
- **Lip sync**: drive jaw from streamed PCM analyzer RMS at 60Hz instead of post-hoc viseme guessing during stream gaps.

**Files**: `src/routes/api/tts-elevenlabs.ts`, `src/lib/companion/speak.ts`, `src/lib/voice/useMicRecorder.ts`, `src/lib/companion/speech-normalize.ts`.

## 6. Premium UI Polish

**Approach**
- Replace `ThinkingShimmer` dots with a 3-word rotating phrase ("thinking…", "checking your sleep…", "pulling your plan…") tied to which tool/intent fired.
- Message bubbles: spring-in (translateY 8 → 0, opacity 0 → 1, 220ms), assistant messages render token-by-token via `MessageResponse` streaming.
- Sticky composer with backdrop blur; quick-grid collapses into composer toolbar on scroll.
- Tighter vertical rhythm (16/24/32 scale), avatar gets a soft aurora floor shadow tying it to the page.
- Skeleton uses pulsing rings matching the orb palette, not the current generic shimmer.

**Files**: `src/components/companion/ThinkingShimmer.tsx`, `src/routes/companion.tsx`, `src/styles.css` (a few keyframes).

---

## Implementation Order

1. **Slice A — UI Shell & Quick Actions** (sections 1 + 6). Lowest risk, immediately visible.
2. **Slice B — Conversation Naturalness** (section 2). Prompt + greeting bank + follow-up hint.
3. **Slice C — Memory Surface** (section 3). Consent sheet + status chip + server gating.
4. **Slice D — Avatar Animator** (section 4). Idle/listening/thinking/speaking unified loop.
5. **Slice E — Voice Latency & Barge-in** (section 5). Highest risk; ship last with feature flag.

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Streamed TTS breaks iOS Safari MediaSource gaps | Keep non-streamed fallback; flag `VITE_TTS_STREAM=false` kill switch |
| Barge-in false triggers on background noise | VAD threshold +6dB during playback, 250ms min duration |
| Avatar animator regresses iPhone FPS | Cap rAF to 30Hz on devices where `devicePixelRatio>2 && deviceMemory<=4` |
| Memory consent fatigue | Single sheet, never re-prompts; "Not now" suppresses 30 days |
| Quick action overload on small screens | Auto-collapse to scroller after 2 turns |

## Additional Pre-Launch Enhancements (recommended)

- **Mood check-in** before bed → feeds one tag into next morning brief.
- **"What did you mean?"** tap on any assistant sentence → quick clarification turn without retyping.
- **Conversation export** (Markdown) from companion overflow menu — trust signal.
- **Haptic taps** on iOS via `navigator.vibrate` on quick-action press and on TTS sentence boundaries (very subtle).

Awaiting approval before implementing Slice A.
