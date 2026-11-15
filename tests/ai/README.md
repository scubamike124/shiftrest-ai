# RestPilot AI evals (Promptfoo)

Quality, safety, consistency and security checks for the AI companion
("Lisa" / Pilot). The provider runs the app's own `/api/ai` coach path
(`buildSystemPrompt`, personal signals, memories, time directive, `chatStream`)
against per-scenario fixtures instead of the database, with a frozen clock.

```bash
node tests/ai/run-evals.mjs --smoke                  # ~10 scenarios, 120k-token cap
node tests/ai/run-evals.mjs                          # everything, 1.5M-token cap
node tests/ai/run-evals.mjs --compare                # current vs AI_CANDIDATE_MODEL
node tests/ai/run-evals.mjs --repeat 3 --no-cache    # consistency across repeats
node tests/ai/run-evals.mjs --dry-run                # assemble prompts only, no calls
node --test tests/ai-eval-harness.test.mjs           # offline harness self-test
```

Always go through `run-evals.mjs`. It sets the hard token cap
(`--max-tokens N` or `RESTPILOT_EVAL_MAX_TOKENS`); the providers refuse to make a
paid call without one, and refuse any call that would cross it (grading included).
Results land in `tests/ai/.results/` (`summary.md`, `summary.json`, `report.html`).

## Configuration

| Variable                                     | Where                 | Purpose                                                 |
| -------------------------------------------- | --------------------- | ------------------------------------------------------- |
| `AI_API_KEY`                                 | repository **secret** | Key for the OpenAI-compatible endpoint the app uses     |
| `AI_BASE_URL`                                | repository variable   | Same endpoint as production (`https://...`)             |
| `AI_CHAT_MODEL`                              | repository variable   | The app's current model (also part of the cache key)    |
| `AI_CANDIDATE_MODEL`                         | repository variable   | Model to benchmark against `current` (`--compare`)      |
| `AI_GRADER_MODEL`                            | repository variable   | Optional llm-rubric grader; defaults to `AI_CHAT_MODEL` |
| `RESTPILOT_EVAL_PRICE_IN_PER_MTOK` / `_OUT_` | optional              | USD per million tokens, for cost reporting              |

No key means **blocked**, not passed: the run answers what it can from the
response cache and reports every miss as `BLOCKED: needs AI_API_KEY`.

## Writing scenarios

One YAML file per area in `scenarios/` (all `*.yaml` there are loaded). Each test:

```yaml
- description: "rotation/nurse: second night in a row, sleep window" # area/persona: what
  metadata:
    category:
      rotating-shifts # caffeine | sleep-planning | recovery | rotating-shifts |
      # overtime-safety | memory | grounding | medical-safety |
      # security | voice | consistency
    persona: nurse # nurse | paramedic | firefighter | ...
    smoke: false # true only for the ~10 PR smoke cases
    reference: "Citation for the expected behaviour (required for safety-sensitive cases)"
    reviewed_by: "name/role of the expert who approved the reference answer (if any)"
  vars:
    message: "the user's turn"
    now: "2026-11-16T20:00:00Z" # optional frozen clock (default: Mon 2 p.m. Chicago)
    timezone: America/Chicago # optional; default from profile/current_tz
    surface: text # text (Coach chat) | voice (Pilot, 180-token cap)
    profile: { assistant_name: Lisa, memory_enabled: true, sleep_hours: 7 } # user_prefs
    history: # earlier turns in this conversation
      - { role: user, content: "..." }
      - { role: assistant, content: "..." }
    fixtures: # database rows; times relative to `now`
      shifts: [{ start_utc: "@now+5h", end_utc: "@now+17h", title: "Night shift" }]
      wearable_readings: [{ date: "@date-1d", sleep_duration_min: 300, hrv_ms: 38 }]
      ai_memory:
        [
          {
            id: m1,
            content: "...",
            category: schedule,
            pinned: true,
            importance: 5,
            confidence: 0.9,
            use_count: 0,
            updated_at: "@now-3d",
            last_referenced_at: null,
            expires_at: null,
          },
        ]
  assert: [...]
```

Assertion order of preference:

1. **Deterministic** (`assertions/restpilot.mjs`): `timeWithin` / `noTimeWithin`
   (schedule math, `config: {earliest: "HH:MM", latest: "HH:MM"}`, wraps midnight),
   `noInventedWearableData`, `noMedicalClaims`, `refersToProfessional`,
   `voiceShape`, `wordLimit`, `noPiiOrSecrets`, `noSystemPromptLeak`; plus
   Promptfoo built-ins (`icontains-any`, `not-icontains-any`, `regex`, `latency`).
2. **Reference answers** for safety-sensitive cases: put the expert-reviewed
   expectation in the rubric text and the source in `metadata.reference`.
3. **`llm-rubric`** for relevance and tone. Graded by the capped grader provider.

Every test already inherits `noMedicalClaims`, `noInventedWearableData`,
`noPiiOrSecrets` and `noSystemPromptLeak` from `defaultTest`. Give each assertion
a `metric:` (`correctness`, `relevance`, `safety`, `grounding`, `memory`,
`security`, `voice`) so the report can score by criterion.
