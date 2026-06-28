# Slice 6 — Smart Morning Intelligence

Make the Companion the first thing users open every morning. The Companion greets the user with a personalized, card-based **Morning Brief** built from data RestPilot already has (sleep, smart alarm, weather, calendar, memory) — never from a blank prompt.

This slice intentionally does **not** redesign the homepage. It puts the architectural seam in place: a small avatar on `/dashboard` that opens the full Companion, and the Morning Brief living inside the Companion route so it can later be lifted to the homepage.

---

## 1. User-facing behavior

When the user opens `/companion` between 04:00–11:00 local time (or pulls down "Refresh" any time), they see:

1. **Greeting strip** — "Good morning, Michael. 7:14 AM" + assistant name.
2. **Morning Brief stack** — ordered cards, each independently loadable, each with a graceful empty/skeleton/hidden state.
3. **One AI recommendation** — single, short sentence under the stack ("Traffic is heavier than usual. Leave by 7:05.").
4. **Composer** — existing chat input stays at the bottom; "Review today's schedule?" appears as a suggested chip after the brief.

Outside the morning window the Companion shows its normal greeting; the Morning Brief is collapsed behind a "Show this morning's brief" button so we never feel stale at 8 PM.

---

## 2. Cards

Each card is an isolated component with three states: `loading`, `ready`, `unavailable` (→ unmounted, never shown as error).

| Card | Source | Notes |
|---|---|---|
| Sleep | `insights.ts` + last shift / smart alarm | Duration + score badge |
| Smart Alarm | `SmartAlarmCard` data | Status + next ring |
| Weather | Open-Meteo (already wired in `/api/brief`) | Current + today high/low/condition |
| Traffic | Google Distance Matrix (new) | Home → primary work address, baseline vs today |
| Calendar | Google Calendar connector (new per-user OAuth, see §6) | Next 3 events today |
| Departure | derived from Traffic + first calendar event | "Leave by 7:05" |
| Long Clock | `LongClock` events store | Today's items |
| Daily Motivation | static rotation, seeded by date | No network |
| AI Tip | `/api/ai` `coach_tip` intent with brief context | One sentence, cached 4 h |

Hidden by default until enabled: Traffic, Calendar (require connections).

---

## 3. Frontend changes

```text
src/routes/companion.tsx                 mount <MorningBrief /> above orb in AM window
src/components/morning/MorningBrief.tsx  orchestrator: ordering, refresh, empty rollup
src/components/morning/cards/            one file per card listed above
src/components/morning/BriefSettingsSheet.tsx  toggle + reorder UI
src/lib/morning/layout.ts                client store for card order + visibility (user_prefs.brief_layout)
src/lib/morning/useMorningBrief.ts       react-query orchestrator, parallel sources, 60s stale
src/routes/dashboard.tsx                 small CompanionAvatar button (top-right) → /companion
src/components/companion/CompanionAvatar.tsx  reused orb at 40px, pulses when brief is fresh
```

Cards fetch in parallel via independent `useQuery`s keyed `["brief", source, date]`. The orchestrator never blocks on the slowest source — each card renders the moment its data resolves.

Settings sheet writes `user_prefs.brief_layout` (jsonb: `{ order: string[], hidden: string[] }`). Drag-reorder via `@dnd-kit/core` (already in tree if present; otherwise simple up/down buttons — no new dep).

---

## 4. Backend changes

New server route: **`src/routes/api/morning-brief.ts`** (auth-gated server fn, not a public route).

Returns a single composite payload so the client makes one round trip during cold load:

```ts
{
  greeting: { name, timeISO },
  sleep:    { hours, minutes, score } | null,
  alarm:    { nextAt, label } | null,
  weather:  { tempC, condition, highC, lowC, icon } | null,
  traffic:  { etaMin, baselineMin, delta } | null,
  calendar: { events: [{ start, title, location }] } | null,
  longClock:{ events: [...] } | null,
  tip:      { text, source: "ai" | "static" } | null,
}
```

Implementation rules:
- Each sub-fetch wrapped in `Promise.allSettled`; failures → `null` (caller hides the card). Never throw.
- Per-source timeout 1500 ms.
- Server-side cache (in-memory LRU keyed `userId:date:hour`) for weather/traffic/calendar so repeat opens within an hour are free.
- `ai_tip` only generated when `has_ai_budget(user)` is true; otherwise omit.
- AI prompt receives only the structured brief fields it needs, plus top-3 ranked memories (existing `memory-rank`).

New DB migration:
```sql
ALTER TABLE public.user_prefs
  ADD COLUMN IF NOT EXISTS brief_layout jsonb
    DEFAULT '{"order":["sleep","alarm","weather","traffic","calendar","longclock","tip"],"hidden":["traffic","calendar"]}'::jsonb,
  ADD COLUMN IF NOT EXISTS home_address text,
  ADD COLUMN IF NOT EXISTS work_address text;
```
(No new table — keeps blast radius small.)

---

## 5. Data sources

| Source | Status | Action |
|---|---|---|
| Sleep, Smart Alarm, Long Clock | Already local | Reuse existing libs |
| Weather (Open-Meteo) | Already used in `/api/brief` | Extract into `src/lib/weather.server.ts` and call from both |
| Traffic | **New** — Google Maps Platform connector (gateway-enabled, listed in available connectors) | Distance Matrix API; user must enter `home_address` + `work_address` in profile |
| Calendar | **New** — per-user Google OAuth (the workspace Google Calendar connector reads the *developer's* account, not end users — wrong scope here) | Build minimal OAuth: client id/secret as secrets, `/api/google/callback` route, store refresh token in new `oauth_tokens` table |
| AI tip | Lovable AI Gateway (existing) | Reuses `has_ai_budget` |
| Motivation | Static, bundled | None |

Per-user Google OAuth is the heaviest piece. **Recommendation:** ship cards in two waves so users feel value immediately:

- **Wave A (this slice):** Sleep, Alarm, Weather, Long Clock, Motivation, AI Tip, Departure (using a user-entered "usual commute minutes" instead of live traffic).
- **Wave B (follow-up slice):** Google Maps connector for live traffic + per-user Google Calendar OAuth.

This keeps Slice 6 deliverable in one pass while preserving the architecture for Wave B (cards already exist, they just light up when their data source connects).

---

## 6. Personalization strategy

Only when `prefs.memory_enabled = true` AND ranked memories return ≥1 hit with importance ≥3:

- Inject up to 2 memory snippets into the AI tip prompt under a `# What I know about you` section (same pattern as Companion chat).
- A single memory may also surface as a one-line subtitle on a card (e.g., the Sleep card shows "You usually sleep 7h 30m — tonight you got 7h 42m"). Hard cap: **one** memory-derived line per Morning Brief render to avoid the "creepy" feeling.
- Never invent facts. If memory is off → no personalization, neutral copy.

---

## 7. Homepage integration approach

This slice prepares, it does not redesign:

- `src/routes/dashboard.tsx` gets a 40 px `CompanionAvatar` pinned top-right that links to `/companion`. The orb pulses gently when there's an unread Morning Brief for today (tracked in `localStorage` `brief:lastSeen:<userId>:<date>`).
- The Morning Brief components are built **source-of-truth-free of route**: they accept their data via props from `useMorningBrief`. When we later promote the Brief to the homepage we lift the hook one level — no rewrites.

---

## 8. Performance

- Parallel `Promise.allSettled` server-side; 1500 ms per-source timeout.
- In-memory server cache per user/hour for weather/traffic/calendar.
- Client `react-query` `staleTime: 5 * 60_000`, `gcTime: 30 * 60_000`.
- Skeletons render in ≤16 ms (no layout shift): cards reserve their final height via `min-h-*`.
- AI tip request gated behind budget check + cached 4 h per user/day to avoid token waste.
- Brief payload should land under 4 KB JSON.

---

## 9. Privacy review

- All new data (home/work address, OAuth tokens) lives in the user's row, RLS scoped to `auth.uid()`, GRANTs added in the same migration.
- Per-user Google tokens stored encrypted-at-rest (Supabase default) in a new `oauth_tokens` table (Wave B); refresh-only flow, no token ever sent to the client.
- Memory usage in the brief obeys the existing `memory_enabled` + `memory_learning_paused` switches and only reads *accepted* memories.
- `/legal/third-parties` updated to list Google Maps + Google Calendar before Wave B ships.
- The Morning Brief never logs PII to `ai_log`; only structured field names are recorded.

---

## 10. Testing plan

Automated:
- Vitest for `useMorningBrief` orchestrator: each source independently failing → card hides, others render.
- Vitest for layout store: reorder + hide round-trip through `user_prefs`.
- Playwright (mobile + desktop viewports):
  - Cold morning load shows all enabled cards within 2 s.
  - Toggling Weather off in settings removes the card and persists across reload.
  - Forced weather failure (network mock) → card simply not present, no error banner.
  - Dashboard avatar navigates to `/companion`; pulse clears after view.
- Typecheck: `bunx tsgo --noEmit` clean.

Manual sanity sweep after merge:
- Slice 3/4/5 regressions: Companion chat, sound bridge, memory proposals, pause/resume still work.
- Sign-out path: `/companion` shows the existing sign-in CTA, no Morning Brief request fired.

---

## 11. Implementation order

1. DB migration: `brief_layout`, `home_address`, `work_address` on `user_prefs`.
2. `src/lib/weather.server.ts` extracted from `/api/brief`; both endpoints use it.
3. `src/routes/api/morning-brief.ts` server fn with Wave A sources + `Promise.allSettled`.
4. `useMorningBrief` hook + skeletons.
5. Individual cards (Sleep, Alarm, Weather, Long Clock, Motivation, AI Tip, Departure).
6. `MorningBrief` orchestrator mounted in `/companion` (AM window logic + manual reveal).
7. `BriefSettingsSheet` for visibility/reorder; persist to `user_prefs`.
8. `CompanionAvatar` on `/dashboard` with pulse-on-fresh logic.
9. Playwright sweep + typecheck.
10. Wave B (separate slice, separate plan): Google Maps Distance Matrix + per-user Google Calendar OAuth.

---

## Out of scope (call out explicitly)

- Full homepage redesign — deferred to its own slice.
- Voice readout of the Morning Brief — Slice 7 candidate (reuse existing TTS).
- Push-notification version of the Brief — already covered by the notifications system; this slice is the in-app surface only.

Awaiting approval before I touch code.
