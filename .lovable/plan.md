
# Smart Alarm Reliability & Mobile UI Polish — Investigation + Plan

## 1. Smart Adjustment Bug — Root Cause

I traced the full pipeline:

```
SmartAlarmCard.schedule()
  → aiSmartAlarm({ targetWakeIso, windowMin })           // src/lib/ai-client.ts
  → POST /api/ai  intent="smart_alarm"                   // src/routes/api/ai.ts
  → returns { wakeAt, reason, ... }
  → createEvent({ startsAt: wake.toISOString() })        // saves adjusted time
  → addAlarm({ firesAt: new Date(saved.startsAt) })      // foreground timer
```

The scheduling path itself is correct — it uses the AI's `wakeAt`, not the original target. The actual root cause is a **UX trap in the picker**, plus two reinforcing issues:

**Root cause A (primary, UX):**
When the user toggles **Smart Adjustment**, `maxAdjustmentMin` stays at its initialized value `0` ("Exact Time (analyze only)"). The code path then takes the `analyzeOnly` branch and explicitly **rewrites `wake = target`**, so the alarm fires at the exact selected time. The dropdown default makes Smart Adjustment a no-op unless the user manually picks ±5/±10/etc. This matches the reported symptom exactly: "Exact works, Smart does not."

**Root cause B (model):**
The `smart_alarm` intent prompt allows the model to return `wakeAt === targetWakeIso` (no movement). When it does, the UI shows no delta and the user reads it as "didn't work" even when Smart was correctly selected.

**Root cause C (display vs. fire-time):**
The "AI chose" card shows the adjusted time, but there is no debug surface showing the exact ISO that was saved to the event and to the foreground timer. So when the alarm fires at the target time, there's no way for the user to verify *which* time was actually scheduled.

### Files involved
- `src/components/SmartAlarmCard.tsx` (picker UX, analyzeOnly branch, label)
- `src/lib/ai-client.ts` (`aiSmartAlarm` signature)
- `src/routes/api/ai.ts` (smart_alarm prompt — must guarantee non-zero delta when window > 0)
- `src/lib/alarm/foreground.ts` (already correct; uses `firesAt` we pass in)

### Fix
1. When user picks **Smart Adjustment**, auto-set `maxAdjustmentMin = 5` (instead of 0). Remove the confusing "Exact Time (analyze only)" option from the dropdown — it belongs to the Exact button.
2. After scheduling, render a small "Will ring at HH:MM (moved Xm from target)" confirmation line driven from `saved.startsAt`, not from `res.wakeAt`, so the user sees the literal scheduled fire time.
3. Strengthen the `SMART_ALARM_SYSTEM` prompt to require a non-zero adjustment when `windowMin > 0`, choosing the nearest light-sleep boundary within `±windowMin`.
4. Validate server-side: if model returns a delta of 0 with `windowMin > 0`, fall back to a deterministic 90-min-cycle calculation (round to nearest cycle boundary, clamp to window).

## 2. Mobile Alignment / Centering

I inspected the shell:

- `src/routes/__root.tsx` app surface: `flex min-h-screen w-full overflow-x-clip` with `AppSidebar` + main column + `BottomNav` + `CompanionDock`.
- `AppSidebar` renders on desktop only, but on mobile it still occupies a flex slot if it returns an element with width. Need to confirm it returns `null` below `lg`.
- `CompanionDock` is `position: fixed` top-right at 56×56 with safe-area offset — it overlays content but does not shift layout.
- `BottomNav` is fixed; main column has `pb-24` to compensate.
- Page-level cards (dashboard, brief, RightNow, SmartAlarm) use their own padding. None of them define a centered max-width wrapper — they inherit the column width.

**Root cause:** The app main column has no horizontal padding or `mx-auto` max-width on mobile. Combined with `AppSidebar` potentially rendering a non-zero slot on mobile and a few decorative `absolute` blobs without `overflow-clip` on their parents, content visually shifts right and a couple of cards clip past the safe-area inset.

### Fix
1. Add a global mobile page wrapper utility (`.page-container`) with `mx-auto w-full max-w-[480px] px-4 sm:px-6 pt-[env(safe-area-inset-top)]` and apply it to top-level `<main>` of each app route (dashboard, events, plan, profile, companion, smart alarm screens).
2. Verify `AppSidebar` returns `null` (or `hidden lg:flex`) on mobile; if not, wrap its root in `hidden lg:flex`.
3. Add `overflow-x-clip` to the main column's direct child as well (defense-in-depth against decorative blobs).
4. Audit decorative overlays in `ArrivalHero`, `RightNowCard`, dashboard hero gradient — ensure each absolute element's parent has `relative overflow-hidden`.

## 3. Alarm Volume Control

Add a new "Alarm sound" section under the picker in `SmartAlarmCard`:
- Volume slider 0–100 (Radix `Slider`), default 85.
- "Test sound" button that plays the currently selected sound at the selected volume.
- Persist to `localStorage` key `restpilot:alarm:audio` alongside sound + fade-in + snooze.
- Pipe volume into `src/lib/alarm/foreground.ts` `startChime` (replace fixed `0.9` master gain).

## 4. Alarm Sound Selection

Eight curated sounds. To stay zero-dependency and reliable on iOS:
- **Gentle Sunrise, Classic Bell, Soft Chimes, Digital Alarm, Piano Wake, Emergency Alarm** — synthesized via WebAudio (oscillator presets in a new `src/lib/alarm/sounds.ts`).
- **Birds & Nature, Ocean Waves** — short looping MP3s added later via lovable-assets; fall back to closest synth preset until uploaded.

UI: vertical radio list with emoji + label, "Preview" play/stop button per row, selected checkmark, auto-save to `localStorage`. Same sound used by `testAlarm()` and real fire path.

## 5. Advanced Alarm Settings (collapsed accordion)

- **Fade-in**: Off / 15s / 30s / 60s — apply linear gain ramp in `startChime`.
- **Vibrate**: toggle, gated on `"vibrate" in navigator`. Fire `navigator.vibrate([400, 200, 400])` pattern at chime start.
- **Snooze length**: 5 / 9 / 10 / 15 min. Surface a "Snooze" button on the ringing toast that calls `addAlarm({ firesAt: Date.now() + snoozeMin*60_000 })`.

Voice Greeting: skipping — keeping AI Companion integration out of scope as requested.

## Files to Touch

```
src/components/SmartAlarmCard.tsx           edit (picker UX, sound/volume/advanced UI, scheduled-time receipt)
src/lib/alarm/foreground.ts                 edit (accept sound/volume/fade/vibrate)
src/lib/alarm/sounds.ts                     new  (synth catalog + preview)
src/lib/alarm/prefs.ts                      new  (localStorage schema + load/save)
src/routes/api/ai.ts                        edit (strengthen SMART_ALARM_SYSTEM, server-side delta fallback)
src/routes/__root.tsx                       edit (app main column wrapper)
src/styles.css                              edit (.page-container utility)
src/routes/dashboard.tsx                    edit (wrap main in .page-container)
src/routes/events.tsx                       edit (same)
src/routes/plan.tsx                         edit (same)
src/routes/profile.tsx                      edit (same)
src/routes/companion.tsx                    edit (same)
src/components/site/AppSidebar.tsx          verify (hidden lg:flex)
```

## Testing
- Smart Adjustment ±5: verify `saved.startsAt` differs from target by ≤5 min and the foreground timer fires at the adjusted time (use Test Alarm 10s with mocked windowMin).
- Each sound preview plays and stops cleanly.
- Volume slider audibly changes preview and test alarm.
- Refresh → selected sound, volume, fade, vibrate, snooze all rehydrate.
- 375×667 / 390×844 / 430×932 viewports: no horizontal scroll, all cards centered, no clipped edges.

## Out of Scope
- Voice greeting on alarm fire (AI Companion integration).
- Native iOS critical-alarm entitlement (requires App Store wrapper).

---

**Awaiting approval before implementation.**
