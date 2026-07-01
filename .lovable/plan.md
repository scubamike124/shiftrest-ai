# Phase 1 Scope Change — Remove Smart Alarm (Hide, Don't Delete)

## Approach

Introduce **one feature flag** — `SMART_ALARM_ENABLED = false` in a new `src/lib/flags.ts` — and gate every user-facing entry point on it. Server/cron/DB/push code stays intact but becomes dormant because no alarm rows will be created. Restoring for Phase 2 = flipping the flag to `true`.

No file deletions. No database/cron changes. No refactor of `SmartAlarmCard.tsx`, `dispatch-alarms.ts`, push enrollment, or the QA harness.

## Files to change (surface removal only)

1. **`src/lib/flags.ts`** — new file. Export `SMART_ALARM_ENABLED = false`.
2. **`src/routes/events.tsx`** — remove `<SmartAlarmCard />` mount + drop "& Smart Alarm" from title/heading/meta. Page becomes Events-only.
3. **`src/routes/dashboard.tsx`** — remove `<SmartAlarmCard />` render (~line 381) and its import.
4. **`src/routes/index.tsx`** — remove `<SmartAlarmMock />` from the marketing homepage (~line 582) and the mock component definition (~line 618).
5. **`src/components/home/QuickActionsCard.tsx`** — drop the "Smart Alarm" tile.
6. **`src/components/site/AppSidebar.tsx`** — rename "Events & Alarm" → "Events" (icon unchanged).
7. **`src/components/morning/MorningBrief.tsx`** — filter `"alarm"` out of `visibleCards` when flag is off (keeps the card type registered for Phase 2).
8. **`src/routes/settings.morning.tsx`** — hide the "Smart Alarm" card toggle when flag is off.
9. **`src/routes/features.tsx`** — remove the Smart Alarm feature block and the bullet in the "Every feature" description.
10. **`src/routes/pricing.tsx`** — remove "Smart Alarm + Long Clock" bullet and the Smart Alarm comparison row.
11. **`src/routes/qa.smart-alarm.tsx`** — leave the file in place (dev-only QA); no nav link points to it. No change needed.

## What stays untouched (Phase 2 restore surface)

- `src/components/SmartAlarmCard.tsx`, `SmartAlarmCoach.tsx`, `morning/cards/AlarmCard.tsx`
- `src/lib/alarm/*` (foreground, push-enroll, prefs, sounds)
- `src/routes/api/public/hooks/dispatch-alarms.ts` + `pg_cron` job
- Push subscription plumbing
- DB tables and `user_events` schema
- `notifications/*`, `voice/intent-*` alarm intents (dormant; no user path reaches them once UI is hidden)

## Roadmap update

Update `.lovable/plan.md` roadmap section:
- **Phase 1:** AI Companion, Sleep Coaching, Sleep Tracking, AI Insights, Bedtime Guidance, Relaxation, Ambient Sounds, Wearable Integration, previously approved items.
- **Phase 2:** Smart Alarm, Intelligent Wake Experience, AI Wake Routines, Smart Alarm Integrations, Advanced Wake Automation.

## Verification

1. `tsgo` typecheck clean.
2. Grep confirms no remaining user-visible "Smart Alarm" / "Alarm Clock" strings outside gated code and legal pages.
3. Playwright: load `/`, `/dashboard`, `/events`, `/features`, `/pricing` — no Smart Alarm UI; nav has no broken links; `/events` still lists events.
4. Confirm `SmartAlarmCard` file still compiles (imported nowhere at runtime, but preserved).

## Risk

Very low. Flag-gated hide; no schema/cron/push changes. Restore = flip `SMART_ALARM_ENABLED` and re-add the ~9 gated JSX blocks (or wrap them in `{SMART_ALARM_ENABLED && ...}` now so Phase 2 is a one-line toggle — recommended, and included in the plan above).

Awaiting approval before implementing.