# Step 4 — Travel, Time Zones, and Offline Mode

Builds on the AI orchestrator, predictive layer, and existing shift/wearable telemetry. All travel logic flows through the same `/api/ai` gateway and the same `COACH_VOICE`. All offline behavior reuses already-generated `ai_recommendations` so there is one source of truth between online and offline.

## 1. Architecture overview

Three coordinated layers:

- **Time-zone layer** — every plan, shift, alarm, and recommendation carries an explicit IANA tz + UTC instant. Body-clock vs local-clock are derived from a *home_tz* anchored to the user, and a *current_tz* derived from device, last GPS, or an active trip.
- **Trip layer** — a new `trips` table models planned/active legs (origin tz → destination tz, depart/arrive UTC). Patterns and predictive intents read it to pre-stage jet-lag plans.
- **Offline layer** — a small, versioned IndexedDB cache (Dexie) holds the last hydrated bundle: shifts, prefs, last 7 days of recommendations, sun tables for ±14 days, cached TTS audio for the next alarm/wind-down. A service worker handles asset + JSON cache; the existing push SW stays untouched.

Travel and offline never branch the AI prompt logic — they extend the context block (`buildSystemPrompt`) with `tz_state` and an `is_stale` flag, and the model adjusts wording accordingly.

## 2. Database changes

One migration. All RLS-scoped to `auth.uid()`, service_role full access, with grants in the same migration.

- **`trips`** — `id, user_id, label, origin_tz, dest_tz, depart_utc, arrive_utc, dest_lat, dest_lon, dest_label, status (planned|active|completed|cancelled), source (manual|calendar|wearable|detected), created_at, updated_at`. Indexes on `(user_id, arrive_utc)` and `(user_id, status)`.
- **`tz_events`** — append-only ledger of detected tz changes: `id, user_id, detected_at, from_tz, to_tz, source (device|gps|trip|manual), confidence`. Feeds the `timezone_jump` pattern detector.
- **`shifts`** add: `tz` text (nullable; falls back to user home_tz), `start_utc timestamptz`, `end_utc timestamptz` (computed on write from `day+start_min+tz`). Existing `day/start_min/end_min` stay for the editor.
- **`ai_recommendations`** add: `tz` text, `valid_in_tz` text, `body_clock_basis` text. So an offline client can render a recommendation with correct "your body still thinks it's 3am" framing.
- **`user_prefs`** add: `home_tz text`, `current_tz text`, `tz_auto boolean default true`, `offline_enabled boolean default true`, `travel_mode_enabled boolean default true`, `calendar_travel_detect boolean default false` (off by default, opt-in).

No breaking change: existing shifts get `tz := user_prefs.home_tz` and `start_utc/end_utc` backfilled by a one-shot SQL update in the migration.

## 3. Backend changes

### Server functions (`src/lib/travel/trips.functions.ts`, `src/lib/travel/tz.functions.ts`)
- `listTrips`, `upsertTrip`, `cancelTrip`, `activateTrip(now)`.
- `setHomeTz`, `setCurrentTz` (auto/manual), `reportDeviceTz(ianaTz)` — called on app load and on resume.
- `getTzState()` — returns `{ home_tz, current_tz, active_trip, body_clock_offset_min, dst_changes_within_14d }`.

### Patterns (`src/lib/ai/patterns.server.ts`)
- New detectors: `tz_shift_pending` (trip departing <48h), `tz_shift_active` (trip arrived <72h, severity = hours of delta / 3), `dst_transition` (clock change in next 7d), `body_clock_drift` (current_tz ≠ home_tz for >24h with no trip — likely undetected travel).
- All write to `ai_patterns` like Step 3; ranker already promotes high-severity ones.

### Orchestrator (`src/routes/api/ai.ts`)
- Extend `buildSystemPrompt` to inject a `TZ STATE` block: home tz, current tz, body-clock offset, active trip (origin/dest/arrive_utc), and DST transitions in window.
- New intent `jetlag_plan` — given a trip, returns a 3-day adaptation plan (sleep anchor, light windows by local clock, caffeine cutoff, nap rules, melatonin-timing note as informational only). Schema mirrors `tomorrow_preview` (blocks) so the UI reuses `TomorrowPreviewCard`.
- Existing intents (`right_now`, `daily_plan`, `tomorrow_preview`, `daily_review`, `smart_alarm`, `commute`) now receive tz_state and must state the basis in their `why` field when home_tz ≠ current_tz.
- `COACH_VOICE` gets two clauses: (1) when body clock and local clock disagree, label which one a recommendation is anchored to; (2) when responding from cached/offline data, prefix or flag "based on data from <relative time>".

### Cron (`src/routes/api/public/hooks/ai-learn.ts` already exists)
- Add a second cron entry that runs trip activation + jetlag plan pre-generation 6h before `arrive_utc`, so the user lands with the plan already cached.

### Sun/clock engine (`src/lib/sleep-engine.ts`)
- Replace the `lon/15` offset hack with proper IANA-resolved offsets via `Intl.DateTimeFormat` (no extra deps; tz-aware). Add `sunTimesForTz(date, lat, lon, tz)` and `bodyClockTime(localIso, currentTz, homeTz)` helpers.
- All callers (`plan.tsx`, `LongClock.tsx`, `SmartAlarmCard.tsx`, patterns engine) pass tz explicitly.

## 4. Frontend changes

### New
- `src/routes/_authenticated/trips.tsx` — list, create, edit trips. Manual origin/dest tz pickers with autocompleted IANA list, calendar imports later behind the opt-in flag.
- `src/components/JetlagPlanCard.tsx` — renders `jetlag_plan` blocks per day (Day 0/+1/+2). Reuses `FeedbackChips` and `TrustReceipt`.
- `src/components/TzBadge.tsx` — small chip "Home NYC · Now LON (+5h)" visible on dashboard hero and on every time-bearing card; tap opens a popover explaining body vs local clock.
- `src/components/OfflineBanner.tsx` — top-of-app strip when offline, showing last sync time and what is still available.
- `src/routes/_authenticated/settings/travel.tsx` (or new section in Assistant settings): home tz, auto-detect toggle, travel mode toggle, calendar detect toggle, offline cache toggle + size + clear button.

### Modified
- `LongClock.tsx` — render two rings when body_clock_offset_min ≠ 0: outer = local clock, inner = body clock with a faded second sun arc.
- `SmartAlarmCard.tsx` — show both times when in travel; alarm rings on local-clock time, label notes body-clock time.
- `RightNowCard.tsx`, `TomorrowPreviewCard.tsx`, `DailyReviewCard.tsx`, `CompanionWhisper.tsx` — accept `tzBasis` from the recommendation, render the TzBadge, and surface `isStale` from offline cache.
- `ArrivalHero.tsx` — when arriving from a tz_shift_active pattern, swap headline to "Welcome to {city} — recovery plan ready."

## 5. Local / offline storage strategy

- **DB**: Dexie (IndexedDB) at `src/lib/offline/db.ts`. Tables: `prefs`, `shifts`, `trips`, `recommendations`, `patterns`, `sun_cache (date,lat,lon,tz → {sunrise,sunset})`, `tts_cache (key → blob,createdAt)`, `meta (lastSyncUtc, schemaVersion)`. Versioned migrations.
- **What lives offline**: last 14 days + next 7 days of shifts, active+upcoming trips, last 7 days of recommendations across all intents, current `tomorrow_preview` + `daily_review` + active patterns + pre-generated `jetlag_plan`, sun tables ±14 days for home + active trip dest, TTS blobs for the next wind-down and next smart alarm only.
- **Caps**: hard 25 MB; LRU evict TTS first, then old recommendations.
- **Service worker** (`public/sw.js` is push-only today): split into `public/sw-push.js` (existing, unchanged) and a new `public/sw-app.js` registered separately. App SW does NetworkFirst for HTML, CacheFirst for `/assets/*`, StaleWhileRevalidate for `/api/ai` GETs (we treat persisted recommendations as GET-cacheable). Respect the existing Lovable preview guards — do not register the app SW in preview/dev.
- **Hydration**: a `useOfflineBundle()` hook reads Dexie on cold start so the dashboard paints before network resolves; React Query keys are shared so the network response replaces cache.

## 6. Sync strategy

- **Online → cache**: every successful server response writes through to Dexie (recommendations, patterns, prefs, shifts, trips, sun) under one `lastSyncUtc`.
- **Offline → queue**: user feedback (`submitFeedback`), shift edits, trip edits, manual tz overrides, alarm dismissals are appended to an `outbox` table with idempotency keys. On reconnect, a `flushOutbox()` posts them in order. Server side: `submitFeedback` and shift/trip mutations accept an `idempotency_key` to dedupe.
- **Reconnect handler** (`src/lib/offline/reconnect.ts`): on `online` event,
  1. `flushOutbox`,
  2. fetch fresh `getTzState`,
  3. compare against last cached tz; if changed, fire `reportDeviceTz`, run pattern detection, request a fresh `right_now` + `tomorrow_preview`,
  4. surface a single toast: "Welcome to {city}. I detected a {Δh}h change and rebuilt your plan."
- **Calendar travel detect** (opt-in only): no calendar OAuth in this step — placeholder hook reading `user_events` if a future Google Calendar connector lands. Documented but gated off.

## 7. Privacy & permissions

- Location: already used for sun times. Travel mode does NOT add background location. We only read tz from `Intl.DateTimeFormat().resolvedOptions().timeZone` (no permission needed) and one-shot GPS *only* when the user taps "use my location" on the trip editor.
- Calendar: not wired this step; toggle disabled with "coming soon" copy. No data leaves device until user enables.
- Offline cache: disable toggle wipes Dexie immediately. Memory page export bundle gains `trips`, `tz_events`, and a redacted cache snapshot.
- The trust-receipt on each card lists exactly which signals (tz, trip, last GPS time, last sync) produced it. Nothing is inferred silently.

## 8. Security risks & mitigations

- **Service worker hijacking stale content** — strict NetworkFirst for HTML + cache versioning by build hash; kill-switch route `?sw=off` honored.
- **Outbox replay after token rotation** — every queued mutation re-attaches current bearer at flush time; rejected ones move to a dead-letter view in settings.
- **Cached PII at rest** — IndexedDB is origin-scoped; we never persist auth tokens to Dexie; TTS blobs are short audio with no transcripts.
- **Spoofed tz** — device tz is treated as a *hint*, not truth. Patterns compare against last shift location and known trip; large unexplained jumps prompt a confirmation instead of silently rebuilding the plan.

## 9. Performance impact

- Dexie cold read on dashboard < 30ms typical; first paint no longer waits on network.
- One extra `getTzState` per cold start (cached 5 min).
- Sun-table cache eliminates repeated `Intl` calls on `LongClock` re-renders.
- Service worker adds one extra request per navigation in worst case; offset by cached assets.

## 10. Edge cases

- DST forward jump during a sleep block → smart alarm uses UTC instant, not wall-clock; UI shows "(clocks moved forward 1h)".
- Two trips overlap (layover) → active trip = the leg whose `arrive_utc ≤ now < next.depart_utc`; otherwise show layover banner.
- Wearable readings arrive in device-local tz while user is mid-flight → server normalizes everything to UTC, displays in current_tz.
- Returning home before `arrive_utc` of return trip → reconnect handler cancels the stale trip on user confirmation.
- User wipes app data → Dexie gone, outbox lost; we warn in the offline settings screen.
- Antimeridian / negative offsets / half-hour zones (IST, NPT) — handled by `Intl`; no manual math.

## 11. UX recommendations

- Single global `TzBadge` in the dashboard header is the visible "trust anchor" — one tap reveals the basis.
- Jet-lag plan is presented as Day 0/+1/+2 cards, not a single wall of text.
- Offline banner is informational, not alarming; copy: "Offline — your plan is from 2h ago. I'll refresh when you reconnect."
- After reconnect, exactly one toast, never a flood.
- New-user defaults: home_tz auto-set from device on first run, travel_mode ON, offline ON, calendar OFF.

## 12. Testing plan

- Unit: `sunTimesForTz` against known IANA offsets incl. DST edges, half-hour zones, southern hemisphere.
- Unit: pattern detectors for tz_shift_pending/active, dst_transition, body_clock_drift with fixture data.
- Integration: outbox flush with simulated 401 → token refresh → retry; dedup on idempotency key.
- E2E (Playwright): toggle airplane mode via CDP, navigate dashboard, confirm offline banner + cached recs render; re-enable network, confirm reconnect toast + fresh data.
- Manual: cross-tz scenario — set device tz forward, refresh, confirm Trips→active trip detection prompt; accept and verify jetlag_plan renders.
- Typecheck (`tsgo`) and `bun run build` clean before merge.

## 13. Rollout order

1. Migration (trips, tz_events, shifts cols, ai_recommendations cols, user_prefs cols) + grants + RLS + shift backfill.
2. Sun engine tz rewrite + helpers + unit smoke.
3. Server fns (trips, tz_state) + pattern detectors + new orchestrator intent `jetlag_plan` + system-prompt tz block.
4. Dexie cache layer + outbox + reconnect handler + offline hook (no SW yet, behind `offline_enabled`).
5. App service worker (guarded, NetworkFirst HTML) + settings toggle.
6. UI: TzBadge → Trips route → JetlagPlanCard → OfflineBanner → LongClock dual ring → travel settings page.
7. Cron addition for pre-arrival plan generation.
8. Typecheck, Playwright offline scenario, manual cross-tz smoke.

Approve and I'll start with the migration.
