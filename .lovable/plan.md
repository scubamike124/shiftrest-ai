
# Slice 7 — Smart Day & Evening Intelligence

Extends the Companion's existing Morning Brief into an all-day assistant with three time-based briefs: **Morning** (04–11), **Afternoon** (11–17), **Evening** (17–04). The Companion auto-selects which brief to show based on local hour. Same hide-on-empty, parallel-fetch, card-based architecture as Slice 6 — we are generalizing, not duplicating.

---

## 1. Briefing windows & selection

| Period   | Local hours | Default brief             |
|----------|-------------|---------------------------|
| Morning  | 04:00–10:59 | Morning Brief (Slice 6)   |
| Afternoon| 11:00–16:59 | Afternoon Check-In        |
| Evening  | 17:00–03:59 | Evening Brief             |

`/companion` auto-mounts the brief for the current window. `?brief=morning|afternoon|evening` overrides. The "show today's brief" reveal button still works outside the window.

---

## 2. Cards (each card stays self-contained, hide-on-empty)

**Afternoon Check-In**
- `remainingEvents` — events later today from `user_events`
- `nextTraffic` — Wave-A: baseline minutes from `commute_minutes_baseline` toward next event (live traffic = Wave B)
- `weatherShift` — current vs forecast delta from Open-Meteo
- `hydration` — static reminder, dismissable per-day
- `movement` — static stretch nudge (skipped if dismissed)
- `battery` — only if `navigator.getBattery()` available AND charge < 30%
- `workingLate` — AI nudge when current time > usual workday end (from memory) and a calendar event still pending

**Evening Brief**
- `tomorrowFirst` — first event tomorrow from `user_events`
- `smartAlarmSuggestion` — recommended wake time (existing `sleep-engine`)
- `tomorrowWeather` — Open-Meteo daily for tomorrow
- `clothing` — derived from `tomorrowWeather` (rules table, no LLM)
- `travel` — only when tomorrow has a trip in `trips`
- `prepChecklist` — derived from event titles (e.g. "Bring laptop" for meetings)
- `bedtimeSuggestion` — `tomorrow first event − sleep_hours − wind-down`
- `eveningSummary` — single AI sentence (budget-gated, cached 4h)
- `windDown` — CTA to start `/sleep` mixer or breathing

All cards hide when their data is missing.

---

## 3. Architecture

Generalize Slice 6, do not fork it.

```text
src/lib/companion/
  brief-window.ts                 pure: hour → 'morning'|'afternoon'|'evening'
  types.ts                        AfternoonBriefDTO, EveningBriefDTO + shared BriefCardId union
  afternoon-brief.functions.ts    createServerFn, Promise.allSettled fan-out
  evening-brief.functions.ts      createServerFn, Promise.allSettled fan-out
  shared.server.ts                eventsForRange(), memorySnippets(), weatherFor()

src/components/companion/
  DailyBrief.tsx                  orchestrator — picks morning/afternoon/evening
  cards/afternoon/                RemainingEventsCard, NextTrafficCard, WeatherShiftCard,
                                  HydrationCard, MovementCard, BatteryCard, WorkingLateCard
  cards/evening/                  TomorrowFirstCard, SmartAlarmSuggestionCard, TomorrowWeatherCard,
                                  ClothingCard, TravelCard, PrepChecklistCard, BedtimeCard,
                                  EveningSummaryCard, WindDownCard
```

`src/components/morning/MorningBrief.tsx` stays — `DailyBrief` mounts it for the morning window. Slice 6 UI is untouched.

`src/routes/companion.tsx`: swap the `<MorningBrief />` mount for `<DailyBrief />`.

`src/components/CompanionAvatar.tsx`: pulse triggers when *any* brief is unread for today (per-period `brief:lastSeenISO:<period>` key). Reading any brief clears its own pulse.

---

## 4. Data sources (Wave A only, same as Slice 6)

| Card                    | Source                                     | New infra? |
|-------------------------|--------------------------------------------|------------|
| Events / Tomorrow       | `user_events` (existing)                   | no         |
| Weather / TomorrowWx    | `src/lib/weather.server.ts` (+ daily fn)   | small ext  |
| Smart Alarm             | `src/lib/sleep-engine.ts`                  | no         |
| Trips                   | `trips` table                              | no         |
| Hydration/Movement      | static, dismissed in `localStorage`        | no         |
| Battery                 | `navigator.getBattery()` (browser)         | no         |
| Memory                  | `ai_memory` (existing query)               | no         |
| AI summary/tip          | `/api/ai` `coach_tip` intent + `has_ai_budget` | no     |

`src/lib/weather.server.ts` gains `fetchTomorrowWeather(lat, lon)` returning `{ high, low, condition, icon, precipChance, sunriseISO }`. Caller-side cache 1h.

---

## 5. Companion proactive prompts

Inside `DailyBrief`, after first paint, the orchestrator dispatches a single `companion:proactive` event with one of:
- evening + early meeting tomorrow → "I noticed you have an early meeting tomorrow. Want me to prep?"
- evening + `wind_down_enabled` → "Would you like me to help you wind down tonight?"
- evening + relaxation pref → "Want me to start a relaxation session?"

`src/routes/companion.tsx` listens once per session and renders the suggestion chip above the composer. **One** prompt per visit. No autoplay, no notification.

RestPilot relaxation routing reuses `companion-sound-bridge.ts` — no new bridge.

---

## 6. Settings — `/settings/morning` → `/settings/companion`

Rename route file to `src/routes/settings.companion.tsx` (keep `settings.morning.tsx` as a 1-line redirect for back-compat). Adds:
- Toggle Morning / Afternoon / Evening brief on/off (`brief_enabled` jsonb)
- Per-period card order + hide list (extend `brief_layout` jsonb to `{ morning:{order,hidden}, afternoon:{...}, evening:{...} }`)
- Quiet hours start/end (`quiet_start`, `quiet_end` — already exist in `notification_prefs`, surfaced here)
- Link to Notifications settings (no duplication)

Migration is **additive only** — old `brief_layout` shape stays valid via a back-compat reader that promotes flat layouts to the morning slot on read.

---

## 7. DB migration

```sql
ALTER TABLE public.user_prefs
  ADD COLUMN IF NOT EXISTS brief_enabled jsonb
    DEFAULT '{"morning":true,"afternoon":true,"evening":true}'::jsonb;
-- brief_layout keeps existing column; reader handles both old flat and new nested shapes.
```

No new tables. No new GRANTs needed (column add only).

---

## 8. Performance

- Each brief = one round trip, `Promise.allSettled`, per-source 1500 ms timeout.
- `react-query` `staleTime: 5min`, `gcTime: 30min`, key includes period + date.
- AI summary lazy-loaded (`React.lazy`) and gated by `has_ai_budget` + 4h cache.
- Battery/hydration/movement cards render with zero network.
- Dashboard avatar unaffected — still one cheap `localStorage` read.
- Payload target < 5 KB per brief.

---

## 9. Privacy

- No new PII fields.
- AI summary prompt only sees structured brief fields + top-3 ranked memories when `memory_enabled`.
- `ai_log` records intent + token count, never card contents.
- Hydration/movement dismissals stay in `localStorage`, never synced.

---

## 10. Testing

- Vitest: `brief-window.ts` boundary hours (03:59, 04:00, 10:59, 11:00, 16:59, 17:00, 23:59).
- Vitest: each brief server fn — one failing source hides only that card.
- Vitest: settings layout reader handles both old flat and new nested `brief_layout`.
- Playwright (mobile + desktop):
  - Force clock to 14:00 → Afternoon Check-In renders.
  - Force clock to 20:00 → Evening Brief renders, AI summary streams.
  - Toggle Evening brief off → not rendered after reload.
  - Avatar pulses once per period per day.
- `bunx tsgo --noEmit` clean. No Slice 3–6 regressions.

---

## 11. Affected files (summary)

**New**
- `src/lib/companion/brief-window.ts`
- `src/lib/companion/types.ts`
- `src/lib/companion/afternoon-brief.functions.ts`
- `src/lib/companion/evening-brief.functions.ts`
- `src/lib/companion/shared.server.ts`
- `src/components/companion/DailyBrief.tsx`
- `src/components/companion/cards/afternoon/*` (7 files)
- `src/components/companion/cards/evening/*` (9 files)
- `src/routes/settings.companion.tsx`

**Edited**
- `src/lib/weather.server.ts` (+ `fetchTomorrowWeather`)
- `src/lib/prefs.ts` (+ `briefEnabled`, layout reader)
- `src/routes/companion.tsx` (mount `<DailyBrief />`, proactive listener)
- `src/components/CompanionAvatar.tsx` (per-period pulse)
- `src/components/morning/MorningBrief.tsx` (export period key constant; logic unchanged)
- `src/routes/settings.morning.tsx` (1-line redirect to `/settings/companion`)
- One DB migration

**Untouched**: every other route, Slice 6 cards themselves, notification runner, sound bridge, intent router.

---

## 12. Out of scope

- Live traffic (still Wave B).
- Per-user Google Calendar OAuth (Wave B).
- Push notification version of Afternoon/Evening briefs — Slice 8 candidate.
- Voice readout of briefs — Slice 8 candidate.

Awaiting approval before touching code.
