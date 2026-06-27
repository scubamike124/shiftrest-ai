# Pilot — Voice-First Companion AI

Build the missing **Companion** experience: a dedicated `/pilot` route where the user taps once and has a natural spoken conversation with RestPilot. Same brain as Coach (orchestrator + memory + decisions), new interaction model (voice in, voice out, hands-free).

## Rollout (5 phases, shippable independently)

### Phase 1 — Speech-to-Text foundation
- New server route `src/routes/api/stt.ts` → forwards multipart audio to Lovable AI Gateway `/v1/audio/transcriptions` (`openai/gpt-4o-mini-transcribe`, SSE streaming). Auth-gated, billed through existing `ai_log` (input tokens).
- New client hook `src/lib/voice/useMicRecorder.ts` — Web Audio PCM capture → WAV encoder (16 kHz mono), VAD silence detection for auto-stop, ~25 MiB guard. iOS-safe (no `MediaRecorder` timeslice).
- Permission UX: empty state for denied mic, clear retry path.

### Phase 2 — `/pilot` route + entry points
- New route `src/routes/pilot.tsx` — full-screen Companion canvas: animated orb (idle → listening → thinking → speaking states), live transcript, single big mic button, mute/end-call controls.
- Add **"Talk to Pilot"** entry points:
  - `BottomNav.tsx` → replace "Coach" tab with "Pilot" (mic icon); Coach moves to a sub-link inside Pilot ("Open text chat").
  - `AppSidebar.tsx` → top item.
  - `CompanionWhisper.tsx` dashboard card → primary CTA becomes "Talk to Pilot".
- `pilot.tsx` reuses `useTtsPlayer` (gesture-armed) and the new `useMicRecorder`.

### Phase 3 — Conversational loop wiring
- Pilot calls the existing `/api/coach` streaming endpoint (same `COACH_PERSONALITY`, same context injection, same memory writes, same `ai_log` rows, same daily-budget tiering). No duplicate brain.
- Turn loop: tap mic → STT stream → on final transcript, POST to `/api/coach` → stream reply tokens → speak via TTS as soon as a sentence boundary lands (sentence-chunked TTS for low latency). Barge-in: tapping the orb mid-speech stops TTS and reopens the mic.
- Persist each turn to `coach_history` so Pilot and `/coach` share one transcript.

### Phase 4 — Context & memory parity
- Reuse `src/lib/ai/context.server.ts` so Pilot knows today's shift, recovery, events, trips, TZ, and ranked memories — identical to Coach and Voice Briefing.
- Log every Pilot turn through the existing decision/memory extraction pipeline (`memory-extractor.server.ts`) so insights surface back on the dashboard.
- Add a "Send to Coach" affordance: opens `/coach` pre-loaded with the Pilot transcript.

### Phase 5 — iOS Safari polish + QA
- Pre-warm `<audio>` and `AudioContext` inside the first tap (reuse `useTtsPlayer.armGesture()` pattern).
- Visible "Tap to continue" fallback if autoplay is revoked mid-session.
- Playwright script: arrival → grant mic → speak (synthetic WAV) → verify transcript → verify spoken reply → barge-in → end-call cleanup.
- Manual QA on iPhone Safari + Desktop Chrome.

## Out of scope (deferred)
- WebRTC / true full-duplex audio (current arch is half-duplex turn-taking; matches every consumer voice assistant today and ships in days, not weeks).
- Wake word ("Hey Pilot") — requires native wrapper.
- Voice selection UI — ships with default `sage` voice.

## Risks
- iOS Safari mic permission is sticky per-origin but flaky after backgrounding — Phase 5 mitigations cover the known failure modes.
- STT costs add to daily token cap; admin/tester (you) is unlimited, Premium gets 500k/day, Free hits the cap faster. We may need to bump Free→25k after live data.

## Files to create / change
- **New**: `src/routes/api/stt.ts`, `src/routes/pilot.tsx`, `src/lib/voice/useMicRecorder.ts`, `src/lib/voice/wav-encoder.ts`, `src/components/PilotOrb.tsx`.
- **Edit**: `src/components/BottomNav.tsx`, `src/components/site/AppSidebar.tsx`, `src/components/CompanionWhisper.tsx`, `src/routes/coach.tsx` (add "Open Pilot" link).
- **No DB migrations needed** — reuses `coach_history`, `ai_log`, `ai_memory`, `ai_decisions`.

Reply **"approved"** (or "approved, start with Phase N") and I'll ship Phase 1.
