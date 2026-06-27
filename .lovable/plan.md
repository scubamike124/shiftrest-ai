## Bundle 2 — Daily Life Intelligence

Built strictly on Bundle 1: one orchestrator (`/api/ai`), one memory system, one notification/cron pipeline, one logging + budget gate. No duplicate routes. No duplicate AI plumbing.

### Architecture decisions

1. **Everything is an intent on `/api/ai`.** New intents added: `daily_plan`, `smart_alarm`, `commute`, `coach_tip`, `reminder_draft`. The streaming `coach` intent stays. Memory recall + budget + logging are inherited unchanged.
2. **Two new tables.** Everything else reuses what exists (`shifts`, `user_prefs`, `notification_prefs`, `notification_log`, `push_subscriptions`, `ai_memory`, `ai_log`, `wearable_readings`).
3. **One scheduler.** The existing `src/lib/notifications/schedule.ts` is extended with event-driven candidates (smart alarm, calendar reminders, commute pings). Cron remains every 5 min; no new cron job. New `ReminderKind`s added to `copy.ts`.
4. **Routine learning = opt-in.** Lives behind `memoryEnabled` exactly like Bundle 1. A nightly job summarises the last 14 days' shift/wake patterns into `ai_memory` rows tagged `category='routine'` — never written when the user has memory off.
5. **Productivity Coach is not a new screen.** It's a `coach_tip` intent surfaced as a single card on the dashboard, generated on-demand (cached 6h per user in `ai_log` payload key), so we don't burn budget per render.
6. **Personalized Daily Recommendations** unifies the existing `recommendations.ts` deterministic engine with a thin AI re-rank pass (`daily_plan` intent) when memory is enabled — otherwise the deterministic output ships as-is. No half-finished AI fallback.

### Database changes (one migration)

- `user_events` — calendar/commute/personal events the planner respects.
  - `id, user_id, kind ('calendar'|'commute'|'personal'), title, starts_at timestamptz, ends_at timestamptz, location text null, source ('manual'|'google'|'ics') default 'manual', reminder_min int default 15, created_at, updated_at`.
  - RLS scoped to `auth.uid()`. Grants per the public-schema rule.
- `notification_prefs`: add three booleans — `smart_alarm`, `commute`, `calendar` — default false (opt-in).
- `notification_log`: extend allowed `kind` set via app code (no enum constraint to alter).
- `ai_log`: no change.
- Update `has_ai_budget` cap default unchanged (60k/day).

Google Calendar will use **per-user OAuth** (not the workspace connector) — deferred sync surface: `user_events.source='google'` is reserved, but the launch ships manual + ICS paste. AI plans accept events regardless of source.

### Server (new intents on `/api/ai`)

All non-stream intents return JSON. All log to `ai_log`. All gated by `has_ai_budget`.

- `daily_plan` — input: `{ horizon: '24h'|'72h' }`. Server pulls shifts, prefs, last-night wearable, today's `user_events`, recent memories. Calls `chatJSON` with a strict JSON schema returning `{ actions: Recommendation[], headline: string, riskLevel: 'low'|'medium'|'high' }`. Falls back to deterministic `buildRecommendations` on AI failure.
- `smart_alarm` — input: `{ targetWakeMin, windowMin }`. Deterministic for launch: picks the lightest-sleep minute inside the window using last 7 nights' wearable cadence; AI only generates the wake-up copy. Returns `{ wakeAt, reason }`. Writes a single `user_events` row of kind `personal` consumed by the scheduler.
- `commute` — input: `{ origin?, destination?, leaveBy }`. Returns `{ leaveAt, prepStartAt, advice }`. If the user has a commute event today the scheduler emits a `commute` reminder.
- `coach_tip` — input: `{ context: 'dashboard' }`. Returns one short proactive nudge (≤140 chars). Server caches per user per 6h in `ai_log.payload` to keep cost bounded.
- `reminder_draft` — input: `{ when, topic }`. AI-rewrites a reminder's `title`/`body` in the user's assistant voice; falls back to template copy.

### Scheduler / notifications

`schedule.ts` extended:
- New `ReminderKind`s: `smart-alarm`, `calendar-prep`, `commute-leave`.
- Loader queries `user_events` for the next 24h alongside today's shift and emits candidates `event.starts_at - reminder_min` (calendar) and `event.starts_at - travelBuffer` (commute).
- Smart-alarm candidate emitted at the chosen wake minute; suppressed by quiet-hours like any other reminder but **whitelisted to ignore daily cap** (alarms must fire).
- Service worker (`public/sw.js`) handles `kind === 'smart-alarm'` by ringing with `requireInteraction: true` and `silent: false`. Falls back to in-app banner if push fails.

### Client

- `src/lib/events.ts` — CRUD for `user_events` (mirrors `shifts.ts` patterns).
- `src/lib/ai-client.ts` — thin typed wrapper around `/api/ai` for the new JSON intents (reuses existing bearer attachment).
- `src/components/SmartAlarmCard.tsx` — set wake target + window; shows resolved alarm time.
- `src/components/EventsList.tsx` — calendar/commute manager (add, edit, delete, ICS paste).
- `src/components/CoachTipCard.tsx` — single tip on dashboard, 6h client-side stale check.
- `src/components/DailyPlanCard.tsx` — replaces today's deterministic-only list on `/plan` with the AI-reranked actions when memory is on, deterministic when off.
- New tab on `/plan`: **Today's plan** (default), **Events**, **Smart alarm**.

### Privacy / safety

- Memory writes still gated by `memoryEnabled`.
- Routine summarisation job runs nightly via the existing cron worker (new branch, not a new endpoint). Skips users with memory disabled and users with `last_routine_summary > 7d` deduping window.
- `user_events` never leaves the user's account; not used as memory.
- AI failures degrade silently to the deterministic engine — no broken state shipped.

### What is explicitly NOT shipping in Bundle 2 (deferred, not half-built)

- Native Google Calendar OAuth sync (UI shows "import .ics" only; OAuth is a Bundle 4-class effort).
- Live traffic / Maps API for commute (uses user-set `travelBuffer` minutes; no provider key shipped).
- iOS critical-alert entitlement for the smart alarm (web push only; native wrapper is a separate track).

### Files touched

```text
migration: user_events + notification_prefs columns + grants/RLS
src/lib/ai-client.ts            (new — typed orchestrator client)
src/lib/events.ts               (new)
src/lib/notifications/copy.ts   (add 3 ReminderKinds)
src/lib/notifications/schedule.ts (event-driven candidates)
src/lib/notifications/run.server.ts (load user_events, route smart-alarm)
src/routes/api/ai.ts            (5 new intents; no new route file)
src/components/SmartAlarmCard.tsx (new)
src/components/EventsList.tsx   (new)
src/components/CoachTipCard.tsx (new)
src/components/DailyPlanCard.tsx (new)
src/routes/plan.tsx             (tabs + new cards)
src/routes/index.tsx            (mount CoachTipCard)
src/routes/profile.tsx          (mount notification toggles for new kinds)
public/sw.js                    (smart-alarm handling)
```

### Order of execution

1. Migration (tables, grants, RLS).
2. Server intents in `/api/ai` + `ai-client.ts`.
3. Notification scheduler + copy + SW alarm handling.
4. UI cards + `/plan` tabs.
5. Dashboard tip + nightly routine job branch.
6. Typecheck, mobile viewport sanity pass.

Proceeding straight through unless you want to pin a different scope first.
