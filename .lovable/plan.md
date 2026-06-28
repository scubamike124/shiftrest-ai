# Slice 12 — Companion Skills & Integrations (Investigation + Plan)

This is an **investigation-only** plan. Nothing ships until you approve. The objective is to evolve the Companion from "tells you things" to "does things for you" — without breaking the safety, privacy, a11y, quiet-hours, offline, analytics, and Action History contracts established in Slices 8–11.

---

## 1. Architecture review (what's already in place)

The good news: the foundation we built in Slices 8–10 is the right shape for everything in Slice 12.

- **Typed action registry** — `src/lib/companion/actions.ts` already defines a discriminated `CompanionAction` union with `describeAction`, `executeAction(ctx)`, `isDestructive`, and a runtime `ALLOWED_OPEN_ROUTES` allow-list. Every new skill = new variants in this union + new cases in those three functions. No parallel system.
- **Confirmation UX** — `ActionCard.tsx` already renders Approve / Reject, supports `destructive`, `unavailable`, and recovery CTAs.
- **History + retry** — `action-history.ts` records every attempt (queued / executing / completed / failed) per device.
- **Narration** — `narration.ts` produces TTS-friendly outcome strings, routed through `speak.ts` which honors quiet hours, mute, and cancel-prior policy.
- **Analytics** — `analytics.ts` emits `action_started` / `action_completed` etc.; we just add new event variants.
- **Offline + auth gates** — `executeAction` already short-circuits with `offline`, `unauthenticated`, `unavailable` error kinds. We reuse this exact pattern.
- **Memory** — `ai_memory` + `ai_memory_proposals` + `/memory` already implement permission-based memory with explicit Approve/Reject, pinning, importance, deletion, and a pause/resume control.

What's missing for Slice 12: **per-skill capability providers** (smart-home, calendar, travel, comms, weather), a way to detect/configure which are connected, and a small expansion of the memory-proposal pipeline so it can propose **routines** (multi-step) and not just single facts.

---

## 2. Files impacted

### New files (skill providers + UI)

```text
src/lib/companion/skills/
  registry.ts                 // capability discovery + feature flags
  smart-home/
    index.ts                  // typed actions + executor
    providers/
      homeassistant.ts        // HA REST API client (server-only)
      stub.ts                 // safe no-op until user connects HA
  calendar/
    index.ts                  // create/move/delete event actions
    google.functions.ts       // server fns (Google Calendar via OAuth)
    ics.ts                    // read-only ICS feed fallback
  travel/
    index.ts                  // flight/hotel/trip actions
    flight.functions.ts       // AeroDataBox/AviationStack via connector
    traffic.ts                // reuse Open-Meteo + existing /commute baseline
  comms/
    index.ts                  // draft/send email + SMS + call actions
    email.functions.ts        // Lovable Emails (drafts only by default)
    sms.functions.ts          // Twilio via connector (send = destructive)
  weather/
    alerts.ts                 // rain/heat/wind/AQ thresholds + clothing
    alerts.functions.ts       // server fn calling Open-Meteo air-quality
src/components/companion/skills/
  ConnectSkillCard.tsx        // "Connect Google Calendar" etc.
  AgendaCard.tsx              // today's agenda inline in chat
  WeatherAlertCard.tsx        // rain/heat/AQ warning chip
  TripCountdownCard.tsx
src/routes/settings.skills.tsx // central on/off + connection mgmt
```

### Modified

- `src/lib/companion/actions.ts` — extend `CompanionAction` union with new kinds; mark every destructive/security-sensitive one in `isDestructive`; route execution to the new skill modules.
- `src/lib/companion/narration.ts` — add cases for new action kinds.
- `src/lib/companion/analytics.ts` — add `skill_invoked`, `skill_connect_started`, `skill_connect_completed`.
- `src/lib/companion/action-history.ts` — no schema change; new kinds inherit automatically.
- `src/routes/api/ai.ts` — extend system prompt with the new tool catalog so the LLM proposes the right actions.
- `src/routes/companion.tsx` — render new inline cards (Agenda, Weather Alert, Trip Countdown) when assistant emits them.
- `src/routes/settings.companion.tsx` — link out to `/settings/skills`.
- `src/lib/ai/memory-proposer.server.ts` — extend to propose multi-step **routines** (e.g. "every weekday 22:00 → lights dim + thermostat 68 + wind-down"), still gated by Approve/Reject.
- `src/lib/companion/quiet-hours.ts` — used as-is; new skills must call `inQuietHours()` before any audible side effect.

### Database (one migration)

```sql
-- Per-user skill connections (OAuth tokens / config)
create table public.companion_skills(
  user_id uuid not null references auth.users(id) on delete cascade,
  skill text not null,              -- 'google_calendar' | 'homeassistant' | 'twilio' | ...
  status text not null default 'connected',
  config jsonb not null default '{}'::jsonb,
  secrets_ref text,                 -- name of vault secret, never the raw token
  connected_at timestamptz not null default now(),
  primary key (user_id, skill)
);
grant select, insert, update, delete on public.companion_skills to authenticated;
grant all on public.companion_skills to service_role;
alter table public.companion_skills enable row level security;
create policy "own skills" on public.companion_skills
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Learned routines (Slice 12 memory expansion). One row per proposed/approved routine.
create table public.companion_routines(
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  trigger jsonb not null,           -- {kind:'time', at:'22:00', days:[1..5]} | {kind:'event', ...}
  steps jsonb not null,             -- [{action:'play_track', ...}, ...]
  status text not null default 'proposed', -- proposed | active | paused
  reason text,                      -- "I noticed you start wind-down at ~22:00 on weekdays"
  approved_at timestamptz,
  created_at timestamptz not null default now()
);
grant select, insert, update, delete on public.companion_routines to authenticated;
grant all on public.companion_routines to service_role;
alter table public.companion_routines enable row level security;
create policy "own routines" on public.companion_routines
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
```

---

## 3. New APIs / services

| Skill | Integration | Auth model | Notes |
| --- | --- | --- | --- |
| Smart Home | Home Assistant REST (`/api/services/<domain>/<service>`) | Per-user long-lived token, stored in Lovable secret per user (`HA_TOKEN_<uid-hash>`) | Stub provider ships first; HA optional. Future: Matter via native shell. |
| Calendar (read+write) | Google Calendar via standard connector OR per-user OAuth | Per-user OAuth (each user grants own calendar) | The workspace Google Calendar connector is dev-only; production requires per-user OAuth. ICS read-only fallback works with zero setup. |
| Travel — flights | AeroDataBox or AviationStack via API key | App-level secret (`FLIGHTS_API_KEY`) | Read-only; no destructive ops. |
| Travel — traffic | Open-Meteo + existing commute baseline | No key | Already in repo. |
| Comms — email | Lovable Emails (built-in) | None new | Drafts only by default; **Send** is destructive. |
| Comms — SMS / Calls | Twilio standard connector | App-level | Send/call are destructive; numbers must be user-verified. |
| Weather alerts | Open-Meteo Air-Quality + Forecast | No key | Pure server fn; no new dependency. |

We will **not** add any direct provider SDKs to client code. Every external call is wrapped in a `createServerFn`/server route, secrets stay server-side.

---

## 4. Security considerations

- **Destructive set expands**: `delete_calendar_event`, `send_email`, `send_sms`, `place_call`, `unlock_door`, `open_garage`, `set_thermostat` (when delta > 4°), `tv_power_off`. Every one returns `true` from `isDestructive` and forces the ActionCard confirmation even if "Always Confirm" is off.
- **Allow-list pattern reused** for every external surface: route allow-list (already in `actions.ts`), HA entity allow-list per user, recipient allow-list for SMS/calls (only numbers the user has saved + verified), domain allow-list for email "from".
- **Webhook & token storage**: OAuth tokens and HA tokens are stored via `add_secret` (per-user named secret), never in the database in plain text; the DB only stores a `secrets_ref` name.
- **Voice spoofing**: no skill executes from voice alone — voice → text → `ActionCard` → tap Confirm. We never auto-execute voice intents for destructive actions.
- **Rate limiting** per skill per user (in `executeAction` wrapper) to prevent runaway loops (e.g. AI proposing 30 SMS sends).
- **Audit trail**: every destructive action additionally writes to `ai_log` with `intent='companion_action'` and the redacted payload (recipient, subject hash — not message body).
- **Input validation**: Zod schemas on every server fn (phone E.164, email RFC, HA entity IDs `^[a-z_]+\.[a-z0-9_]+$`).

---

## 5. Privacy implications

- **Memory remains opt-in.** No skill auto-enables memory. Skill usage is logged to Action History (device-local) but only contributes a memory **proposal** if the user has memory ON.
- **Routine learning** writes to `companion_routines` with `status='proposed'` only. Nothing runs until the user taps Approve in `/memory` (new "Routines" tab).
- **Each suggestion shows "why"** — we already have `WhyButton` in `src/components/ai/trust/`. Routine cards reuse it.
- **One-tap edit/delete** on every routine and learned fact.
- **Data minimization**: travel/flight queries send only the flight number; email drafts never leave the device until the user taps Send; SMS bodies are not logged.
- **Quiet hours** apply to: any TTS narration, any push notification a skill might fire (weather alerts especially), and any non-emergency smart-home action that produces audible/visible effect (TV on). They do **not** block safety-relevant alerts (smoke, severe-weather) — though we ship none of those in Slice 12.

---

## 6. Rollback strategy

The whole slice is behind a single feature flag `companion.skills.v1` resolved from `user_prefs.feature_flags` (already JSONB). Default off in prod.

- Per-skill kill-switches in `companion_skills.status` (`disabled`) — disables the action variants from being proposed and executed without code changes.
- Database migration is additive (two new tables, no alters). Rollback = `drop table` if needed, no data loss elsewhere.
- New action kinds are additive on the union; old clients fall through to a "coming soon" branch (already supported in `describeAction`).
- The legacy `intentToAction` voice-router path is unchanged, so existing voice commands keep working if we revert the chat layer.

---

## 7. Recommended implementation order

Each step is independently shippable, typecheck-clean, and behind the feature flag.

1. **Foundation** — feature flag, `companion_skills` + `companion_routines` migration, `skills/registry.ts`, `/settings/skills` stub, analytics events.
2. **Weather Intelligence** — pure server fn, no external auth, lowest risk. Adds `WeatherAlertCard` + clothing suggestion. Proves the cards pipeline.
3. **Calendar Intelligence (read)** — ICS feed read-only + today's agenda card. No OAuth yet.
4. **Calendar Intelligence (write)** — Google OAuth per user; create/move/delete events. Delete is destructive.
5. **Travel Intelligence** — flight status + trip countdown + traffic-before-appointments. Read-only.
6. **Smart Home (HA)** — connection flow + entity picker + lights/fans/thermostat/TV. Locks/garage gated behind extra "Sensitive devices" toggle defaulting OFF.
7. **Communication Actions** — email/SMS drafts first; send + call gated by "Always Confirm" override AND per-action confirmation.
8. **Memory Expansion — Routines** — extend `memory-proposer.server.ts` to surface multi-step routine proposals, wire `/memory` Routines tab, scheduler that runs approved routines (reuses existing pg_cron + notify pipeline).
9. **Polish & QA** — a11y sweep, offline behavior verification for each skill, narration cases, history retry coverage, Playwright happy-path per skill, docs update under `docs/launch/`.

---

## 8. Risk assessment

| Risk | Likelihood | Mitigation |
| --- | --- | --- |
| Per-user OAuth (Google Calendar) needs developer setup users may not finish | Medium | Ship ICS read-only fallback; show clear "Connect" CTA but never block other skills. |
| Home Assistant tokens leak via client bundle | Low | All HA calls go through server fns; token stored per-user in vault secret; never echoed in narration or logs. |
| LLM proposes destructive action with wrong params (wrong recipient) | Medium | Every destructive action shows full payload preview in ActionCard before Confirm; recipient allow-list for SMS/email; max-1 destructive per turn. |
| Routine auto-runs cause user confusion | Medium | Routines only fire after explicit Approve; first 3 runs send a "Routine ran" notification with one-tap Pause. |
| Skill catalog bloats LLM context | Medium | `skills/registry.ts` only exposes connected skills' tools in the system prompt; not the full catalog. |
| Twilio costs runaway | Low | Rate limit (5 sends / user / day default), and Twilio not enabled unless user connects it. |

---

## 9. Deliverables checklist (when approved)

- TypeScript clean (`tsgo`).
- New migration applied with GRANTs + RLS verified.
- Every new action: described, narrated, history-recorded, analytics-tracked, quiet-hours-respected, offline-aware.
- Every destructive action: forces confirmation, shows payload preview, writes to `ai_log`.
- A11y: 44px tap targets, `aria-live` for new cards, keyboard focus on confirm.
- Mobile: tested at 375px; bottom-sheet variants for any new modal.
- Docs: `docs/companion-skills-launch.md` with per-skill QA matrix + rollback steps.

---

**Awaiting your approval before any code changes.** Once approved, I'll start with step 1 (Foundation) and ship each step as its own typecheck-clean increment.
