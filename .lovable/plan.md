# Slice 9 — Real Action Execution Layer

## 1. Investigation summary

### What already exists (reuse, don't rebuild)
- **Action types & registry** — `src/lib/companion/actions.ts` defines `CompanionAction`, `describeAction`, `executeAction`, `intentToAction`. Today it handles: sound playback, stop-all, sleep timer, breathing, wind-down, navigation, smart-alarm prefill, evening summary nav. Several kinds (`create_reminder`, `text_contact`, `calendar_event`, `start_meditation`) are explicit "coming soon" stubs.
- **Confirmation UI** — `src/components/companion/ActionCard.tsx` (Confirm / Cancel, `done` collapsed state, unavailable reason).
- **Companion chat surface** — `src/routes/companion.tsx` already wires `executeAction` from both AI-proposed actions and the voice intent router (`intentToAction`), respects `requireActionConfirmation`, auto-runs nav, and TTS-narrates results when voice replies + quiet hours allow.
- **Sound system** — `src/lib/sounds/mixer.ts` (`play`, `stop`, `stopAll`, `setSleepTimer`, `clearTimer`, `setVolume`, `snapshot`, `applyMix`, `isActive`).
- **Smart Alarm** — `src/components/SmartAlarmCard.tsx` creates an alarm by inserting `user_events` rows (`kind=personal`, `title="alarm:HH:MM"`) via `src/lib/events.ts` (`addEvent`, `updateEvent`, `removeEvent`, `listEvents`).
- **Prefs** — `src/lib/prefs.ts` (`updatePrefs`) covers `notifications`, `memoryEnabled`, `memoryLearningPaused`, `briefEnabled`, `brief_layout` (order / hidden cards per period), voice settings.
- **Local prefs** — `src/lib/companion/voice-action-prefs.ts` for per-device toggles + quiet hours; `quiet-hours.ts` for window math.
- **Memory** — `ai_memory` + `ai_memory_proposals` tables; existing `/memory` route handles edits/forgets.

### Real gaps the slice closes
1. No **central executor** — `executeAction` is a single switch returning `{ok,message}`; no Queued/Executing/Completed/Failed/Cancelled state machine, no history, no retry.
2. Smart-alarm "actions" today only **navigate** to `/events` with a prefilled time; they do not create / edit / delete / enable / disable / snooze alarms.
3. No volume / switch-sound / explicit-stop-one action kinds for the mixer.
4. No actions for: brief refresh, "remember this", "forget this", summarize today, review tomorrow, toggle voice / notifications / memory / confirmations, pin / reorder / hide dashboard cards.
5. Confirmation policy is binary (`requireActionConfirmation`). Spec requires destructive actions (delete, forget, disable, reset) to **always** confirm regardless of the toggle.
6. No structured error taxonomy (offline / auth / validation / not-found / permission denied), no recovery suggestions, no Action History UI, no retry button.
7. Voice narration in `companion.tsx` speaks the raw result message; spec asks for natural assistant-style narration + a serialization queue so replies don't overlap.

### Permission / safety model
- Honor `localPrefs.requireActionConfirmation` (per-device).
- Honor `localPrefs.voiceRepliesEnabled` + `quietHours` + `localPrefs.actionSuggestionsEnabled`.
- Honor server prefs: `notifications`, `memoryEnabled`, `memoryLearningPaused`, `briefEnabled`.
- Honor auth: any DB-touching action checks `supabase.auth.getUser()`; offline → typed `OfflineError`, queued for retry but never auto-executed silently.
- Destructive set (`delete_alarm`, `disable_alarm`, `forget_memory`, `reset_*`, `toggle_*` to OFF for safety-critical features) **forces** a confirmation card even when `requireActionConfirmation` is OFF.

### Edge cases
- Sound action fired before AudioContext unlock → mixer already handles user-gesture unlock; we surface "Tap to enable sound" error.
- Alarm time in the past → bump to next day in handler.
- Duplicate alarm at same HH:MM → reuse existing row, return `Completed` with "Already scheduled".
- Memory action while `memoryEnabled=false` → blocked with clear reason + deep link to `/settings/companion`.
- Concurrent executions → executor serializes per-action-kind where mixer state matters; others run in parallel.
- TTS overlap → single playback queue in `useTtsPlayer`; new narration cancels nothing already playing, just queues.

### Rollback strategy
- New executor lives behind `src/lib/companion/executor.ts`; existing `executeAction` becomes a thin shim that delegates. If a regression appears, revert the shim line to call the old switch.
- Action history is localStorage-only (no schema change), so removing the UI removes all trace.
- No DB migrations required for the slice itself; alarm CRUD reuses `user_events`.

## 2. Architecture

```text
                  ┌─────────────────────────────┐
ChatMsg ─────────►│  ActionCard (confirm UI)    │
VoiceIntent ─────►│   + destructive override    │
QuickAsk  ───────►└──────────────┬──────────────┘
                                 │ confirm
                                 ▼
                  ┌─────────────────────────────┐
                  │  ActionExecutor (single)    │
                  │  - state: queued/exec/done  │
                  │  - per-kind serialization   │
                  │  - typed handlers registry  │
                  │  - structured errors        │
                  │  - emits to ActionHistory   │
                  │  - emits to TTSQueue        │
                  └──────────────┬──────────────┘
                                 │
       ┌──────────┬──────────────┼──────────────┬─────────────┐
       ▼          ▼              ▼              ▼             ▼
   mixer       events.ts     prefs.ts     memoryProposals  router.nav
   (sounds)    (alarms)      (toggles)    + ai_memory      (deep links)
```

### Action state machine
`queued → executing → completed | failed | cancelled`. Cancelled = user hit Cancel on the card before execute or pressed Stop while executing (sound actions only — abort fades).

### Error taxonomy (`ActionError.kind`)
`offline` · `unauthenticated` · `permission_denied` · `not_found` · `validation` · `conflict` · `unavailable` · `unknown`. Each carries `message` and optional `recovery: { label, action: CompanionAction | () => void }` so the failure card can offer "Open settings" / "Retry" / "Sign in".

## 3. Action catalog (final)

| Domain | Kinds | Destructive |
|---|---|---|
| Sounds | `play_track`, `stop_track`, `stop_all`, `set_timer`, `clear_timer`, `set_volume`, `switch_track`, `wind_down`, `start_breathing` | no |
| Smart Alarm | `create_alarm`, `edit_alarm`, `delete_alarm`, `snooze_alarm`, `enable_alarm`, `disable_alarm` | delete / disable |
| Briefs | `refresh_brief`, `open_brief_section` (weather/commute/calendar/reminders) | no |
| Evening | `start_bedtime_routine`, `launch_wind_down`, `begin_sleep_session` | no |
| Companion | `remember_this`, `forget_memory`, `summarize_today`, `review_tomorrow` | forget |
| Settings | `toggle_voice`, `toggle_notifications`, `toggle_memory`, `toggle_confirmations` | toggling OFF |
| Dashboard | `open_card`, `pin_card`, `reorder_cards`, `hide_card`, `show_card` | hide |
| Nav | `open_route` (existing) | no |

## 4. Files

### New
- `src/lib/companion/executor.ts` — `ActionExecutor` class, handler registry, error types, event emitter.
- `src/lib/companion/handlers/{sounds,alarm,brief,memory,prefs,layout,nav}.ts` — one focused handler module per domain.
- `src/lib/companion/action-history.ts` — localStorage ring buffer (last 50), `subscribe`, `add`, `retry`.
- `src/lib/companion/narration.ts` — natural-language formatter ("Your alarm is set for 6 AM.").
- `src/components/companion/ActionStatusInline.tsx` — Executing / Completed / Failed pill rendered inside `ActionCard` while or after running; reduced-motion aware.
- `src/components/companion/ActionHistorySheet.tsx` — Sheet listing recent actions with status + Retry; opened from chat header.

### Modified
- `src/lib/companion/actions.ts` — expand union, keep `describeAction`/`executeAction` API; `executeAction` becomes a delegating shim around the executor (backward compatible for any existing call site).
- `src/components/companion/ActionCard.tsx` — render new status pill, surface `ActionError.recovery` button when failed, force-confirm badge for destructive actions, ARIA `aria-live="polite"` on the status region.
- `src/routes/companion.tsx` — use executor's event stream instead of an awaited `executeAction` for progress updates; force-confirm destructive actions even when `requireActionConfirmation=false`; queue narration through a single TTS lane.
- `src/lib/voice/intent-executor.ts` — for kinds covered by the executor, delegate to it; keep voice-only intents (`save_mix`, `cancel`, `unknown`) unchanged.
- `src/lib/companion/voice-action-prefs.ts` — no schema change; document destructive override.

### Untouched
- `src/lib/sounds/mixer.ts`, `src/lib/events.ts`, `src/lib/prefs.ts`, all server functions, all DB schema. Slice 9 is a UI/orchestration layer.

## 5. Confirmation flow

```text
proposeAction(a)
  ├─ destructive(a) ──── true ──► render ActionCard (Confirm required, "Destructive" badge)
  └─ requireActionConfirmation
        ├─ true  ──► render ActionCard
        └─ false ──► describeAction(a).isNavigation
                        ├─ true  ──► auto-run (no card)
                        └─ false ──► run immediately, render done card retroactively
```

## 6. Voice narration
- New `narration.ts` produces assistant-style text per action result (not the raw toast message).
- A single `ttsQueue` in `companion.tsx` ensures replies serialize; new narration enqueues, never preempts.
- Suppressed when `voiceRepliesEnabled=false` or `inQuietHours(now, quietHours)`.

## 7. Action History
- localStorage key `restpilot.companion.history.v1`, max 50 entries `{id, kind, label, status, at, errorKind?}`.
- Accessible via a History icon in the chat header → opens `ActionHistorySheet`.
- Retry button visible only for `failed` rows whose error kind is retryable (`offline`, `unknown`, `conflict`).

## 8. Accessibility
- `ActionCard` keeps Radix-based buttons (focus ring, keyboard).
- Status region uses `role="status"` + `aria-live="polite"`.
- Destructive cards add `aria-describedby` pointing at a "This action cannot be undone" note.
- Tap targets ≥44px, History sheet uses existing `Sheet` primitive.
- Honor `prefers-reduced-motion` for the executing spinner (swap to static dot).

## 9. Testing strategy
- Unit (`bunx vitest run`): executor state transitions, destructive-override logic, error taxonomy, narration strings, history ring buffer.
- Integration via Playwright against the running app:
  1. Voice-route → "play rain" with Always Confirm ON → card appears, Confirm starts mixer, completed card + history entry.
  2. Chat → "set an alarm for 6 am" → confirm → row inserted in `user_events`, alarm visible in Smart Alarm card.
  3. Toggle memory OFF via action while `memoryEnabled=true` → forced confirm (destructive), pref flipped, /settings/companion reflects it.
  4. Forced offline → action returns `offline` error with Retry button; reconnect + Retry → completes.
  5. Quiet hours active + voice replies on → no TTS audio fires (assert via `useTtsPlayer` queue length).
- `tsgo` clean, `bunx vitest run` clean.

## 10. Risks & mitigations
| Risk | Mitigation |
|---|---|
| Regressing existing voice/sound flows | Keep `executeAction` signature; executor wraps the old switch for unchanged kinds first, new handlers added behind flags-by-kind. |
| Accidentally toggling notifications to OFF | Destructive override forces confirmation. |
| TTS overlap | Single FIFO queue in `companion.tsx`. |
| LocalStorage bloat | Hard cap 50 entries; trim on insert. |
| Alarm dupes on retry | Handler dedupes by HH:MM. |

## 11. Rollback
1. Replace `executeAction` body with the previous switch (kept in git history).
2. Remove `ActionHistorySheet` mount + executor import — UI degrades to Slice 8 behavior with zero data loss.

---

**Awaiting approval — no code will be written until you confirm.**