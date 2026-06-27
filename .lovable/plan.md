## Direction

Transform RestPilot from a metrics dashboard into an active AI assistant. Five priorities, sequenced. No architecture changes — reuse `/api/ai` orchestrator, `ai_memory`, `user_events`, wearable + sleep-engine data already in place.

---

### Priority 1 — AI Coach as the Dashboard Hero

Add a top-of-dashboard **"Right Now" card** that replaces the passive greeting block as the primary focal point.

- New component `src/components/RightNowCard.tsx`
- Calls `/api/ai` with intent `right_now` (new intent in orchestrator)
- Structured output: `{ action, why, ignore_cost, urgency: 'now'|'soon'|'later', cta: { label, route } }`
- Renders: bold one-line action → "Why" → "If you skip this" → primary CTA button
- Auto-refreshes when shift, wearable reading, or time-of-day band changes
- Skeleton shimmer while streaming; graceful fallback to static rule-based tip from `src/lib/insights.ts` if AI fails

### Priority 2 — Companion Mode Foundation

Make AI proactively notice patterns. Pure additive layer on top of existing memory.

- New server fn `src/lib/companion.functions.ts` → `detectPatterns()` runs nightly-style diff: avg sleep last 7d vs prior 7d, shift-load delta, missed wind-downs, HRV trend
- Writes findings into `ai_memory` with `kind='observation'` (already supported)
- New `src/components/CompanionWhisper.tsx`: small dismissible card below RightNow that surfaces 1 observation at a time with optional "Adjust my plan" action → triggers `/api/ai` intent `adjust_plan`
- Trigger detection on dashboard mount (debounced, cached 6h in `user_prefs`)

### Priority 3 — Long Clock (Signature Visualization)

Single horizontal 24h ribbon showing the user's whole day in one glance.

- New component `src/components/LongClock.tsx` (replaces the dashboard "Weekly Rhythm" slot as primary; weekly moves below)
- SVG ribbon, 24h scale anchored to user's current shift wake window
- Layered bands: Sleep (indigo), Work (amber), Commute (slate), Bright Light (gold), Caffeine cutoff (red marker), Wind-down (violet), Alarm (pin), Recovery (mint)
- Hover/tap a band → tooltip with reason + time
- "Now" indicator line that pulses
- Pulls from: `shifts`, `sleep-engine` sun times, `insights.ts` caffeine/light windows, wearable last reading

### Priority 4 — Smart Alarm with Reasoning

Every alarm/event card explains itself.

- Extend `src/components/SmartAlarmCard.tsx` (or events render) to always show `reason` field
- Update `/api/ai` `smart_alarm` intent to require `{ time, reason, cycle_position, confidence }` in structured output
- Render: big time + "Moved 18 min later — wakes you near REM cycle end" + confidence chip
- Add "Why this time?" expandable for detailed cycle math

### Priority 5 — Dashboard Layout Evolution

Reorder dashboard for action-first hierarchy:

```text
1. Greeting (compact, single line)
2. RightNowCard          ← hero
3. CompanionWhisper      ← when observation exists
4. LongClock             ← signature visual
5. Quick Links (3-up, unchanged)
6. Smart Alarm + Today's Events
7. Weekly Rhythm         ← demoted, collapsed by default on mobile
```

Polish pass: tighten spacing, ensure RightNow CTA is thumb-reachable on mobile, add subtle aurora glow behind RightNowCard to signal it's the AI speaking.

---

### Technical Notes

- All AI calls route through existing `/api/ai` orchestrator — add new intents `right_now`, `adjust_plan`, expand `smart_alarm` schema
- New observations stored in existing `ai_memory` table (no schema change)
- Use `google/gemini-3-flash-preview` for low-latency intents, structured `Output.object` schemas
- Cache RightNow responses 15 min in `sessionStorage` keyed by hour + last shift id to control cost
- All new components SSR-safe with skeleton states
- No new tables, no new routes — pure component + orchestrator work

### Execution Order

I'll ship in this order, verifying each before the next:
1. Orchestrator intents + RightNowCard (Priority 1)
2. LongClock (Priority 3 — high visual impact)
3. Smart Alarm reasoning (Priority 4)
4. Companion patterns + Whisper (Priority 2)
5. Layout reorder + polish pass (Priority 5)
