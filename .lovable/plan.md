# RestPilot AI — Launch Upgrade Sprint Investigation

Bundles 1–3 only. Bundles 4–5 explicitly deferred per your instruction. No code will be written until you approve.

---

## 1. Architecture Recommendation (the big picture)

Build **three shared primitives** that every current and future AI feature composes from. This is the single most important decision in this sprint — it determines whether the next 12 months of features cost 1× or 5×.

```text
                       ┌───────────────────────────────┐
                       │   AI Orchestrator (server)    │
                       │  - assembles user context     │
                       │  - injects persona + memory   │
                       │  - routes to model            │
                       │  - logs + cost-caps           │
                       └──────────────┬────────────────┘
                                      │
        ┌─────────────────────────────┼─────────────────────────────┐
        │                             │                             │
┌───────▼────────┐         ┌──────────▼──────────┐        ┌─────────▼────────┐
│  Memory Store  │         │  Schedule + Notify  │        │  Universal Search│
│  (opt-in)      │         │  Engine (existing)  │        │  Index           │
└────────────────┘         └─────────────────────┘        └──────────────────┘
        ▲                             ▲                             ▲
        └────── used by Coach, Brief, Smart Alarm, Recommendations, Routines, Search
```

**Key principle:** *no feature talks to a model directly.* Every AI call goes through the Orchestrator, which is the only place that knows the user's name preference, persona mode, memory consent, fatigue context, and chosen model. This makes "swap the model," "add a new persona," "add a new feature" all single-file changes.

### Better alternative discovered during investigation

The prior plan had each feature call `/api/coach`, `/api/brief`, `/api/insights` separately, each rebuilding context. **Replace those three endpoints with one streaming endpoint `/api/ai` plus a typed `intent` field** (`chat`, `brief`, `recommendation`, `routine-summary`, `alarm-rationale`). Same model call shape, same context assembly, same logging — five intents for the price of one. This removes ~400 lines of duplicated context code and means Bundle 2's "Smart Alarm rationale" and "Daily Recommendation" are 30-line additions, not new routes.

---

## 2. Database Changes

Three migrations total. All additive — no breaking changes to existing tables.

### Migration A — AI personalization on `user_prefs`
```sql
ALTER TABLE public.user_prefs
  ADD COLUMN assistant_name      text    NOT NULL DEFAULT 'RestPilot',
  ADD COLUMN assistant_mode      text    NOT NULL DEFAULT 'coach'
    CHECK (assistant_mode IN ('coach','companion','minimal')),
  ADD COLUMN memory_enabled      boolean NOT NULL DEFAULT false,
  ADD COLUMN voice_enabled       boolean NOT NULL DEFAULT true,
  ADD COLUMN ai_model_tier       text    NOT NULL DEFAULT 'standard'
    CHECK (ai_model_tier IN ('standard','premium'));
```

### Migration B — `ai_memory`
```sql
CREATE TABLE public.ai_memory (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind        text NOT NULL CHECK (kind IN ('fact','routine','preference','observation')),
  content     text NOT NULL,
  source      text NOT NULL DEFAULT 'inferred', -- inferred | user | system
  confidence  numeric(3,2) DEFAULT 0.70,
  expires_at  timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
-- GRANT + RLS scoped to auth.uid() (standard pattern)
-- INDEX on (user_id, kind, created_at desc)
```

### Migration C — `user_events` (calendar + reminders)
```sql
CREATE TABLE public.user_events (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title        text NOT NULL,
  notes        text,
  starts_at    timestamptz NOT NULL,
  ends_at      timestamptz,
  kind         text NOT NULL DEFAULT 'reminder'
    CHECK (kind IN ('reminder','appointment','commute','custom')),
  recurrence   jsonb,   -- {freq:'weekly', byday:['mon','wed']}
  notify_min   integer DEFAULT 15,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
```

### Optional Migration D — `ai_log` (recommended)
Cost + abuse cap, durable per-user audit. Without it, "why did my bill spike" is unanswerable.
```sql
CREATE TABLE public.ai_log (
  id uuid PK, user_id uuid, intent text, model text,
  prompt_tokens int, completion_tokens int,
  duration_ms int, error text, created_at timestamptz
);
```

**No schema changes to:** `shifts`, `employers`, `wearable_*`, `subscriptions`, `push_subscriptions`, `notification_*`, `coach_messages` (kept for back-compat; new memory writes go to `ai_memory`).

---

## 3. Backend Services

### New
- `src/lib/ai/orchestrator.server.ts` — single entry point. `runAI({ userId, intent, messages?, stream? })`.
- `src/lib/ai/context.server.ts` — assembles `{ prefs, today's shift, fatigue, last-night wearable, recent memory, calendar }`. One async function, cached per request.
- `src/lib/ai/persona.server.ts` — builds system prompt from `assistant_name` + `assistant_mode`. Replaces the static `coach-personality.ts`.
- `src/lib/ai/memory.functions.ts` — `rememberFact`, `forgetFact`, `listMemory`, `forgetAll`. Server-fn (RLS as user).
- `src/lib/ai/extract-memory.server.ts` — after each coach turn, classify what the user said into 0–N memory candidates (cheap Gemini Flash call). Only writes if `memory_enabled`.
- `src/lib/search/index.server.ts` — universal search across shifts, events, memories, playbooks, employers (Postgres `ilike` + small in-memory rank, no extra service needed at this scale).

### Modified
- `/api/coach` → thin wrapper that calls `runAI({ intent: 'chat' })`. Keeps streaming.
- `/api/brief` → `runAI({ intent: 'brief' })`.
- `notifications/run.server.ts` → calls `runAI({ intent: 'alarm-rationale' })` to add a 1-line "why now" string to Smart Alarm pushes.
- `notifications/schedule.ts` → add `smart-wake`, `productivity-tip`, `event-reminder`, `commute` reminder kinds. Reuses existing quiet-hours/cap/dedupe logic.
- Nightly `pg_cron` job (already running every 5 min) gets a once-daily branch at 03:00 local that calls `runAI({ intent: 'routine-summary' })` and writes up to 2 memory rows per user with `memory_enabled = true`.

### Removed / consolidated
- `routes/api/insights.ts` (folded into orchestrator)
- `coach-personality.ts` (replaced by `persona.server.ts`)
- Inline context-building in `coach.tsx`, `brief`, `swap` (~400 LOC)

---

## 4. Frontend Changes

### New components
- `CommandPalette.tsx` — `cmdk`, ⌘K / FAB. Searches via `/api/search`, then offers "Ask AI" fallback (routes the query into the orchestrator).
- `CreationCards.tsx` — the 4 primary cards on homepage: **Plan Tonight**, **Log Shift**, **Ask Coach**, **Recovery Playbook**.
- `SmartWakeCard.tsx` — shows tomorrow's smart-alarm time + AI rationale on home + plan.
- `MemorySettings.tsx` — list, edit, delete individual memories; "Forget everything" button. Inside Profile.
- `AssistantSettings.tsx` — name, mode (Coach / Companion / Minimal), voice toggle, model tier (paid).
- `VoiceComposer.tsx` — wraps existing coach composer; Web Speech API STT with graceful text fallback.
- `EventEditor.tsx` + `EventsList.tsx` — calendar/reminder CRUD.

### Modified
- `routes/index.tsx` — rewritten around `CreationCards` + today/tomorrow strip + Smart Wake card. Keeps circadian ring.
- `BottomNav.tsx` — 5 → 4 tabs (Home / Plan / Coach / Profile). Playbooks/Swap/Share move into Home cards.
- `routes/coach.tsx` — uses VoiceComposer, displays assistant name in header, persona-driven greeting.
- `routes/profile.tsx` — adds Assistant + Memory sections.
- `routes/plan.tsx` — Smart Wake card, Commute card (when location + shift available).

### Untouched
Stripe/billing, wearables, auth, employers, push subscription plumbing.

---

## 5. API Changes

| Endpoint | Status | Purpose |
|---|---|---|
| `POST /api/ai` (new, streaming) | NEW | One endpoint, multiple intents |
| `POST /api/coach` | DEPRECATED → proxy | Back-compat for one release, then remove |
| `POST /api/brief` | DEPRECATED → proxy | Same |
| `POST /api/insights` | REMOVED | Folded into `/api/ai` with `intent:'recommendation'` |
| `GET  /api/search?q=` | NEW | Universal search |
| `POST /api/tts` | UNCHANGED | Already shipped |
| `/api/public/hooks/notify` | EXTENDED | New reminder kinds; no shape change |

**Server fns (typed RPC, not HTTP):** `memory.functions.ts` (CRUD + forgetAll), `events.functions.ts` (CRUD).

---

## 6. AI Service Architecture

- **Default model:** `google/gemini-3-flash-preview` (current). Cheap, fast, good enough for coach/brief/recommendation.
- **Premium tier:** `openai/gpt-5.4` for Elite subscribers — selected by orchestrator based on `ai_model_tier`. One line of branching.
- **STT:** Web Speech API on-device first (free). If unsupported (older iOS Safari), `openai/gpt-4o-mini-transcribe` fallback via `/api/tts`'s sibling route.
- **TTS:** existing OpenAI route.
- **Routine summarizer (cron):** Gemini Flash, ~500 tokens out, 1x/day per active user.
- **Memory extractor:** Gemini Flash, run async after assistant reply — does not block streaming.
- **Cost cap:** `ai_log` enforces a per-user daily token budget; over budget → orchestrator returns a friendly "let's pick this up tomorrow" instead of calling the model. Stops runaway cost from a single buggy client.

---

## 7. Security & Privacy

This is the highest-risk area in the sprint. Memory + voice change the legal surface area.

1. **Memory is opt-in, default OFF.** No memory writes until `memory_enabled = true`. Explicit consent screen on first toggle explaining what gets stored.
2. **Memory is user-owned.** Per-row delete + "Forget everything" + automatic deletion on account delete (CASCADE already in place).
3. **Memory never leaves Supabase.** Sent to the model only inside the orchestrator's system prompt, scoped to that user's rows via RLS; never logged in `ai_log` payload.
4. **STT is local-first.** Web Speech API runs on-device; cloud STT only with explicit per-session opt-in.
5. **No PII in `/api/public/hooks/notify` logs.** Already true; verify after extending.
6. **RLS audit.** Every new table gets `auth.uid()` scoped policies + `GRANT` block in the same migration (this template's known footgun).
7. **AI rate/cost cap** (Migration D + orchestrator check) prevents a compromised client from billing the workspace dry.
8. **Privacy Policy update required** before shipping memory + voice. Already have `routes/privacy.tsx` — add 2 sections.

---

## 8. Estimated Complexity

| Bundle | LOC est. | New files | Migrations | Risk |
|---|---|---|---|---|
| Bundle 1 — AI Foundation | ~1,400 | 8 | 2 (+ optional log) | Medium (privacy, model cost) |
| Bundle 2 — Daily Intelligence | ~900 | 6 | 1 | Low–Medium (notification spam) |
| Bundle 3 — UX Redesign | ~1,100 | 4 | 0 | Medium (breaking nav change) |
| **Total** | **~3,400** | **18** | **3** | — |

Three deploys, three live verifications, one comprehensive QA cycle at the end. Each bundle is ~3–5 working sessions.

---

## 9. Risks (ranked)

1. **Notification fatigue.** Adding 4 new reminder kinds on top of existing 5 can hit daily cap or annoy users into disabling everything. **Mitigation:** per-kind priority weights, stricter dedupe, default daily cap stays 6.
2. **Memory privacy backlash.** "The app is listening to me." **Mitigation:** opt-in, plain-English consent, visible memory list, one-click wipe, never auto-enable.
3. **iOS Safari STT gaps.** Partial support. **Mitigation:** feature-detect, fall back to typing silently.
4. **Bundle 3 nav change** breaks user muscle memory. **Mitigation:** one-time "What's new" sheet, keep deep-link URLs.
5. **Orchestrator becomes a god-object** if scope creeps. **Mitigation:** strict intent enum, one file per intent's prompt builder.
6. **Cost runaway** from voice + memory loops. **Mitigation:** `ai_log` daily token cap, hard ceiling per user per day.
7. **Migration D postponed** could mean we ship without cost visibility. Recommend including it in Bundle 1.

---

## 10. Opportunities to Combine Systems (reduce maintenance)

- One `/api/ai` endpoint replaces three. -1 route, -1 streaming setup, -1 set of error handling.
- One `runAI()` function means model swaps are one line.
- `user_events` reuses the existing notification engine — no second scheduler.
- Universal Search reuses Postgres + RLS — no Algolia / Meilisearch.
- Memory extractor runs in the same cron tick as notifications — no new cron.
- `CreationCards` replaces 3 separate home sections with one component.
- Persona system makes "add a new mode" a row in an enum + one prompt string, not a code change.

---

## 11. Build Order & QA

1. **Bundle 1 ship** → live verification: assistant name, mode switch, memory toggle, memory write/forget, voice round-trip, cost log.
2. **Bundle 2 ship** → live verification: Smart Alarm fires, commute card appears, calendar event creates push, recommendation card renders, no notification spam over 24h.
3. **Bundle 3 ship** → live verification: ⌘K search hits real data, 4-card homepage on mobile, navigation works, no broken deep links.
4. **One comprehensive QA cycle** across all three bundles: payments still work, wearables still work, full user flow, performance budget, security re-scan, accessibility pass, copy proofread.
5. **Launch prep:** Privacy Policy update, "What's new" sheet, App Store screenshots refresh.

---

## Decisions Needed Before I Start Bundle 1

1. **Include Migration D (`ai_log` + cost cap) in Bundle 1?** Strongly recommend yes.
2. **Replace `/api/coach`, `/api/brief`, `/api/insights` with single `/api/ai`?** Strongly recommend yes; lower long-term maintenance.
3. **Default assistant mode** for existing users: `coach` (clinical), `companion` (warm), or `minimal` (terse)?
4. **Memory retention default** when user enables it: forever, 90 days, 1 year? (User can override per-row.)
5. **Confirm Bundle 3 nav change is OK** (5 → 4 tabs, Playbooks/Swap/Share move into Home cards)?

Reply with your answers — or just "approved, your call on the 5" — and I'll begin Bundle 1.