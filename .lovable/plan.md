# Investigation — RestPilot "One Trusted Companion" Phase

Read-only investigation. No code changes until approved.

## Current Foundation (what we already have)

- `ai_memory` (user-scoped, RLS, categories, pinned, source, confidence) + `AIMemoryManager.tsx` UI.
- `ai_log` request ledger (tokens, intent, latency).
- `/api/ai` orchestrator with persona + mode + memory injection (`src/lib/ai/context.server.ts`).
- Intents: `right_now`, `adjust_plan`, `smart_alarm`, `daily_plan`, `smart_alarm`, `commute`, `coach_tip`, `chat`.
- Trust voice contract (`COACH_VOICE`) returning `confidence`, `confidenceReason`, `followBenefit`, `ifIgnored`.
- After sign-in users currently land back on `/` (marketing) — verified in `src/routes/auth.tsx` (`returnTo` defaults to `/`).

The plumbing is there. This phase is about **wiring it together into one coherent presence**, not net-new features.

---

## 1. Personalized Dashboard Arrival

**Finding.** `auth.tsx` redirects to `returnTo` (default `/`). The signed-in homepage at `/` is the public marketing page. Result: users feel "shown the door" instead of greeted.

**Recommendation.** Introduce a single source of truth for "where signed-in users belong" = `/dashboard`.

- `src/routes/__root.tsx`: when session is present and `pathname === "/"` with no explicit `return`, soft-redirect to `/dashboard` (client-side, no flicker on marketing for logged-out).
- `src/routes/auth.tsx`: default `returnTo` from `/` to `/dashboard`; keep `SAFE_RETURNS` allowlist.
- New server fn `getArrivalBrief()` (`src/lib/ai/arrival.functions.ts`) — runs once per session-day, returns `{ greeting, headline, action, why, confidence }` from existing `right_now` intent + tonight's plan + sleep-debt. Cached in `user_prefs.last_arrival_at` so we don't burn tokens on every refresh.
- New `<ArrivalHero />` component slotted at the top of `/dashboard` — fades in name + adjusted-plan headline + one CTA. Replaces the static greeting already in `dashboard.tsx`.

Why this shape: zero new tables, reuses the orchestrator, one component, predictable cost (1 call/day/user).

---

## 2. AI Memory Evolution — Long-Term Life Memory

**Finding.** `ai_memory` already supports the categories needed (general, schedule, health, preferences, employer, recovery, caffeine, family, goals). Missing pieces are **lifecycle, decay, dedupe, and visibility-by-domain**.

**Recommendation.** Evolve, don't replace.

- Migration adds three columns:
  - `importance smallint default 3` (1–5; pinned ⇒ 5).
  - `last_referenced_at timestamptz` (bumped when memory is injected into a prompt).
  - `expires_at timestamptz null` (for transient facts like "traveling to Denver next week").
- Extend `MemoryCategory` with `travel`, `commute`, `environment`, `timezone`.
- `memory-extractor.server.ts`: add dedupe — embed-less Jaccard match on existing content per category before inserting, update instead of duplicate.
- `context.server.ts`: rank by `pinned DESC, importance DESC, last_referenced_at DESC NULLS LAST` and cap at ~25; bump `last_referenced_at` for the ones we actually injected (single batched UPDATE).
- UI: extend `AIMemoryManager.tsx` with category filter chips + importance slider + expiry hint. Keep one-tap delete and JSON export already shipped.

Privacy: all changes stay under existing RLS (`user_id = auth.uid()`); no shared embeddings, no cross-user signal.

---

## 3. Predictive AI

**Finding.** We compute fatigue/recovery in `src/lib/insights.ts` and surface it via `CompanionWhisper`. It's reactive — recalculated on view, never persisted as an observation.

**Recommendation.** A small **pattern detector** that runs server-side on schedule changes and wearable syncs (not on every page load).

- New `ai_observations` table: `{ id, user_id, kind, summary, evidence jsonb, confidence, status('new'|'shown'|'dismissed'|'acted'), created_at, expires_at }`. RLS scoped to user, GRANTs to authenticated + service_role.
- New server fn `runPatternScan()` triggered from:
  - `shifts` upsert (rotation change) — in `shifts.ts` after write.
  - Wearable sync completion — in `src/lib/wearables/...` post-pull.
  - Daily cron at 04:00 local via `notifications/run.server.ts` extension.
- Detector is pure TS over the last 21 days: night-rotation impact, caffeine-vs-sleep-onset correlation, weekend recovery debt, commute-day fatigue. Each match writes one row; LLM is only used to *phrase* the observation if `user_prefs.ai_predictive_phrasing = true`.
- Dashboard surfaces top 1–2 `status='new'` observations through `CompanionWhisper`; "Adjust my plan" marks `acted`, dismiss marks `dismissed`. Avoids notification spam.

Why pure TS first: deterministic, cheap, testable; LLM is only the voice layer.

---

## 4. Learning From Feedback

**Finding.** Every AI render today is fire-and-forget. We have no signal whether advice landed.

**Recommendation.** One table, two buttons, zero friction.

- New `ai_feedback` table: `{ id, user_id, log_id (fk ai_log), intent, rating smallint (-1|1), reason text null, context jsonb, created_at }`. RLS user-scoped.
- Add 👍/👎 affordance to `RightNowCard`, `CompanionWhisper`, `SmartAlarmCard`, `AIBriefCard`. Optional one-tap reason chips on 👎 ("Wrong time", "Already did this", "Not relevant", "Too aggressive").
- Orchestrator injects a compact "Recent feedback" block into the prompt for the next call (last 10 ratings, summarized as 1 line per intent). No fine-tuning, no embeddings — just in-context priors.
- A 👎 with reason "Too aggressive" automatically nudges `user_prefs.ai_assertiveness` down by one step (1–5 scale, default 3). Reversible from Profile.

Result: the AI visibly adapts within a session without any heavy ML stack.

---

## 5. AI Trust Layer

**Finding.** `confidence`, `confidenceReason`, `followBenefit`, `ifIgnored` exist on three intents. They're not consistently surfaced and don't disclose **missing data**.

**Recommendation.**

- Extend the shared JSON contract in `src/routes/api/ai.ts` with `dataUsed: string[]` and `dataMissing: string[]` (e.g. `["last 3 shifts", "Oura HRV"]`, `["caffeine log"]`). Apply across `right_now`, `adjust_plan`, `smart_alarm`, `daily_plan`, `coach_tip`.
- New `<TrustReceipt />` shared component: collapsible "Why this?" panel rendering confidence chip + dataUsed/dataMissing + a "Connect [missing source]" CTA when the gap is fixable (e.g. missing wearable → link to `/profile#wearables`).
- Replace inline "Why this time?" blocks in `SmartAlarmCard.tsx`, `RightNowCard.tsx`, `CompanionWhisper.tsx` with `<TrustReceipt />` — single visual language across the app.

Honesty about gaps is the cheapest trust-builder we can ship and prevents over-promising on cold-start users.

---

## 6. Companion Experience

**Finding.** Voice is consistent thanks to `COACH_VOICE`, but each surface still feels like a separate widget.

**Recommendation.** Treat the AI as one named presence.

- `user_prefs.assistant_name` (default "Pilot") + `assistant_avatar_seed`. Used everywhere the AI speaks.
- Shared `<CoachBubble>` wrapper (avatar + name + voice mode) used by every AI surface, so the dashboard reads as one assistant talking, not 5 cards.
- Cross-surface continuity: store `last_coach_thread_id` in sessionStorage; `RightNowCard` action, `CompanionWhisper` adjust, and `/coach` chat share the same thread so a chat opened from the dashboard already knows what was just shown.
- Quiet by default: respect `notification_prefs.quiet_hours` for any proactive surfacing; never more than one "new" observation per 6h window.

---

## Cross-Cutting Concerns

### Affected files
- `src/routes/__root.tsx`, `src/routes/auth.tsx`, `src/routes/dashboard.tsx`
- `src/routes/api/ai.ts`
- `src/lib/ai/context.server.ts`, `src/lib/ai/memory-extractor.server.ts`
- New: `src/lib/ai/arrival.functions.ts`, `src/lib/ai/observations.server.ts`, `src/lib/ai/feedback.ts`
- `src/lib/ai-memory.ts`, `src/lib/insights.ts`, `src/lib/shifts.ts`, `src/lib/notifications/run.server.ts`
- Components: `ArrivalHero.tsx`, `TrustReceipt.tsx`, `CoachBubble.tsx`, `FeedbackChips.tsx`; updates to `RightNowCard`, `CompanionWhisper`, `SmartAlarmCard`, `AIBriefCard`, `AIMemoryManager`.

### Database changes (one migration)
- `ALTER TABLE ai_memory ADD COLUMN importance smallint default 3, last_referenced_at timestamptz, expires_at timestamptz;`
- `CREATE TABLE ai_observations (...)` + GRANTs + RLS.
- `CREATE TABLE ai_feedback (...)` + FK to `ai_log` + GRANTs + RLS.
- `ALTER TABLE user_prefs ADD COLUMN assistant_name text default 'Pilot', assistant_avatar_seed text, ai_assertiveness smallint default 3, ai_predictive_phrasing boolean default true, last_arrival_at timestamptz;`

### Privacy
- Everything stays user-scoped via RLS; no cross-user features, no shared embeddings.
- Memory export/delete already exists; extend to also export `ai_observations` and `ai_feedback`.
- Add a single "Reset my AI" action in Profile → wipes memories, observations, feedback in one call.

### Security
- All new tables: RLS on, `auth.uid()` policies, explicit GRANTs to `authenticated` + `service_role`, no `anon`.
- Pattern scan + arrival brief go through `requireSupabaseAuth` server fns — no admin client on user paths.
- Feedback writes validate `log_id` belongs to the caller before insert.

### Performance impact
- Arrival brief: 1 LLM call/user/day, cached.
- Pattern scan: pure TS, runs on write events (cheap) + 1 daily cron pass per active user.
- Memory injection: same size cap (~25), one extra batched UPDATE per chat turn.
- Net token cost expected flat-to-down because feedback priors reduce re-asks.

### Risks
- Auto-redirect to `/dashboard` after sign-in must not trap users who explicitly clicked a marketing link; keep `return` param honored.
- Pattern detector could over-fire on noisy data → ship with conservative thresholds + per-kind cooldown (one observation per `kind` per 72h).
- Feedback-driven assertiveness changes must be reversible and visible in Profile so the AI never "drifts" silently.

### Tech-debt reductions along the way
- Collapse three near-duplicate "Why this?" UIs into `<TrustReceipt />`.
- Centralize AI surface chrome into `<CoachBubble />` (kills repeated avatar/name/voice props).
- Move scattered `sessionStorage` cache keys for `right_now`/coach into one `src/lib/ai/session-cache.ts`.

### Alternative considered (rejected)
- Vector embeddings on `ai_memory` for semantic recall. Rejected for now: current ranking (pinned + importance + recency) is adequate at our memory volume; embeddings add infra cost and a moving privacy surface. Revisit when an average user crosses ~200 memories.

---

## Suggested Build Order (post-approval)

1. Dashboard arrival + auth redirect (small, ships trust fast).
2. Memory evolution migration + ranking update.
3. `<TrustReceipt />` + `dataUsed`/`dataMissing` contract.
4. Feedback table + 👍/👎 + prior injection.
5. Pattern detector + `ai_observations`.
6. `<CoachBubble />` unification + cross-surface thread continuity.

Each step is independently shippable and reversible.