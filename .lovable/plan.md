# Step 3 — Predictive AI + Continuous Learning

Builds on the AI orchestrator (`/api/ai`), memory ranker, and existing telemetry tables (`shifts`, `wearable_readings`, `user_events`, `ai_log`, `ai_memory`). All new intelligence runs through the same gateway — no parallel pipelines, one coach voice.

## 1. Data foundation (migration)

Three new tables, all RLS-scoped to `auth.uid()` with `service_role` full access:

- **`ai_recommendations`** — every coachable suggestion the AI surfaces.
  Fields: `id`, `user_id`, `intent` (right_now / daily_plan / smart_alarm / commute / coach_tip / tomorrow), `headline`, `rationale`, `evidence_json` (memory ids + signals used), `confidence` (0–1), `predicted_impact_json` (e.g. {fatigue_delta, sleep_min}), `valid_from`, `valid_until`, `superseded_by`, `created_at`.
- **`ai_feedback`** — user reactions used for learning.
  Fields: `id`, `user_id`, `recommendation_id` (fk), `reaction` enum: `helpful`, `not_helpful`, `already_did`, `ignored_today`, `dismissed_forever`, `note` (text, optional), `outcome_json` (auto-filled later: next-day sleep_min, hrv_delta, readiness_delta), `created_at`.
- **`ai_patterns`** — durable, named patterns the predictor detects.
  Fields: `id`, `user_id`, `pattern_key` (e.g. `sleep_debt_3d`, `caffeine_late`, `rotation_change`, `hrv_decline`, `missed_recovery`), `severity` 1–5, `signals_json`, `first_seen_at`, `last_seen_at`, `occurrences`, `active` bool, `muted_until`.

Add `pattern_id` (nullable fk) and `feedback_score` (computed via job) to `ai_recommendations`. Indexes on `(user_id, created_at desc)` and `(user_id, active)` on patterns.

## 2. Pattern Detection Engine (server)

New `src/lib/ai/patterns.server.ts` — pure TS detectors that run on demand and on a nightly cron. Each detector takes the last 14–28 days of `shifts`, `wearable_readings`, `user_events`, `ai_feedback` and returns zero or more `{pattern_key, severity, signals}`.

Detectors shipped:
- Sleep debt accumulation (rolling 7-day deficit vs target)
- Shift rotation change (direction flip in last 3 shifts)
- Frequent overtime (>X hrs/week)
- Timezone/travel jump (lat-lon or tz delta from `user_events`)
- Missed recovery windows (planned wind-down not followed by sleep block)
- Repeated late caffeine (cutoff breached N days in a row)
- Missed alarms (smart_alarm followed by no wake event within window)
- Commute fatigue (post-shift drive after >12h awake)
- HRV / readiness decline trend (linear slope negative over 7d)
- Long-term sleep consistency (stdev of mid-sleep > threshold)

Results upserted to `ai_patterns` (dedupe by `pattern_key`, bump `occurrences` + `last_seen_at`). Detectors are pure; unit-testable.

## 3. Predictive intents in `/api/ai`

Extend the orchestrator (no new endpoints):

- New JSON intent `tomorrow_preview` — composes Sleep timing, alarm, light, caffeine cutoff, commute, wind-down, recovery priorities. Schema mirrors `daily_plan` for UI reuse.
- New JSON intent `daily_review` — recap: went well / reduced fatigue / increased fatigue / sleep recovered / readiness Δ / recovery trend / small improvement tomorrow. Encouraging tone enforced in system prompt.
- New JSON intent `pattern_alert` — given a pattern row, returns headline + rationale + 1 actionable step + confidence.
- Extend context builder (`context.server.ts`) to include: top 5 active patterns, last 7 days feedback summary (helpful/ignored counts per intent), and the previous recommendation for the same intent (so the model avoids repetition).

Every JSON intent response is persisted to `ai_recommendations` before returning, so a stable `recommendation_id` is sent to the client for feedback wiring.

## 4. Feedback loop

- New server fn `submitFeedback({recommendation_id, reaction, note?})` — writes `ai_feedback`, and on `dismissed_forever` sets `muted_until = now()+30d` on the linked pattern.
- Nightly job (`/api/public/hooks/ai-learn` via `pg_cron`) joins feedback with next-day wearable deltas to fill `outcome_json`, then recomputes `feedback_score` per `(user_id, intent, pattern_key)` and stores as a ranked `ai_memory` row of category `learned_preference` (e.g. "caffeine cutoff reminders helpful 4/5"). The ranker (Step 2) already boosts these.
- The context builder injects the top learned preferences so the model dampens ignored advice and reinforces helpful threads.

## 5. Nightly automation

Two cron jobs (`pg_cron` → `/api/public/hooks/*`, anon-key auth):
- `02:30 user-local` (approx via stored tz): run pattern detection, generate `tomorrow_preview` and `daily_review`, store as `ai_recommendations` ready for arrival.
- `04:00 UTC`: outcome backfill + learning aggregation described above.

Both endpoints iterate `user_prefs.memory_enabled = true` users only and respect `predictive_enabled` (new pref, default true).

## 6. UI surfaces (mobile-first)

- **Dashboard arrival** (`ArrivalHero` + new `TomorrowPreviewCard`): shows the AI's pre-built tomorrow plan as collapsible bento card. CTA: "Make it official" / "Adjust".
- **Daily Review card** appears after first wake event of the day (uses cached `daily_review`).
- **Pattern Alerts**: `CompanionWhisper` upgraded to render active `ai_patterns` with severity dot, "Why am I seeing this?" expandable evidence list (drawn from `evidence_json`).
- **Feedback chips** on every recommendation card: 👍 Helpful · 👎 Not helpful · ✅ Already did it · 🌙 Ignore today · ⛔ Don't show again. Single tap → optimistic update → `submitFeedback`.
- **Trust receipt** (reuse Step 2 component): each card links to the memories/patterns/signals that produced it.
- **Settings → Assistant**: new toggles — Predictive insights, Daily review, Tomorrow preview, Learn from my feedback. Each independently togglable; off = no writes to corresponding table.

## 7. Voice & privacy guardrails

- Extend `COACH_VOICE` with two clauses: never judgmental in reviews; always cite at least one evidence item when severity ≥ 3.
- Migration adds `predictive_enabled`, `daily_review_enabled`, `tomorrow_preview_enabled`, `feedback_learning_enabled` to `user_prefs` (all default true; flip to false instantly stops the cron from touching that user).
- Memory page (Step 2) gets a new "Patterns" tab — view, mute, or delete detected patterns. Export bundle includes patterns, recommendations, feedback.
- All AI outputs continue to flow through `ai_log` for transparency.

## 8. Rollout order

1. Migration (tables + prefs + grants + RLS).
2. Pattern detectors + unit-ish smoke check via `tsgo`.
3. Orchestrator intents (`tomorrow_preview`, `daily_review`, `pattern_alert`) + context builder updates.
4. Server fns: `submitFeedback`, `listPatterns`, `getTomorrowPreview`, `getDailyReview`.
5. UI: feedback chips → TomorrowPreviewCard → DailyReviewCard → CompanionWhisper upgrade → Memory "Patterns" tab → Assistant settings toggles.
6. Cron endpoints + `pg_cron` schedule (separate insert, not migration).
7. Typecheck + manual smoke on dashboard.

## Technical notes

- No breaking schema changes; existing intents untouched.
- All new server logic in `*.server.ts` / `*.functions.ts` per import-graph rules.
- `supabaseAdmin` only inside cron handlers (loaded with `await import`).
- Confidence + evidence are persisted with every recommendation so the UI can always explain "why".
- Feedback never silently retrains — it adjusts ranked memory rows the user can view and delete on the Memory page.

Approve and I will start with the migration.
