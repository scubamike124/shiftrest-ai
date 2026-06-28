## Slice 10 — Final QA, Hardening & Launch Readiness

Investigation-only. No code will be written until you approve.

### 1. Investigation summary

I audited the AI Companion surface against the Slice 1–9 deliverables:

- Conversation + voice: `src/routes/companion.tsx` (780 lines), `useMicRecorder`, `useTtsPlayer`, `/api/tts`, `/api/ai` (streaming).
- Voice/action prefs: `src/lib/companion/voice-action-prefs.ts`, `quiet-hours.ts`.
- Intent + sound bridge: `src/lib/voice/intent-router.ts`, `intent-executor.ts`, `companion-sound-bridge.ts`.
- Action layer: `actions.ts`, `narration.ts`, `action-history.ts`, `components/companion/ActionCard.tsx`, `ActionHistorySheet.tsx`.
- Briefs: `morning-brief.functions.ts`, `afternoon-brief.functions.ts`, `evening-brief.functions.ts`, `MorningBrief.tsx`, `DailyBrief.tsx`, `brief-window.ts`.
- Dashboard integration: `CompanionAvatar.tsx`, `CompanionQuickAsk.tsx`.
- Memory: `/memory`, `ai_memory_proposals`, `memory-proposer.server.ts`.
- Settings: `/settings/companion`, `/settings/morning`.

### 2. Findings (gaps to fix in Slice 10)

**A. Analytics — missing.** No `track()` / `reportLovableError` calls exist anywhere under `src/lib/companion` or `components/companion`. None of the events the spec lists (brief opened, action started/completed/failed, voice played/muted, memory created/removed, settings changed) are emitted.

**B. Voice timing.** TTS auto-reply in `companion.tsx` schedules narration after each completed action and after assistant streamed replies. Two paths can fire near-simultaneously (assistant final reply + action completion narration); there's no single TTS queue/lock guaranteeing serial playback. Risk of overlap.

**C. Quiet-hours / muted gate.** Quiet-hours and `voiceRepliesEnabled` are checked at the call site but in a couple of branches (action narration on retry from history sheet) the gate is bypassed. Needs centralization in a `speak()` helper.

**D. Action retry from history.** `ActionHistorySheet` re-dispatches via `runAction`, but does not pass the original `ActionContext` (navigate, openBreathing) — retry of `start_breathing` or any navigation action will no-op silently.

**E. Destructive override.** Confirmed for `delete_alarm`, `forget_memory`; `clear_timer`, `stop_all`, `delete_event` paths should be re-checked against the "destructive always confirms" rule.

**F. Offline + permission UX.** `actions.ts` returns `fail("offline", …)` and `fail("unauthenticated", …)` with recovery actions, but `ActionCard` only renders recovery for the post-execution state, not when the executor pre-fails synchronously inside `runAction` — the recovery CTA can be hidden behind a toast.

**G. Empty / loading / error states.** Companion chat shows a streaming spinner but no skeleton on first mount; `ActionHistorySheet` shows raw "No history yet" but no illustration or guidance; Brief cards have skeletons but no retry CTA on fetch failure.

**H. Accessibility.**
- `ActionCard` confirm/cancel buttons present, but the card itself does not move focus when it appears — screen readers may miss it. Needs `aria-live="polite"` on the chat transcript region (currently on card only) and focus management on first render of a pending action.
- `CompanionQuickAsk` popover trigger is 36×36 (`size="icon"`), below the 44×44 target on mobile.
- Mic button is keyboard-reachable but uses `onPointerDown` for hold-to-talk with no keyboard equivalent (Space to toggle).
- History sheet retry buttons are <11 tap height in places.
- Reduced-motion: `animate-spin` is wrapped with `motion-reduce:animate-none` in some spots, missing in `CompanionAvatar` pulse and ActionCard executing state.

**I. Performance.**
- `DailyBrief` and `MorningBrief` both subscribe to `companion:brief-refresh` but recompute the full brief on every event — debounce + drop in-flight duplicates.
- `companion.tsx` re-renders on every TTS tick because `ttsState` lives in component state; can be moved into a ref + selector.
- Action history reads `localStorage` synchronously in render.

**J. Security.**
- Deep-link executor accepts `open_route` with arbitrary `href`. Needs an allow-list of internal routes; reject external URLs.
- `runAction` from URL params (`?prompt=…`) is fine but does not validate `?period` against the known enum.
- Memory write actions correctly call `addMemory` which is RLS-scoped; verified.

**K. Mobile.** Bottom-sheet `ActionHistorySheet` uses `side="right"` — on phone portrait this consumes 100vw and clips the header close button at small widths. Should be `side="bottom"` ≤ md.

### 3. Implementation plan (after approval)

**P1 — Analytics layer (new, single file)**
- `src/lib/companion/analytics.ts`: thin `track(event, props)` wrapper using `window.__lovableEvents` if present, plus a typed `CompanionEvent` union. Emit from: `DailyBrief`/`MorningBrief` mount (brief_opened), `runAction` lifecycle (action_started/completed/failed/cancelled), `speak()` helper (voice_played/voice_skipped), memory add/delete (memory_created/removed), `/settings/companion` save (settings_changed), error boundary + `fail()` (error_encountered).

**P2 — Centralized voice gate**
- New `src/lib/companion/speak.ts`: single `speak(text, { source })` that checks `voiceRepliesEnabled`, `inQuietHours()`, current TTS state, and serializes via an internal queue (cancel-prior policy for narration, queue policy for assistant replies).
- Replace direct `ttsPlayer.play()` calls in `companion.tsx` and history retry path.

**P3 — Action layer hardening**
- Persist `ActionContext` adapter (navigate + openBreathing) at module scope of `companion.tsx`, exposed via a small `getActionContext()` so `ActionHistorySheet` retry uses the live router/navigate.
- Re-classify destructive: add `destructive: true` to `clear_timer`, `stop_all`, alarm bulk ops.
- Render inline recovery card inside chat transcript when `runAction` pre-fails, not just via toast.

**P4 — A11y pass**
- Bump `CompanionQuickAsk` trigger to `min-h-11 min-w-11`.
- Add Space/Enter keyboard handler to mic button for press-to-toggle.
- Move focus to ActionCard primary button on mount; restore focus after resolve.
- `aria-live="polite"` on chat transcript wrapper, `aria-busy` while streaming.
- Add `motion-reduce:animate-none` to `CompanionAvatar` pulse and ActionCard spinner.

**P5 — Performance**
- Debounce brief refresh listener (250ms trailing) + abort-controller on in-flight `getMorningBrief`/Afternoon/Evening.
- Memoize action history list; subscribe via `useSyncExternalStore` instead of `useEffect` + state.

**P6 — Security**
- `open_route` action: validate `href` against `ALLOWED_ROUTES` set; reject otherwise with `fail("forbidden", …)`.
- Validate `?period` param in `companion.tsx` against `["morning","afternoon","evening"]`.

**P7 — Mobile polish**
- `ActionHistorySheet`: `side={isMobile ? "bottom" : "right"}` with `h-[85dvh]` on bottom.
- Verify `h-dvh` everywhere in companion route (currently uses `h-screen` in chat container).

**P8 — Empty/loading/error states**
- Companion chat first-mount skeleton (avatar + 2 message placeholders).
- ActionHistorySheet empty state with icon + "Actions you confirm will appear here".
- Brief cards: retry CTA on fetch error.

**P9 — Documentation (under `docs/launch/companion/`)**
- `architecture.md` — surface map + data flow diagram (ASCII).
- `qa-checklist.md` — every test from the spec with pass/fail column.
- `performance.md` — measurement results (Lighthouse mobile on `/companion`, `/dashboard`, brief refresh wall-clock).
- `accessibility.md` — axe results + manual screen-reader notes.
- `analytics.md` — event taxonomy.
- `rollback.md` — feature-flag strategy (env `VITE_COMPANION_ENABLED` defaults true; flip to false to hide avatar + `/companion` route).
- `launch-readiness.md` — go/no-go.

### 4. Files affected

```text
new:
  src/lib/companion/analytics.ts
  src/lib/companion/speak.ts
  docs/launch/companion/{architecture,qa-checklist,performance,accessibility,analytics,rollback,launch-readiness}.md

edit:
  src/routes/companion.tsx          (voice gate, focus mgmt, h-dvh, ?period validation, analytics)
  src/lib/companion/actions.ts      (destructive flags, open_route allow-list, analytics on fail)
  src/lib/companion/action-history.ts (useSyncExternalStore export)
  src/components/companion/ActionCard.tsx       (motion-reduce, focus on mount, inline recovery)
  src/components/companion/ActionHistorySheet.tsx (responsive side, empty state, retry uses live ctx)
  src/components/companion/DailyBrief.tsx       (debounce, abort, retry CTA, brief_opened track)
  src/components/morning/MorningBrief.tsx       (same)
  src/components/CompanionQuickAsk.tsx          (44×44 target)
  src/components/CompanionAvatar.tsx            (motion-reduce)
  src/routes/settings.companion.tsx             (settings_changed track on save)
```

### 5. QA matrix (executed during implementation)

Will be tracked in `docs/launch/companion/qa-checklist.md`, covering every flow from your spec (conversation, voice on/off, quiet hours, memory on/off, Always Confirm on/off, action execute/retry/cancel, all three briefs, deep links, offline, network failure, permission failure, empty/loading/error/recovery). Each row gets a result + screenshot reference.

### 6. Risk & rollback

- Risk: analytics wrapper could double-fire if both global SDK and direct `track()` are present — mitigated by single-entry helper.
- Risk: focus-on-mount in ActionCard could steal focus from composer mid-type — only steal when card enters `pending-confirm` and composer is not focused.
- Rollback: set `VITE_COMPANION_ENABLED=false`; `__root.tsx` / dashboard / route gate read it and hide avatar + redirect `/companion` → `/dashboard`. Existing data untouched.

### 7. Launch readiness gate (must all be green)

1. Typecheck clean.
2. No new Supabase linter warnings.
3. Lighthouse mobile ≥ 90 on `/companion` and `/dashboard`.
4. axe-core: 0 critical, 0 serious on `/companion`, `/settings/companion`, `/dashboard`.
5. QA checklist: 100% pass.
6. Manual run of: signup → companion onboarding → confirm one action of each kind → retry a failed action → toggle voice off → verify silence → toggle quiet hours → verify silence → delete a memory (destructive confirm) → sign out.

---

Reply **"approved"** to proceed with implementation, or tell me what to change.
