
# Slice 5 — AI Memory Foundation

Builds on the existing `ai_memory` table and `/memory` page. Adds sleep-domain categories, a transparent timeline view, a gradual learn-from-repetition engine with explicit user confirmation, learning pause/resume controls, and Companion awareness. No silent inference, no advanced reasoning.

## Scope (this slice only)

- Memory Timeline view at `/memory` with full transparency
- 5 new sleep-domain categories
- Repetition-based proposal engine (no one-shot memories)
- Explicit confirmation flow ("Would you like me to remember that?")
- Pause / Resume learning toggle
- Export, edit, delete, delete-all (extend existing)
- "How AI Memory Works" expandable card
- Companion reads sleep memories to offer suggestions (no auto-acting)

## Out of scope

- Embeddings / semantic recall
- Cross-device sync beyond Supabase
- Smart-home, traffic, jetlag deepening
- Background daemon learning beyond the existing nightly `ai-learn` cron

## Architecture

### Database

One migration extending the existing `ai_memory` table and adding a proposals table:

1. **Extend `ai_memory.category` CHECK constraint** to include:
   - `sleep_habits`, `alarm_prefs`, `favorite_sounds`, `daily_routine`, `companion_prefs`
   (Keep all existing categories for back-compat.)
2. **New table `ai_memory_proposals`** — pending suggestions awaiting user yes/no:
   - `user_id`, `category`, `content`, `evidence` (jsonb: counts, sample event IDs), `confidence`, `observed_count`, `first_seen_at`, `last_seen_at`, `status` ('pending' | 'accepted' | 'declined' | 'expired'), `decided_at`
   - RLS scoped to `auth.uid()`, GRANTs to `authenticated` + `service_role`
3. **Extend `user_prefs`** — add `memory_learning_paused boolean default false`.

### Server functions (`src/lib/memory.functions.ts`)

- `listMemoriesGrouped()` — returns memories grouped by category for timeline rendering
- `listProposals()` — pending proposals for the user
- `decideProposal({ id, accept })` — accept → insert into `ai_memory` (dedupe by `embedding_hash` of content), decline → mark `declined`
- `setLearningPaused(paused)` — writes `user_prefs.memory_learning_paused`
- `exportMemories()` — JSON download (reuse existing helper, just a server wrapper)
- `wipeAllMemories()` — already exists, surface in UI

### Repetition engine (`src/lib/ai/memory-proposer.server.ts`)

Runs inside the existing nightly `/api/public/hooks/ai-learn` cron. For each user where `memory_enabled = true` AND `memory_learning_paused = false`:

| Signal source | Detector | Threshold | Proposal |
|---|---|---|---|
| `shifts` sleep windows | median bedtime across last 14 days | ≥5 occurrences within ±30 min | "Usually goes to bed around 10:30 PM" → `sleep_habits` |
| `shifts` wake times | median wake | ≥5 occurrences ±30 min | "Usually wakes around 6:00 AM" → `sleep_habits` |
| `sound_mixes` plays + `user_events` (sound_play) | most-played track | ≥4 plays in 14 days | "Usually listens to Rain" → `favorite_sounds` |
| Sleep-timer durations from `user_events` | mode duration | ≥4 occurrences | "Usually uses a 45-minute timer" → `alarm_prefs` |
| Sleep-mode triggers from `user_events` | count of `sleep_mode` before bed | ≥4 occurrences | "Usually starts Sleep Mode before bed" → `daily_routine` |

Each detector:
- Skips if an active (non-superseded) memory already covers the fact (dedupe by category + canonical content)
- Skips if a proposal for the same fact is already `pending` or was `declined` in the last 30 days
- Inserts into `ai_memory_proposals` only — never directly into `ai_memory`

### Companion awareness (`src/routes/companion.tsx` + `src/lib/voice/companion-sound-bridge.ts`)

- On companion open: fetch top 3 active memories from `sleep_habits` + `favorite_sounds` + `alarm_prefs` (cheap server fn).
- When user says ambiguous bedtime intents like "I'm going to bed" / "start sleep mode" with no track named, the bridge offers the remembered favorite once per session: `"You usually use Rain before bed. Want me to start it?"` (uses existing confirmation flow).
- Cap: at most one memory reference per conversation turn; never auto-act without confirmation.
- Pending proposals surface as a single non-intrusive chip in the Companion header: "1 thing to remember →" linking to `/memory`.

### `/memory` UI (mobile-first redesign)

Sections, in order:

1. **Header** — back link, "My Memory", pause/resume switch, "Export" + "Delete all" buttons
2. **Pending proposals** (when any) — card stack with content, evidence summary ("Seen 6 times in 14 days"), confidence, **Yes, remember / Not now** buttons
3. **Timeline** — grouped by category (Sleep Habits, Alarm Preferences, Favorite Sounds, Daily Routine, Companion Preferences, then existing categories). Each card shows:
   - Content (editable)
   - Learned: relative date
   - Why: source label ("Detected from your shifts", "You confirmed this", "From conversation")
   - Confidence pill
   - Edit / Delete buttons
4. **How AI Memory Works** — expandable card explaining: optional, OFF by default, learns only with permission, full user control, links to Privacy
5. **Manual add** (existing) — kept for direct memory entry

Design: reuses existing tokens, card surfaces, and `Switch` / `Button` primitives. No new palette.

## Files to add

- `supabase/migrations/<ts>_slice5_memory_foundation.sql`
- `src/lib/ai/memory-proposer.server.ts` — detectors
- `src/lib/memory.functions.ts` — server fns
- `src/components/memory/ProposalCard.tsx`
- `src/components/memory/HowMemoryWorks.tsx`
- `src/components/memory/MemoryTimeline.tsx`

## Files to edit

- `src/routes/memory.tsx` — replace body with timeline + proposals + how-it-works (keep manual add)
- `src/routes/api/public/hooks/ai-learn.ts` — call `runMemoryProposer(userId)`
- `src/routes/companion.tsx` — fetch top memories, render proposal-count chip
- `src/lib/voice/companion-sound-bridge.ts` — memory-aware fallback for unspecified-track sleep intents
- `src/lib/prefs.ts` — add `memoryLearningPaused` field

## QA plan (mobile 390×844 + desktop 1280×1800, authenticated)

1. `/memory` loads; pause/resume toggle persists across reload
2. Seed a pending proposal via psql, confirm Yes inserts an `ai_memory` row and proposal flips to `accepted`; No flips to `declined` and no memory is created
3. Timeline groups memories by the 5 new categories; edit + delete work
4. Export downloads JSON; delete-all wipes
5. "How AI Memory Works" expands
6. Companion: with `memory_enabled=false`, no memory chip appears and no memory references in chat
7. Companion: with a `favorite_sounds: Rain` memory, saying "start sleep mode" prompts "You usually use Rain before bed. Want me to start it?" → "yes" routes through the existing bridge
8. `/sleep` and existing Companion sound commands continue working
9. `bunx tsgo --noEmit` clean; no console errors

Awaiting approval to implement.
