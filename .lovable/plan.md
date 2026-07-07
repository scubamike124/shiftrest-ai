## Scope

Remove the four temporary debug UI panels added during today's investigations. Make an explicit call on `/version` and the publish-verify marker.

## Item-by-item

### 1. "Conversation-style debug (temporary)" panel — REMOVE
- Delete `src/components/debug/AssistantModeDebugPanel.tsx`
- Delete `src/lib/debug/assistantModeDebug.ts`
- In `src/routes/profile.tsx`: drop the `AssistantModeDebugPanel` import (line 51), the `amDebugPush` import (line 52), the three `amDebugPush(...)` calls inside the mutation (lines 100, 109, 134), and the `<AssistantModeDebugPanel />` render (line 628).
- In `src/lib/prefs.ts`: remove the two `amDebugPush` dynamic-import blocks around lines 381–393 (four `amDebugPush` calls total).

**Final state of Profile › "Your AI assistant" section:** identical to today minus the amber panel below the conversation-style buttons.

### 2. "build b-… modes:9 selected:…" stamp — REMOVE
- In `src/components/AssistantSettings.tsx`: delete the `declare const __BUILD_ID__`, the `buildStamp` const, and the amber `<p data-testid="assistant-settings-buildstamp">…</p>` block (lines 7–8, 32–33, 42–49).

**Final state of the "Your AI assistant" card:** heading → name input → Conversation style grid (no amber build stamp between heading and name).

### 3. `brief-timing #xxxxx` panel on Smart Light Plan — REMOVE
- In `src/components/VoicePlayer.tsx`: strip the timing/diagnostic scaffolding — the `Timing`/`TimingRow` types, the `timing`/`diag` state, the `mark(...)` helper, all `mark("tN", …)` calls, the `onStarted` + `onTtsPath` listeners, the entire `{timing && (…)}` render block (lines 270–332), and the now-unused `TTS_PATH_DIAGNOSTIC_BUILD` import.
- In `src/lib/companion/speak.ts`: delete `TTS_PATH_DIAGNOSTIC_BUILD`, the `TtsPathDiagnostic` type, the `emitTtsPathDiagnostic` helper, the three `emitTtsPathDiagnostic({...})` call sites (lines 667, 762, 788), the `__restpilotLastTtsPath` window assignment, and the `companion:tts-path` custom event. Keep `getMseAvailability` since it's used for real path selection, not just diagnostics.

**Final state of Smart Light Plan:** Voice briefing button + Share button as before. No black timing panel below.

### 4. `/version` page — KEEP as permanent internal tool, but clean it up
Recommendation: keep. It's `noindex`, not linked from any nav, and is genuinely useful for confirming which build is live after publish (especially on installed iPhone PWAs). Cost is trivial.

Cleanup while keeping it:
- Delete the amber "🟠 Publish canary v5 — breadcrumb test…" banner (lines 82–84). It was for one specific test.
- Keep everything else: build IDs, service worker state, PWA activity log. These are the actual value.
- `src/lib/pwa/breadcrumbs.ts` stays (feeds the activity log).

**Final state of /version:** same page minus the orange canary chip in the header.

### 5. Publish-verify marker — KEEP (confirmed invisible)
Grepped every consumer:
- `src/routes/__root.tsx` line 34 declares the constant and assigns `window.__LOVABLE_PUBLISH_MARKER` at module scope.
- Zero references anywhere else. Never rendered in JSX, never read by another component.

Confirmed: not visible in the DOM, only accessible via DevTools `window.__LOVABLE_PUBLISH_MARKER`. Harmless tripwire. Keeping.

## Verification before publish

Run typecheck; grep the tree afterwards to prove every marker is gone:
`amDebug | AssistantModeDebugPanel | brief-timing | TTS_PATH_DIAGNOSTIC_BUILD | emitTtsPathDiagnostic | companion:tts-path | __restpilotLastTtsPath | assistant-settings-buildstamp | Publish canary` → expect zero hits in `src/` for all of them.

## After you approve

I'll apply the edits, typecheck, show you the final state of `src/components/AssistantSettings.tsx`, the Profile section, `src/components/VoicePlayer.tsx`, and `/version` before publishing — then publish once.
