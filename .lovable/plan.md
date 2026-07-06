## Findings

Prod bundle audit (`assets/plan-CojTM1f4.js`, currently served) confirms all diagnostic code is present:
- `companion:tts-path` listener is registered
- The "TTS path" JSX row renders unconditionally whenever `timing` is set (with `"waiting…"` fallback)
- `emitTtsPathDiagnostic` call sites in `speak.ts` (cache-blob / MSE / blob-fallback) all run BEFORE audio start
- `TTS_PATH_DIAGNOSTIC_BUILD` and `__restpilotLastTtsPath` global are wired

So the section should at minimum display "waiting…" and the build tag as soon as the timing panel appears. If the screenshot shows summary rows but not even the "TTS path" label, the JSX block is being skipped by the render pass — most likely because a stale `plan-*.js` chunk is still in the browser cache from before publish, OR the setTiming state gate (`prev.traceId !== traceId`) silently drops the event in an edge case (e.g. component remount between tap and event dispatch clears traceId).

## Root-cause investigation plan

Add unconditional, cache-busting instrumentation so the next test tells us definitively which branch is failing: (a) event never fires, (b) event fires but state gate rejects it, or (c) state updates but JSX doesn't render.

### Changes

1. **`src/components/VoicePlayer.tsx`**
   - Add a new `diag` state `{ heard: number; lastDetail: TtsPathDetail | null }` updated inside `onTtsPath` BEFORE the traceId gate — so it increments even if the gate rejects.
   - Also read `window.__restpilotLastTtsPath` on every render as a last-resort fallback source for the displayed path.
   - Render three new always-visible lines in the timing panel:
     - `heard: N` (listener fire count)
     - `gate: pass|reject` (whether the state update actually applied)
     - `global: <path|—>` (value of `window.__restpilotLastTtsPath?.label`)
   - Keep the existing "TTS path / build …" rows.

2. **`src/lib/companion/speak.ts`**
   - Bump `TTS_PATH_DIAGNOSTIC_BUILD` to `tts-path-diagnostic-2026-07-06-02` so we can verify a fresh bundle in prod.
   - No behavior change to the emit sites.

### Verification (I do this before asking you to test)

1. Build finishes clean (no TS errors).
2. Fetch prod HTML → note new `plan-*.js` chunk hash (must differ from `plan-CojTM1f4.js`).
3. `curl` that chunk and grep for:
   - `tts-path-diagnostic-2026-07-06-02` (new tag)
   - `heard:` and `gate:` (new UI strings)
4. Report the hash + grep counts verbatim, then hand off.

### Expected outcomes when you run the test

- `heard: 0` → the event never fires → bug is in `speak.ts` emit path (network/error branch bypasses emit).
- `heard: ≥1` and `gate: reject` → the traceId guard is dropping it → fix the state gate.
- `heard: ≥1`, `gate: pass`, but UI still blank → React render issue (very unlikely given bundle audit); we'll investigate DOM directly.
- `global:` shows a value but state rows don't → confirms the state gate is the culprit.

Tripwire markers left in place — not touching them.