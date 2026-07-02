# A3 — AI Companion Personalization (Investigation Only)

## Root cause

The Companion/Pilot voice coach turn is missing the user's real-time personal signals. It ships to the model with only:

- Persona system prompt (`BASE_PERSONALITY` + mode overlay).
- Long-term memory (top 5 pinned/ranked rows only on voice).
- Active patterns — **only if severity ≥ 3**.
- The client's `context` payload, which on Companion is literally just `{ surface: "companion", companion_name, max_tokens: 180 }` and on Pilot is not sent at all.

Everything the user reasonably expects the AI to already know — tonight's shift, sleep goal, last night's sleep, running sleep debt, wind-down window, local time-of-day — is never put in front of the model on voice turns. So the model has no choice but to answer generically or ask basic setup questions.

Two additional amplifiers:
1. On `surface = "voice" + intent = "coach"`, `buildSystemPrompt` skips the TZ block, feedback block, and previous-recommendation block that the text Coach gets (`context.server.ts` lines 178-224). Voice is the *least* informed surface, even though it's the most personal one.
2. `body.context` is a client-supplied JSON blob dumped verbatim into the prompt as "CURRENT CONTEXT" — it's opaque to the model and easy to spoof; we shouldn't lean on it for personalization.

## Files involved

- `src/lib/ai/context.server.ts` — `buildSystemPrompt` (persona, memory, patterns, TZ, liveContext assembly).
- `src/lib/ai/prompts.server.ts` — `PILOT_VOICE_SYSTEM` (voice persona).
- `src/routes/api/ai.ts` — `intent: "coach"` handler (lines 293-353): where the system prompt is built.
- `src/routes/companion.tsx` (~line 817) and `src/routes/pilot.tsx` (~line 241): coach callers — no schedule/sleep signals attached today.

Data we can already read server-side (no new tables):
- `user_prefs`: `sleep_hours`, `wind_down_min`, `partner_name`, `preferred_name`, `home_tz`, `current_tz`, `commute_minutes_baseline`.
- `shifts`: next upcoming `start_utc` / `end_utc` for the user (+ `title`, `shift_type`).
- `wearable_readings`: last night's `sleep_duration_min`, `sleep_efficiency`, `hrv_ms`, `resting_hr`.
- Same table over the last 7 days → sleep-debt tally (target hours × 7 − actual).

## Proposed change

Add a compact, server-fetched **PERSONAL SIGNALS** block to every coach turn (both voice and text), replacing the client-supplied context blob for personalization purposes. Keep it tight — one short line per signal — so voice replies stay concise.

### 1. New helper `fetchPersonalSignals(admin, userId, now)` in `context.server.ts`

Runs in parallel, `Promise.allSettled` — a missing wearable or empty schedule silently drops that line. Returns a short markdown-ish block of only the lines that resolved. Cap at ~10 lines.

Example rendered output the model will see:

```text
PERSONAL SIGNALS (use these naturally; never read them back as a list):
- Local time: Thu 10:42 pm (America/Chicago); early night for most people.
- Sleep goal: 8 h; wind-down 45 min.
- Last night: 5 h 40 m, efficiency 84% (below your goal by 2 h 20 m).
- 7-day sleep debt: ~6.5 h behind goal.
- HRV last night: 42 ms (baseline 51 ms — recovery down).
- Next shift: Fri 06:00–14:00 "ICU" (starts in 7 h 18 m).
- Wind-down window ideally starts ~10:15 pm to hit that shift on 6 h sleep.
```

Numbers are truncated to what's actually available for that user — no placeholders.

### 2. Inject on both surfaces

In `buildSystemPrompt`, append the signals block **before** `liveContext` for every coach turn (both `surface = "voice"` and `"text"`, `memoryEnabled` or not — these signals are the user's own current data, not learned memory). Continue to skip the heavy patterns/feedback/prev blocks on voice for latency.

### 3. Prompt wording tweak (small)

Add one short paragraph to both `BASE_PERSONALITY` and `PILOT_VOICE_SYSTEM`:

> When PERSONAL SIGNALS are provided, treat them as the ground truth about this user right now. Reference the ONE that most changes your answer — never list them back. If a signal contradicts what the user is asking (e.g. they ask for coffee at 10 pm and their next shift is in 12 h), say so briefly and offer the better move.

### 4. Retire the client `context` blob for personalization

Keep accepting `body.context` (backward compat) but stop pasting it into the prompt as a JSON dump. If we still need `companion_name`, we already load it via `loadAssistantProfile`.

## Before / after

**User:** "Should I nap before my shift?"

**Before (today):**
> Probably yes — but it depends on when your shift starts. What time does it begin?

**After (with signals):**
> Yes — a 25 min nap before 3 pm. You're 2 h 20 m short from last night and your ICU shift starts at 6 tomorrow. Want me to time it?

**User:** "Coffee now, ok?" (asked at 9:40 pm)

**Before:**
> Caffeine takes about 6 hours to clear for most people, so late-evening coffee usually costs you sleep. If you're sleepy, try a short walk instead.

**After:**
> I'd skip it — your shift's at 6 am and you're already 6 hours behind for the week. If you need a lift, a 10 min walk plus water will get you further than coffee tonight.

## Risk assessment

| Risk | Likelihood | Mitigation |
|---|---|---|
| Extra DB round-trips slow the first voice token | Medium | 3 parallel queries, all indexed on `user_id`; cap at 1 read each; `allSettled` so a slow branch can't block. Expected +40-80 ms — well under TTS start-up. |
| Prompt bloat pushes past model limits | Low | Block is capped ~10 short lines (~250 tokens). Voice already runs `maxTokens: 180`, no change. |
| Model reads the list back to the user ("Your sleep debt is 6.5 hours…") | Medium | Prompt line explicitly forbids it; TTS system prompt already rejects lists. Verify in QA. |
| Stale wearable data misleads the model | Low | Only include readings from the last 3 days; label older data ("no wearable data in 48 h") instead of showing it. |
| Signals leak between users | Low | All queries scoped by `userId` in server function; RLS-safe. |
| Persona voice drift after adding new prompt paragraph | Low | Added paragraph is factual, not tonal; existing persona rules still dominate. |

No provider or model change. No new tables. No client changes required for the core win (both callers keep working unchanged); the Companion `context` blob can be trimmed later.

## Plan when approved

1. Add `fetchPersonalSignals` + `formatSignalsBlock` in `context.server.ts`.
2. Wire it into `buildSystemPrompt` (voice + text, coach only).
3. Append the "ground truth" paragraph to `BASE_PERSONALITY` and `PILOT_VOICE_SYSTEM`.
4. Typecheck.
5. Manual QA: 3 voice prompts on Companion, 2 text prompts on Coach, confirm signals surface naturally and are not read as a list.

Awaiting **"go A3"** to implement.
