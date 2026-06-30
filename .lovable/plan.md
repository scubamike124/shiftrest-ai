# Smart Alarm — Expanded Adjustment Window

## Investigation summary

Smart Alarm adjustment is local UI state, not persisted. The window value travels:

1. `src/components/SmartAlarmCard.tsx` — segmented control (`exact` vs `smart`) + `<select>` of allowed minutes (`ADJUSTMENT_OPTIONS`: 0/5/10/15/30). Currently passes `windowMin` to `aiSmartAlarm` and clamps any AI drift > `maxAdjustmentMin` back to the exact time.
2. `src/lib/ai-client.ts` — `aiSmartAlarm({ targetWakeIso, windowMin })` forwards to `/api/ai`.
3. `src/routes/api/ai.ts` (`smart_alarm` intent) — passes `windowMin` and `maxAdjustmentMin` straight into `SMART_ALARM_SYSTEM` prompt; no numeric validation/clamp server-side, accepts any number.
4. No DB column / user_prefs key stores the user's chosen window — defaults rebuild on each visit to `exact` / 0. So "existing users keep their preference" is automatically true (nothing to migrate), but we will also add lightweight `localStorage` persistence so a returning user sees their last pick.

No other surfaces (Companion intents, Pilot, notifications) pass `windowMin`; intent-router only triggers alarm creation at the exact requested time. Safe to change in `SmartAlarmCard` alone.

## Changes

### 1. `src/components/SmartAlarmCard.tsx`
- Replace `ADJUSTMENT_OPTIONS` with the full list:
  - `0` → "Exact Time (analyze only)"
  - `5` → "±5 min"
  - `10` → "±10 min"
  - `15` → "±15 min"
  - `20` → "±20 min" *(new)*
  - `30` → "±30 min" *(new label)*
  - `9999` sentinel → "Full Smart Mode (Adaptive)" *(new — passes a wide window, e.g. 60 min, to the AI)*
- Keep the two-button `exact` / `smart` segmented control. Selecting `0` inside Smart mode is now valid and shows an "Exact Time — AI will analyze but won't move your alarm" badge.
- Dynamic explanation block (already present) updated to four cases:
  - exact mode → "RestPilot will ring at the exact time you selected."
  - smart + 0 → "AI will analyze your sleep but will not change your scheduled wake time."
  - smart + N (5–30) → "AI may move your alarm by up to N minutes earlier or later to land on a better sleep moment."
  - smart + Adaptive → "Full Smart Mode — AI may move your alarm up to ~60 minutes to find the optimal wake moment in your sleep cycle."
- "Exact Time" visual indicator: when effective window is 0 (either mode = exact OR smart+0), render the result card header as "Exact time" with an indigo dot, matching today's existing `lastResult.adjusted` styling.
- For Adaptive, send `windowMin: 60` to `aiSmartAlarm` and label the result card as "AI chose (Adaptive)". Existing clamp logic still enforces the user-allowed limit.
- Persist `{ adjustmentMode, maxAdjustmentMin }` in `localStorage` under `restpilot:smart-alarm:prefs` and rehydrate on mount. No DB / no migration.

### 2. No server changes required
`/api/ai` already accepts any numeric `windowMin`. Confirmed no validators reject 0, 20, or 60.

### 3. No DB / prefs schema changes
No existing user has a stored window value, so nothing to backfill.

## Affected files
- `src/components/SmartAlarmCard.tsx` (only file edited)

## Out of scope
- Server-side schema validation of `windowMin` (current behavior is permissive and matches user intent).
- Persisting the preference into Supabase `user_prefs` (local-only is sufficient for "remember my last choice"; can be promoted later if requested).
- Changes to Companion/Pilot voice flows — they don't expose window selection.

Approve to implement.
