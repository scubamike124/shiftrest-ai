# A4 — Pilot Intelligence Investigation

## 1. Current architecture (what Pilot already sees)

Every Pilot/Companion turn goes through `src/routes/api/ai.ts` → `buildSystemPrompt()` in `src/lib/ai/context.server.ts`, which composes:

- **Persona** — `BASE_PERSONALITY` + one of 9 mode overlays (`prompts.server.ts`).
- **Long-term memory** — top-N ranked rows from `ai_memory` via `memory-rank.server.ts` (semantic + recency).
- **Active patterns** — `ai_patterns` rows via `patterns.server.ts`: sleep_debt_3d, rotation_change, frequent_overtime, tz_jump, missed_recovery, caffeine_late, missed_alarms, commute_fatigue, hrv_decline, sleep_inconsistency.
- **Feedback summary** — helpful / not_helpful / ignored per intent, last 14 d (`recommendations.server.ts`).
- **Previous recommendation** for this intent (dedupe).
- **TZ state** — home/current tz, body-clock offset, DST, active trip.
- **Personal signals** (A3) — local clock, sleep goal + wind-down, last night's duration/efficiency/deficit, 7-night debt, HRV vs baseline, next shift + hours until it starts.
- **liveContext** — free-form string from the client.

Voice surface (`PILOT_VOICE_SYSTEM`) strips markdown formatting and trims to 5 memories + hot patterns only.

## 2. Missing intelligence

Data that already exists in the DB but Pilot never sees:

**Sleep / recovery**
- Bedtime & wake-time trends (times, not just duration), consistency stdev.
- Sleep score & recovery score fields on `wearable_readings` — currently only duration/efficiency/HRV are read.
- Resting-HR trend vs baseline.
- Sleep-goal streak (# of nights ≥ goal in last 14).

**Schedule**
- *Today's* shift (only "next future shift" is read — if you're mid-shift Pilot doesn't know).
- Tomorrow-vs-today shift-type comparison → "3 early shifts in a row", rotation detection at the conversational level.
- Consecutive work-day count / next day off / block length.
- Time until next alarm (`user_events` where kind=`smart-alarm`).
- Wind-down window (goal_bedtime − wind_down_min) computed against local clock.

**Behavior**
- Snooze / missed-alarm counts (already in `patterns` but not surfaced as signals).
- Late-night device pings from `user_events` (`kind` filters).
- Which recommendation categories the user marks `not_helpful` most often (per-topic, not per-intent).
- Advice that *worked* — recommendations with `helpful=true` followed by improved sleep.

**Conversation memory**
- `coach_messages` is stored but Pilot never re-reads it. No "yesterday you mentioned…" capability.
- No "topic recency" surface — the model can't tell if it already covered caffeine 2 turns ago.

**Proactive triggers**
- No opener generator. Pilot always waits for the user to speak first, so it never says "your HRV is down today".
- No cooldown table for proactive nudges → risk of nagging.

**Reasoning**
- Signals are listed but the prompt asks the model to "reference the ONE most relevant". There's no explicit instruction to *combine* 2–3 signals into a chain of reasoning.

**Personality variety**
- No response-diversity guard — the model tends to recycle openers ("Here's the play:") across turns because the mode overlay hard-codes them.

## 3. Recommended improvements (grouped by batch)

**A4.1 — Expand PERSONAL SIGNALS** *(low risk, high impact)*
Add to `personal-signals.server.ts`: today's shift (currently in-progress), consecutive work-days, next day-off, bedtime/wake trends (7-night median ± stdev), resting-HR trend, sleep-goal streak, next scheduled alarm.

**A4.2 — Reasoning directive**
Add a `REASONING` paragraph to `BASE_PERSONALITY` and `PILOT_VOICE_SYSTEM`: "Before answering, silently combine 2–3 signals (sleep debt + next shift + HRV) and let that chain drive the recommendation. Say the *why* in one clause, not a list."

**A4.3 — Conversation memory recall**
New helper `fetchRecentTopics(admin, userId, hours=48)` reads `coach_messages` + `ai_memory` proposals, extracts topic tags (caffeine, wind-down, night-shift, hydration, alarm, HRV), and injects a compact "RECENT CONVERSATION TOPICS" block: `caffeine (mentioned yesterday), wind-down (2 days ago)`. Instruction: "You may naturally reference these when relevant. Never invent quotes."

**A4.4 — Proactive openers**
New server fn `generateProactiveOpener(userId)` runs on Pilot mount / Companion open. Uses signals + patterns to compute an opener candidate + priority, respecting a per-user cooldown (`user_events` `kind='proactive_opener'`, ≥ 4 h between fires; max 3/day; suppress within 30 min of user-initiated turn). Categories: HRV drop, sleep debt ≥ 90 min, 3 early shifts starting tomorrow, first day-off after ≥ 5-shift block, missed wind-down. Client shows opener as first message but user can dismiss without penalty.

**A4.5 — Behavior-weighted advice**
Extend `fetchFeedbackSummary` to return per-topic (not per-intent) helpful/not_helpful counts by joining `ai_recommendations.category`. Inject an "ADVICE PREFERENCES" block: `avoid: cold-shower (2× not helpful); works: caffeine cutoff, dim light`. Model steers away from disliked framings.

**A4.6 — Personality variation**
Add `OPENER_VARIETY` guard: pass last 3 turn openers to the prompt with instruction "do not open with any of these phrasings again". Rotates naturally without changing persona.

## 4. Files that would change

| File | Change |
|---|---|
| `src/lib/ai/personal-signals.server.ts` | Add shift-today, consecutive days, bedtime trends, RHR trend, streak, next alarm |
| `src/lib/ai/prompts.server.ts` | Add REASONING + variety directives to base and voice systems |
| `src/lib/ai/context.server.ts` | Wire new blocks (recent topics, advice prefs, opener history) |
| `src/lib/ai/recent-topics.server.ts` | **NEW** — extract topic tags from `coach_messages` |
| `src/lib/ai/proactive.server.ts` | **NEW** — opener generator + cooldown |
| `src/lib/ai/recommendations.server.ts` | Add per-topic feedback aggregation |
| `src/routes/api/ai.ts` | Accept `openerRequest=true` intent branch |
| `src/routes/api/public/hooks/…` *(optional)* | If we want opener push before app opens |
| `src/routes/pilot.tsx` / `src/routes/companion.tsx` | Fetch opener on mount, render as first assistant bubble, log dismiss |
| DB migration | `user_events` `kind='proactive_opener'` row, no new tables |

No schema additions beyond a new `kind` value in existing `user_events`.

## 5. Risks

- **Prompt bloat / cost** — every added block increases tokens. Mitigation: cap each block, gate to `intent==='coach'`, keep voice surface trimmed.
- **Nagging / creepy** — proactive openers can feel intrusive. Mitigation: strict cooldown, quiet hours, dismissible, telemetry on dismiss rate → auto-disable after 3 consecutive dismissals.
- **Hallucinated quotes** — "yesterday you said…" must never invent. Mitigation: recent-topics block ships *tags only*, never verbatim text; prompt forbids quoting.
- **Latency on Pilot open** — opener generator adds a query. Mitigation: run in parallel with mic warm-up; time-box to 400 ms and skip if slow.
- **Behavior data sparsity** — new users have no feedback yet. Mitigation: all blocks emit empty string when < N samples.

## 6. Estimated difficulty

| Batch | Difficulty | Est. LOC |
|---|---|---|
| A4.1 Expanded signals | Low | ~150 |
| A4.2 Reasoning directive | Trivial | ~15 |
| A4.3 Recent topics | Medium | ~120 |
| A4.4 Proactive openers | Medium-High | ~250 + UI |
| A4.5 Behavior-weighted advice | Medium | ~100 |
| A4.6 Opener variety | Low | ~40 |

## 7. Recommended implementation order

1. **A4.1** — expand PERSONAL SIGNALS (biggest quality-per-line jump, zero UX risk).
2. **A4.2** — reasoning + variety directives (trivial; pairs with A4.1).
3. **A4.3** — recent-topics memory recall (unlocks "yesterday you mentioned").
4. **A4.5** — behavior-weighted advice (needs A4.3 topic tags).
5. **A4.6** — opener variety guard.
6. **A4.4** — proactive openers (most user-visible, highest risk — ship last with cooldown telemetry).

Each batch is independently testable and shippable. Await approval on batch A4.1 to begin.
