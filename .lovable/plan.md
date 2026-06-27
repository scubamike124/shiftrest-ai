
# Step 2 — Memory Evolution + Intelligent Ranking

Goal: turn `ai_memory` from a flat recency list into a ranked, learning, user-controlled long-term store, and give it a proper home in the UI. No breaking changes — every existing call to `listMemories()` / `fetchRelevantMemories()` keeps working.

## 1. Schema additions (single migration)

Extend `public.ai_memory` (additive only, all NULL-safe):

| Column | Type | Default | Purpose |
|---|---|---|---|
| `importance` | smallint (1–5) | 3 | Long-term usefulness weight (set by extractor + user pin) |
| `use_count` | integer | 0 | How often the AI actually referenced this memory |
| `last_referenced_at` | timestamptz | null | Replaces overloaded `last_used_at` semantics; updated when injected into a prompt |
| `expires_at` | timestamptz | null | Optional soft TTL for transient facts ("this week I'm on nights") |
| `superseded_by` | uuid | null | Points at a newer memory that replaces this one (soft-delete chain) |
| `embedding_hash` | text | null | Lightweight dedupe key (normalized content hash; no pgvector needed yet) |

Index: `(user_id, superseded_by) WHERE superseded_by IS NULL` for the "active" set.

Keep existing `confidence`, `pinned`, `source`, `category` — they're inputs to the ranker. Keep `last_used_at` for back-compat; new code writes both.

## 2. Ranking function (server-only, `src/lib/ai/memory-rank.server.ts`)

Pure TS scorer — no LLM call, runs every time we build the system prompt.

```text
score =
   1.6 * pinned                         (0 or 1)
 + 1.0 * importance / 5
 + 0.8 * confidence
 + 0.6 * recencyDecay(updated_at, 60d half-life)
 + 0.4 * usageDecay(last_referenced_at, 30d half-life)
 + 0.3 * log1p(use_count) / 3
 + 1.2 * categoryRelevance(category, intent)   // e.g. caffeine matters more for right_now
 - 2.0 * expired(expires_at)
 - 5.0 * superseded
```

`fetchRelevantMemories(admin, userId, { intent, limit })` becomes: pull up to ~80 active rows, score in JS, return top N (default 25 for coach, 12 for JSON intents). After selection, fire-and-forget bump: `use_count += 1`, `last_referenced_at = now()` for the chosen IDs (single `UPDATE … WHERE id = ANY(...)`).

## 3. Smarter extractor (`memory-extractor.server.ts`)

Two upgrades, no new endpoints:

1. **Dedupe + supersede.** Before insert, compute a normalized hash (lowercased, punctuation-stripped, trimmed) and lookup existing active memories in the same category. If hash matches → bump `use_count`, `confidence = min(1, +0.1)`, refresh `updated_at`. If semantically close (same category + first 6 tokens overlap) → insert new row and set `superseded_by` on the old one.
2. **Importance + TTL hint.** Extractor JSON adds `importance: 1-5` and optional `ttl_days`. Schedule-ish facts ("on nights this week") get `ttl_days: 14`; durable facts ("works at Mercy Hospital") get `importance: 5`.

Still capped at 4 memories per turn, still only when `memory_enabled=true`.

## 4. Client API (`src/lib/ai-memory.ts`)

Additive surface, no breaking changes:

- `AIMemory` type gains `importance`, `useCount`, `lastReferencedAt`, `expiresAt`, `supersededBy`.
- `listMemories({ query?, category?, includeArchived? })` — server-side `ilike` search on `content` + category filter; hides `superseded_by IS NOT NULL` unless `includeArchived`.
- `updateMemory` accepts `importance` and `expiresAt`.
- New `setMemoryEnabled(boolean)` thin wrapper over `user_prefs.memory_enabled` so the Memory page can toggle without duplicating Assistant settings logic.

## 5. New route — `src/routes/_authenticated/memory.tsx`

Mobile-first, matches dashboard typography. Sections, top to bottom:

1. **Header strip** — "Long-term memory" + master On/Off switch (writes `user_prefs.memory_enabled`). When off: explain plainly what turning it on does, hide the list.
2. **Privacy card** — short, plain English: what's stored, what isn't (no emotions / transient state / medical data), where it lives (your account, encrypted at rest), how to export/wipe. Links to Privacy Policy.
3. **Search + filter bar** — text search, category chip filter, "Pinned only" toggle.
4. **Memory list** — reuses the existing card layout from `AIMemoryManager`, plus:
   - Importance dots (1–5, tap to change)
   - "Last used" relative timestamp + use count chip
   - Inline edit (textarea), category dropdown, pin, delete
   - Expiry pill when `expires_at` set (e.g. "expires in 6 days")
5. **Add memory** — same composer as today, with optional importance + TTL.
6. **Footer actions** — Export JSON, Clear all (existing confirm flow).

Add to nav: a "Memory" entry in `AppSidebar.tsx` and a link from Profile → "Manage memories" that deep-links here. The existing `AIMemoryManager` stays for now but Profile points users at the dedicated page.

## 6. Wiring into the orchestrator

`buildSystemPrompt` already takes `userId` + profile. Add an optional `intent` arg and pass it from `/api/ai`. `fetchRelevantMemories` switches to the new ranker. The system-prompt memory block is unchanged in shape — the AI experience is identical, just better-curated rows.

No prompt changes to coach voice, no changes to any other intent's JSON schema → zero risk to existing AI surfaces.

## 7. Quality bar

- All schema changes additive + backfilled (`importance=3`, `use_count=0`).
- RLS unchanged (still `auth.uid() = user_id` for all four ops).
- New page is `_authenticated` only.
- Mobile-first: single column ≤640px, two-column list ≥768px.
- Manual QA matrix: memory off → list hidden, extractor no-ops; memory on → add/edit/pin/delete/search/export/clear all work; ranker picks pinned > recent > old-but-important in console-logged debug; supersede chain doesn't surface duplicates.

## Build order

1. Migration (schema additions + indexes).
2. `memory-rank.server.ts` + update `fetchRelevantMemories`.
3. Extractor upgrades (dedupe, importance, ttl).
4. Client `ai-memory.ts` surface additions.
5. `/memory` route + sidebar/profile links.
6. QA pass on mobile viewport, then desktop.

Awaiting approval before any code changes.
