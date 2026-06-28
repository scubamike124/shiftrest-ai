# AI Companion — Slice 10 Launch Readiness

_Last updated: Slice 10 hardening pass._

## 1. Architecture summary

| Layer | Files | Notes |
| --- | --- | --- |
| Chat surface | `src/routes/companion.tsx` | Streaming chat, mic, ActionCards, deep-link prefill (`?prompt`, `?period`). |
| Daily briefs | `src/components/companion/DailyBrief.tsx`, `src/components/morning/MorningBrief.tsx` | Period-aware (morning / afternoon / evening). Listens to `companion:brief-refresh`. |
| Dashboard entry | `src/components/CompanionAvatar.tsx`, `src/components/CompanionQuickAsk.tsx` | Pulse when current period unseen. Quick-ask popover deep-links into `/companion`. |
| Actions | `src/lib/companion/actions.ts`, `src/components/companion/ActionCard.tsx` | Typed `CompanionAction` union, runtime allow-list for `open_route`, destructive override (`stop_all`, `clear_timer`, deletes). |
| Execution | `runAction` in `src/routes/companion.tsx`, `src/lib/companion/action-history.ts` | Records `executing → completed | failed | cancelled` with snapshot for retry. |
| Voice | `src/lib/companion/speak.ts`, `src/lib/companion/quiet-hours.ts`, `src/lib/companion/voice-action-prefs.ts` | Single TTS gate. Cancel-prior policy prevents overlap. Quiet-hours + voice-off short-circuit before any fetch. |
| Memory | `src/routes/memory.tsx`, `src/lib/memory-proposals.ts` | Proposal queue, explicit confirm/decline. Companion never invents routines silently. |
| Analytics | `src/lib/companion/analytics.ts` | Window CustomEvent `companion:analytics`. Tracks briefs, actions, voice, settings, errors. |

## 2. Files changed in Slice 10

- **Added** `src/lib/companion/analytics.ts`
- **Added** `src/lib/companion/speak.ts`
- **Added** `docs/companion-launch-readiness.md` (this file)
- **Hardened** `src/lib/companion/actions.ts` — destructive flags for `stop_all` & `clear_timer`; runtime allow-list for `open_route`.
- **Hardened** `src/components/companion/ActionCard.tsx` — keyboard focus on Confirm; existing aria-live retained.
- **Hardened** `src/components/companion/ActionHistorySheet.tsx` — bottom sheet on mobile, larger trigger (44×44), better aria-label.
- **Hardened** `src/components/companion/DailyBrief.tsx` — debounced refresh, analytics on open/failure.
- **Hardened** `src/components/morning/MorningBrief.tsx` — debounced refresh, analytics on open/failure.
- **Hardened** `src/components/CompanionQuickAsk.tsx` — 44×44 touch target.
- **Hardened** `src/routes/companion.tsx` — `speak()` integration with cancel-prior, analytics in run/cancel, `aria-live="polite"` chat log, `stopSpeaking()` on Stop tap.

## 3. QA checklist

| Area | Status |
| --- | --- |
| Conversation — text in / streamed out | ✅ |
| Voice replies on / off | ✅ |
| Quiet Hours — no narration in window | ✅ |
| Memory on / off — proposals respected | ✅ |
| Always Confirm on / off — destructive still gated | ✅ |
| Action execution (sounds, alarms, briefs, memory, layout, nav) | ✅ |
| Action retry from history (re-proposes with fresh context) | ✅ |
| Action cancel (records `cancelled`, fires `action_cancelled`) | ✅ |
| Morning / Afternoon / Evening Briefs render in window | ✅ |
| Dashboard avatar pulse clears after open | ✅ |
| Quick-ask popover deep-links to `/companion?prompt=...` | ✅ |
| Action history sheet — bottom sheet on mobile, side on desktop | ✅ |
| Deep links: `/companion?period=morning` forces morning brief | ✅ |
| Offline — TTS/STT/server fns degrade silently, action shows `offline` recovery | ✅ |
| Network failure — `action_failed` recorded with reason | ✅ |
| Permission denied — recovery CTA points to settings or sign-in | ✅ |
| Empty states — chat, history, briefs all have copy | ✅ |
| Loading states — Skeletons in briefs, `Working…` on action button | ✅ |
| Error states — error tracked, recovery CTA shown | ✅ |

## 4. Voice QA

- ✅ No overlapping narration — `speak()` uses monotonic `lastReqId`; fresh calls cancel pending fetches and pause prior audio.
- ✅ No duplicate playback — same `speak()` gate used by replies and narration.
- ✅ No narration during quiet hours — gated before fetch; analytics `voice_skipped: quiet_hours`.
- ✅ No narration when muted — gated by `voiceRepliesEnabled`; analytics `voice_skipped: disabled`.
- ✅ Stop button calls `stopSpeaking()` to abort current audio.
- ✅ TTS failure → silent fallback; chat reply still displayed visually.

## 5. Action QA

- ✅ Every action path returns `{ ok, message, error? }`.
- ✅ Destructive: `delete_alarm`, `forget_memory`, `hide_card`, `stop_all`, `clear_timer`, and `toggle_*` when turning a feature off — all require confirmation card.
- ✅ Retry from history re-proposes the action card; live `execCtx` is used at confirm time so navigation/auth always reflect current session.
- ✅ History capped (ring buffer in `action-history.ts`).
- ✅ Failed actions surface `recovery.label + href` when applicable.
- ✅ `open_route` runtime allow-list rejects unknown targets (`permission_denied`).

## 6. Performance

| Metric | Result |
| --- | --- |
| Companion mount | Single render path; lazy DailyBrief query gated by signed-in. |
| Brief refresh | Debounced 250 ms — coalesces rapid action-completion bursts. |
| Voice latency | Single in-flight TTS request; cancel-prior eliminates queue stalls. |
| Action latency | No extra round-trips added in Slice 10. |
| Memory retrieval | `/memory` paginated via existing query. |

## 7. Accessibility

- ✅ Chat list is a `role="log"` with `aria-live="polite"` + `aria-busy={sending}`.
- ✅ Confirm button auto-focuses when a fresh ActionCard mounts; cancel + confirm both ≥ 44 px.
- ✅ Quick-ask trigger is ≥ 44×44.
- ✅ History trigger ≥ 44 px tall with descriptive aria-label.
- ✅ All animated spinners include `motion-reduce:animate-none`.
- ✅ Focus visible rings on dashboard avatar and quick-ask.

## 8. Mobile

- ✅ Phone portrait (≤ 768 px): ActionHistorySheet uses bottom sheet.
- ✅ Tablet / desktop: history sheet uses right-side panel.
- ✅ Composer uses `safe-area-inset-bottom` padding (existing).
- ✅ Touch targets ≥ 44 px on all primary controls.

## 9. Security

- ✅ Memory writes require explicit user confirmation (proposal pattern).
- ✅ TTS / STT calls forward the live Supabase access token; no anonymous calls.
- ✅ `open_route` runtime allow-list mirrors the TS union — defends against stale cached actions.
- ✅ No secrets logged. Analytics emits CustomEvents in the page; no third-party transport added in this slice.
- ✅ Voice prefs stored in `localStorage` only — no PII leaves the device.

## 10. Analytics events

`window.addEventListener("companion:analytics", e => e.detail)` receives:

`brief_opened`, `brief_refresh_failed`, `action_started`, `action_completed`, `action_failed`, `action_cancelled`, `voice_played`, `voice_skipped (reason)`, `memory_created`, `memory_removed`, `settings_changed`, `error_encountered`.

## 11. Known limitations

- TTS playback uses the browser `<audio>` element — iOS Safari requires a user gesture; the first reply after page load may be silent until the user interacts.
- Wearable / calendar integrations remain stubbed where the user hasn't connected accounts.
- Action history is per-device (localStorage). No cross-device sync.
- Quick-ask popover is hidden on `< sm` widths by design; voice/avatar entry covers mobile.

## 12. Risk assessment

| Risk | Likelihood | Mitigation |
| --- | --- | --- |
| TTS overlap regression | Low | Centralized `speak()` gate, monotonic id, cancel-prior. |
| Destructive action runs without confirmation | Low | `isDestructive()` is referenced by the chat UI; expanded coverage in Slice 10. |
| Brief refresh thrash on many completions | Low | 250 ms debounce. |
| Unknown deep-link target | Low | Runtime allow-list in `open_route`. |

## 13. Rollback plan

1. Revert the Slice 10 commit (additive — no schema changes).
2. `speak()` import in `companion.tsx` falls back to the prior inline `speakIfEnabled` by reverting `src/routes/companion.tsx` only.
3. Analytics events are CustomEvents on `window`; no consumers in production yet, so removal is a no-op.
4. ActionCard / ActionHistorySheet / Quick-ask changes are CSS + a11y polish and safe to revert independently.
5. No DB migrations were introduced in Slice 10.

## 14. Launch readiness

- [x] TypeScript clean
- [x] No regressions in Slice 1–9 surfaces
- [x] Destructive guardrails enforced
- [x] Voice gate centralized
- [x] Accessibility passes manual sweep (focus, ARIA, motion)
- [x] Mobile bottom-sheet for history
- [x] Analytics emitted for every measurable interaction
- [x] Rollback path documented

**Status: Ready for the first public RestPilot AI Companion release.**
