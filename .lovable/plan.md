
# Companion voice — production investigation (iPhone Safari)

## 1. What's actually running in production

Production is serving the latest published build.

- `x-deployment-id: 2cc49b0f…` on `https://restpilotai.com/`
- `/api/public/version` reports `buildId b-1783282644876`, built ~50 min ago.

So this is **not** stale code. The behavior you're seeing is the current code.

## 2. Which voice pipeline `/companion` uses

`/companion` (the page you use daily) does **not** use the OpenAI Realtime WebRTC pilot — that only lives at the hidden `/lab/pilot-realtime` route behind a feature flag.

The production Companion voice loop is a classic push-to-talk STT loop:

```text
Tap mic  ─► useMicRecorder (Web Audio + ScriptProcessor → WAV)
         ─► auto-stop on silence
         ─► POST /api/stt   (Whisper)
         ─► POST /api/ai    (chat completion)
         ─► POST /api/tts   (ElevenLabs → speakQueued pipeline)
         ─► on "companion:turn-ended" ─► auto-reopen mic
```

Files in the loop:
- `src/routes/companion.tsx` — mic tap handler, auto-reopen, send/receive.
- `src/lib/voice/useMicRecorder.ts` — mic capture + silence detection.
- `src/lib/companion/speak.ts` — TTS playback pipeline.
- `src/routes/api/stt.ts`, `api/ai.ts`, `api/tts.ts`, `api/tts-elevenlabs.ts`.

All prior LiveKit / OpenAI Realtime tuning we did has **zero effect on this page** — different code path.

## 3. Root cause hypotheses (ranked)

### H1 — Aggressive silence cutoff (highest confidence)

`src/routes/companion.tsx:176`

```ts
useMicRecorder({ silenceMs: 1000, maxMs: 12_000 })
```

The recorder auto-finalizes after **1000 ms** of RMS below `0.012`. On iPhone Safari, natural mid-sentence pauses easily exceed 1 s — the mic closes, Whisper transcribes half a thought, the AI answers the wrong thing, and it feels like "cuts me off after ~1 s pause". This is the exact symptom you described earlier for the Realtime beta, and it also applies here — just for a different reason (client-side RMS gate, not server VAD).

### H2 — iOS PWA gesture chain broken before `getUserMedia`

`src/lib/voice/useMicRecorder.ts:107-131` awaits `navigator.permissions.query({name:"microphone"})` **before** calling `getUserMedia`. On some iOS Safari / Home-Screen PWA versions the permissions query is non-fatal but consumes the user gesture, so the subsequent `getUserMedia` opens without a live gesture on cold start and can silently fail or return a muted track. Symptom: first tap does nothing, second tap works.

### H3 — Auto-reopen fires outside a user gesture

`companion.tsx:541-556`, `handleMicTap` is re-invoked from a `companion:turn-ended` event with a 350 ms `setTimeout`. iOS Safari (especially in Home Screen PWA) **requires a fresh user gesture for `getUserMedia`**. After the first turn the stream is cached so it usually works, but if the AudioContext got suspended by iOS (backgrounded, lock screen, silent switch) the resume + start chain runs with no gesture and the mic never re-arms — user perceives "AI stopped listening".

### H4 — `ScriptProcessorNode` deprecated, iOS quirks

`useMicRecorder.ts:164` uses `ctx.createScriptProcessor(4096,1,1)`. Deprecated for years; on iOS 17+ it still works but can drop buffers when the tab is briefly backgrounded or when AudioContext auto-suspends after TTS playback finishes. Contributes to H3.

### H5 — TTS-then-listen race

`speak.ts` fires `companion:turn-ended`; `companion.tsx` re-opens the mic 350 ms later. If TTS is still draining its last audio buffer through the same shared AudioContext, opening the mic can cause the OS mic indicator to arm without capturing anything, and `noSpeechMs=8_000` then reports "empty" — you see the "I didn't catch that" toast even though you spoke.

## 4. What is NOT the cause (ruled out)

- **Not a stale prod build** — version endpoint confirms latest.
- **Not the OpenAI Realtime tuning** — `/companion` doesn't use it.
- **Not LiveKit** — fully removed; the worker/edge route is gone.
- **Not `/api/brief` auth** — the voice loop uses `/api/stt` + `/api/ai` + `/api/tts`, not `/api/brief`.
- **Not CSP** — `connect-src` allows Supabase, OpenAI, ElevenLabs, self.

## 5. Files affected by the actual fix

Frontend only:
- `src/routes/companion.tsx` — bump `silenceMs`, add pointer-gesture guard for auto-reopen, small delay tuning.
- `src/lib/voice/useMicRecorder.ts` — reorder gesture-sensitive calls (getUserMedia before permissions.query on iOS), migrate off `ScriptProcessorNode` or add fallback, harden AudioContext resume.

Nothing on the server needs to change for this class of bug. Backend TTS/STT/AI routes are working (confirmed by the fact that text chat replies do come back — you only complain about the voice-input side).

## 6. Minimal tuning options (for your approval — no code yet)

Pick any combination:

**A. Widen the silence window (smallest change)**
- `silenceMs: 1000 → 2200`
- `noSpeechMs: 8_000 → 10_000`
- Effect: eliminates H1 immediately; keeps everything else identical.

**B. Harden iOS gesture handling**
- Skip `permissions.query` on Safari; call `getUserMedia` directly under the tap.
- Always `await audioContext.resume()` at the top of `handleMicTap`.
- Effect: fixes H2 / H3 / partial H5.

**C. Auto-reopen only if the page is visible and audio is unlocked**
- Guard the `turn-ended` reopen on `document.visibilityState === "visible"` and on the last user gesture being <60 s old, otherwise show a subtle "Tap to speak" cue.
- Effect: fixes H3 on lock-screen / backgrounded cases; avoids the ghost mic indicator.

**D. Replace `ScriptProcessorNode` with `AudioWorklet` + input-only graph**
- Bigger change, mainly future-proofing; only worth doing if A/B/C don't fully resolve on iOS 17/18.

## 7. Recommendation

Approve **A + B + C together** as a single batch (matches your batching preference). Cheap, isolated to two files, high-confidence hit on the exact symptom. Defer D unless A/B/C don't resolve it in real-device testing.

## 8. What I need from you

Just "approve A+B+C" (or a different combo). I'll implement, verify against a Playwright run of `/companion`, publish once, then hand it to you for a single acceptance test on your iPhone.
