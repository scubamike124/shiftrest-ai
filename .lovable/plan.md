# AI Coach Voice — Investigation & Fix Plan

## Root cause

The Coach route never calls TTS. `src/routes/coach.tsx` streams text from `/api/ai` (intent `coach`) and renders it as markdown bubbles — that's it. There is no `fetch("/api/tts")`, no `<audio>` element, no `VoicePlayer` import in the file. Voice Briefing works because `VoicePlayer.tsx` (used on the Plan/Dashboard) owns the full TTS + playback pipeline. Coach simply doesn't share that pipeline.

So the answer to each investigation question:
- Is Coach calling TTS? **No.**
- Audio generated but playback failing? **No** — audio is never generated.
- Autoplay blocked? **N/A yet** — but it will be the next blocker once we wire TTS in, because audio would start after a streamed response (long after the gesture).
- Different code path than Voice Briefing? **Yes** — Coach has no audio code path at all.
- Can both features share one component? **Yes** — `VoicePlayer.tsx` already encapsulates the gesture-preserving pattern (pre-warm `<audio>` under user tap, `NotAllowedError` → friendly "Tap to play"). We will extract its core into a reusable hook so Coach can drive audio per-message without rebuilding it.

## Fix design

### 1. Extract shared audio hook
Create `src/lib/voice/useTtsPlayer.ts` containing the existing VoicePlayer logic (fetch `/api/tts`, blob → object URL, pre-warm audio under gesture, `NotAllowedError` → "needs tap" state, cleanup on unmount). Refactor `VoicePlayer.tsx` to consume this hook so behavior stays identical (no regression to Voice Briefing).

Hook surface:
```ts
const { prepare, play, pause, stop, state, needsTap, playPrepared } = useTtsPlayer({ voice });
// state: "idle" | "loading" | "ready" | "playing" | "paused" | "error"
// prepare(text)  -> fetches + decodes (must be called inside user gesture for autoplay)
// play(text)     -> prepare + auto-play (gesture path)
// playPrepared() -> resume after needsTap (called from "Tap to hear response" button)
```

### 2. Wire Coach to speak every reply
In `src/routes/coach.tsx`:
- Pull `voice` pref from `localStorage` (`rp.voice.voiceId`) so Coach matches Briefing.
- Instantiate `useTtsPlayer` once at component level (single `<audio>` — pause prior reply when new one starts; matches the "single audio reference" rule from the shared knowledge).
- **Gesture preservation:** in `send()`, BEFORE the `await fetch("/api/ai")`, call `tts.armGesture()` which synchronously creates/loads the `<audio>` element so iOS keeps the gesture token alive across the SSE stream. Same pattern VoicePlayer uses for Briefing.
- After the SSE stream ends and `assistant` has the final text, call `tts.play(assistant)`.
- On `NotAllowedError`, the hook flips to `needsTap = true`. Render an inline "Tap to hear response" button on that last assistant bubble; tapping calls `playPrepared()` (no refetch — audio is already decoded).
- Per-bubble replay: each assistant bubble gets a small speaker icon button that calls `tts.play(message.content)` for that message (so the user can re-listen to any prior reply). Tapping a new bubble stops the previous one.
- Respect a user toggle: add a "Voice replies" switch in the Coach header (persist to `localStorage` `rp.coach.voice`, default ON). When OFF, skip the auto-`play` step but keep the per-bubble speaker buttons.

### 3. Keep text and voice synchronized
Auto-play is triggered only after the stream completes (final assistant text in state). Streaming partial audio would desync from the text and is not worth the complexity. The bubble visibly finishes typing, then begins speaking — same mental model as Voice Briefing.

### 4. Cost & length guardrails
Coach replies can be long. Trim to ~1800 chars before sending to `/api/tts` (TTS route already slices to 4000, but we want to avoid bloated calls for long markdown answers). Skip TTS entirely for messages under ~3 chars or pure code blocks.

### 5. Errors stay friendly
Reuse VoicePlayer's existing toast strings: "Briefing ready — tap play to start." / "Voice playback is temporarily unavailable." — no raw browser errors ever surface.

## Files touched
- **New:** `src/lib/voice/useTtsPlayer.ts` (shared hook)
- **Refactor:** `src/components/VoicePlayer.tsx` (consume hook — no behavior change)
- **Edit:** `src/routes/coach.tsx` (arm gesture before send, auto-speak on completion, needs-tap fallback, per-bubble replay, voice toggle)

## Verification
1. Desktop Chrome: ask Coach a question → audio auto-plays after stream completes; tapping speaker on an older bubble replays it; new playback stops the old one.
2. iOS Safari: same flow → if autoplay blocked, "Tap to hear response" appears immediately under the final bubble; one tap plays the already-decoded audio (no second network call).
3. Toggle "Voice replies" off → text-only, no TTS calls in network panel; per-bubble speaker still works on demand.
4. TTS 402/429/unavailable → friendly toast, bubble text still rendered, no raw error.
5. Voice Briefing on Plan page regression check — unchanged.

No schema, AI orchestrator, or planner changes.
