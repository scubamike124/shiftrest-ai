## Phase 2: Premium AI Experience — Investigation & Plan

This is the investigation deliverable. Nothing ships until you approve and pick a slice.

### Current baseline (what I confirmed in the repo)

- Voice briefing today: `src/routes/plan.tsx` uses browser `SpeechSynthesisUtterance`. That's the robotic voice. It has no controls (no pause/seek/speed), no abbreviation expansion, and no streaming.
- Shifts table: `public.shifts` already has nullable `title`, `notes`, `shift_type` columns — but no `job_id`. There is no `jobs` table yet.
- AI Coach: `src/routes/api/coach.ts` streams `google/gemini-3-flash-preview` through the Lovable AI Gateway. History persists in `coach_messages` and is hydrated on mount — good base for memory.
- Dashboard: `src/routes/index.tsx` is mostly a static bento + ring; no AI advice card, no fatigue score, no recovery score.
- No wearable code anywhere.

### Recommended architecture (one-pass, additive)

**TTS (Section 1 + 2)** — switch from browser SpeechSynthesis to Lovable AI Gateway `openai/gpt-4o-mini-tts` via a new server route `src/routes/api/tts.ts`. PCM streaming + WebAudio scheduling so playback starts in <1s. Free credits already wired (`LOVABLE_API_KEY` exists). Voice presets map to OpenAI voices: Calm Female=`shimmer`, Calm Male=`onyx`, Friendly=`nova`, Professional=`alloy`, Energetic=`fable`. Selected voice + speed stored in `user_prefs` (new columns). Abbreviation expander lives in `src/lib/voice-rewriter.ts`: deterministic regex pass (`mg`→`milligrams`, `30 min`→`30 minutes`, `100-200`→`one hundred to two hundred`, time/temperature, etc.). For polish on full briefings, a server fn calls Gemini-3-flash with a "rewrite this as a warm coach speaking aloud, expand all abbreviations, no lists, no punctuation tricks" prompt before TTS. Player component (`src/components/VoicePlayer.tsx`) owns AudioContext, exposes play/pause/resume/stop/restart/seek/speed/progress, and is reused everywhere voice plays.

**Multi-employer (Section 3)** — additive migration:
- New `public.jobs` (`id, user_id, name, color, is_default, created_at, updated_at`) + RLS + GRANTs.
- Extend `public.shifts` with `job_id uuid REFERENCES jobs(id) ON DELETE SET NULL`. (`title`/`notes` already exist — reuse them as shift name + notes.)
- Auto-create "My Job" on first read for legacy users; legacy shifts get `job_id = null`, treated as the default.
- `src/lib/jobs.ts` (CRUD), shift form gains Job picker + color pill, week grid color-codes by job.
- Coach + Plan prompts include the job name so AI can say "before your St. Mary's night".
- Playbooks' `replaceAllShifts` becomes per-job scoped.

**AI Dashboard + Fatigue + Recovery (Sections 4, 5, 6)** — one shared "insights" pipeline so we don't pay for three separate AI calls:
- New `src/lib/insights.functions.ts` server fn (`generateDailyInsights`). Inputs: last 14 days of shifts (grouped by job), prefs, today's date. Returns one structured JSON: `recoveryScore (0-100)`, `fatigueLevel (low|moderate|high|critical)`, `sleepDebtHours`, `recommendedNap {start, durationMin}`, `caffeineWindow {on, cutoff}`, `bedtimeTonight`, `topAdvice` (1 sentence), `warnings[]`, `weeklyTrend`.
- Cache the result for 6h in a new `public.daily_insights` table keyed by `user_id + date` so the dashboard renders instantly and AI is called at most ~4×/day per user. Stale-while-revalidate via TanStack Query.
- Dashboard re-renders cards from this single payload — no extra round-trips. Fatigue badge, recovery score ring, advice card, nap suggestion, caffeine windows all read the same object.
- Recovery Planner page = the same payload presented as a checklist (sleep / nap / hydration / meals / light / caffeine).

**Weekly Report (Section 7)** — same pipeline, different scope. `generateWeeklyReport` server fn called once per ISO week, cached in `public.weekly_reports`. Returns `avgSleepHrs, recoveryTrend, fatigueTrend, bestDay, worstDay, suggestions[]`. New route `src/routes/report.tsx`.

**Coach memory (Section 8)** — small upgrade, no new tables. Before each completion in `api/coach.ts`, server-side enrich the system prompt with: current jobs (names only), recent rotation summary (already computable from shifts), latest `daily_insights` row, and the last ~20 user/assistant turns (already persisted). Coach immediately "remembers" context without a vector DB.

**Wearables (Section 9)** — architecture only. Define `src/lib/wearables/provider.ts` interface (`fetchSleep(range): SleepSession[]`, `connect(): Promise<Connection>`, `disconnect()`). Stub providers `apple-health.ts`, `google-fit.ts`, `fitbit.ts`, `garmin.ts`, `oura.ts`, `whoop.ts` that throw "coming soon". New `public.sleep_sessions` table ready to receive normalized data later. No UI beyond the existing "coming soon" tile. Real integrations need OAuth apps + (for Apple/Google) Capacitor — that's a separate future phase.

### Recommended implementation order (cheapest → most valuable bundles)

Bundle A — **TTS overhaul + player** (Sections 1+2). Highest user-perceivable lift, no schema changes, 1 server route + 1 component + 1 rewriter. Sets the voice infra for every future spoken feature.

Bundle B — **Multi-employer** (Section 3). One migration + jobs CRUD + UI tweaks. Unlocks per-job context for every AI feature in Bundle C, so it has to land before C.

Bundle C — **Insights pipeline + AI Dashboard + Fatigue + Recovery Planner** (Sections 4+5+6). One AI call shape, one cache table, three surfaces. Biggest "wow" moment. Coach memory (Section 8) is a 50-line patch tacked onto the end of this bundle since it reads the same insights row.

Bundle D — **Weekly Report** (Section 7). Reuses the insights helpers; mostly a new route + cache table.

Bundle E — **Wearables scaffolding** (Section 9). Interface + stub providers + table; zero UI change.

### Files that will change (by bundle)

- A: `src/routes/api/tts.ts` (new), `src/lib/voice-rewriter.ts` (new), `src/lib/voice-rewriter.functions.ts` (new, Gemini polish), `src/components/VoicePlayer.tsx` (new), `src/routes/plan.tsx` (swap `speak()` → `<VoicePlayer text={…}/>`), `src/lib/prefs.ts` (+`voicePreset`, `voiceSpeed`), profile UI for voice + speed.
- B: migration (jobs + shifts.job_id), `src/lib/jobs.ts` (new), `src/routes/index.tsx` (job picker on shift form, color pills), `src/lib/playbooks.ts` (per-job), `src/routes/swap.tsx` + `src/routes/api/coach.ts` (job context in prompts).
- C: migration (`daily_insights`), `src/lib/insights.functions.ts` (new), `src/routes/index.tsx` (advice/fatigue/recovery cards), `src/routes/plan.tsx` (read nap + caffeine from insights), new `src/routes/recovery.tsx`, `src/routes/api/coach.ts` (memory enrichment).
- D: migration (`weekly_reports`), `src/lib/weekly-report.functions.ts`, new `src/routes/report.tsx`, nav entry.
- E: migration (`sleep_sessions`), `src/lib/wearables/*` stubs.

### Database changes summary

1. `jobs` (Bundle B) + `shifts.job_id` column.
2. `daily_insights` (Bundle C): `user_id, date, payload jsonb, generated_at` — unique on `(user_id, date)`.
3. `weekly_reports` (Bundle D): `user_id, iso_week, payload jsonb, generated_at` — unique on `(user_id, iso_week)`.
4. `sleep_sessions` (Bundle E): `user_id, source, start, end, total_min, deep_min, rem_min, source_record_id` — unique on `(user_id, source, source_record_id)`.
5. `user_prefs`: `+voice_preset text default 'calm_female'`, `+voice_speed numeric default 1.0`.

Every new public table gets the standard `GRANT ... TO authenticated`, `GRANT ALL TO service_role`, RLS enabled, owner-only policies.

### Effort estimate (rough, in agent turns/sessions)

- Bundle A: small-medium. ~1 focused session.
- Bundle B: medium. ~1–2 sessions (migration + UI).
- Bundle C: large. ~2–3 sessions (insights schema, fn, three UI surfaces, coach memory).
- Bundle D: small. ~1 session.
- Bundle E: small. ~0.5 session (no UI).

### Risks

- **TTS cost**: gpt-4o-mini-tts streaming is cheap (≈$0.015 per 1k chars). A 1-minute briefing ≈ 900 chars ≈ <$0.02. Daily insights with Gemini-3-flash are also cheap (<$0.001 each, cached). At 1k DAU, ~$50–150/mo combined — fine. Mitigations already in plan: cache insights table, cache voice files keyed by `(text+voice+speed)`.
- **iOS Safari autoplay**: AudioContext must resume inside the click handler — already accounted for in the player component.
- **Cache staleness**: shift edits should invalidate the user's `daily_insights` row for affected dates. Add a DB trigger on `shifts` insert/update/delete.
- **Multi-job migration breaking Playbooks**: tested-but-easy regression — `replaceAllShifts` must scope by `job_id`, otherwise generating a playbook wipes the other job. Plan handles this.
- **Hallucinated medical specifics in insights**: keep system prompt strict ("no dosages, no diagnosis, lifestyle only"), surface DISCLAIMER on every AI-derived card.
- **Coach context bloat**: cap injected context to ~2k tokens (last 20 turns + summarized stats), not raw history.

### Cost considerations

- All AI calls route through Lovable AI Gateway with the existing `LOVABLE_API_KEY` — no new vendor keys.
- ElevenLabs is *not* recommended for v2 (more natural but adds a connector + ~10× the per-character cost). Revisit only if users report `gpt-4o-mini-tts` still sounds robotic after the rewriter polish.
- Wearables integrations later will cost: Fitbit/Oura/WHOOP/Garmin = OAuth apps (free dev tiers); Apple Health/Google Fit = native wrapper (Capacitor build, dev account fees) — out of scope here.

### Bundling opportunities (where shared work compounds)

- The **insights pipeline** (Bundle C) is the single largest reuse point: dashboard, fatigue badge, recovery planner, plan caffeine/nap times, and coach memory all read from one cached JSON. Build it once.
- The **TTS infrastructure** (Bundle A) is reused later for: weekly report read-aloud, coach "speak this reply" button, partner-mode shared briefing — build the player as a reusable component from day one.
- The **voice rewriter** (`expandAbbreviations`) is reused by every spoken surface and the coach when the user asks it to "say this aloud".
- The **jobs table** (Bundle B) feeds context into insights, coach, plan, swap, and playbooks — landing it before Bundle C avoids reworking C's prompts.

### My recommendation for the first slice

Ship Bundle A first (immediate user-perceivable upgrade, zero schema risk), then Bundle B (unlocks AI context), then Bundle C (the big "alive" dashboard). D and E come after when you're ready.

Tell me which bundle(s) to start with and I'll write the next, smaller per-bundle PLAN REQUEST with exact migrations and code before touching anything.