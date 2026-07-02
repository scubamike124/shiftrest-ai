# Version 1 Launch Completion — Investigation & Plan

Investigation-first. No code changes until you approve. Smart Alarm stays in Phase 2 and will not be touched.

---

## Phase 1 — Account & Trial

### Bug 1: Post-verification state is stale
**Reproduced path.** User clicks the branded verify link → `/auth/callback` runs `verifyOtp({ token_hash, type })` → on success does `window.location.assign("/dashboard")`.

**Root causes (two, both required):**
1. `/auth/callback` calls `verifyOtp` but never explicitly re-hydrates the session before navigating. On some iOS PWA/Safari cases the new access token is written to storage after the assign fires, so the destination page boots with the pre-verify session (or none) and `useSession` falls back to the stale one.
2. Trial/verification chrome (banner, paywall gating, "verify your email" prompts) reads `email_confirmed_at` from cached React Query data (`profiles`, `subscriptions`) that we never invalidate on `USER_UPDATED` / `SIGNED_IN`. The root `onAuthStateChange` in `__root.tsx` invalidates `shifts/prefs/employers/coach-history` on sign-in but not `profile` / `subscription` / `entitlements`, so screens keep showing "trial — please verify".

**Fix (Phase 1 approved scope):**
- In `/auth/callback`: after `verifyOtp` resolves, `await supabase.auth.getUser()` (revalidates with Auth server), then `await supabase.auth.refreshSession()`, then navigate. Use TanStack `navigate({ to, replace: true })` instead of `window.location.assign` so the QueryClient stays warm and the router picks up new context.
- In `__root.tsx` auth bootstrap: on `SIGNED_IN` / `USER_UPDATED`, additionally `invalidateQueries` for `["profile"]`, `["subscription"]`, `["entitlements"]`, `["trial-status"]`.
- Add a single `useUser()` / `useProfile()` selector that reads `email_confirmed_at` from live session, not a stale profile row, so verify banners disappear the instant the token updates.

### Bug 2: "Additional QA bug" — investigation target
The request references a second QA bug without a repro. Investigation deliverable: I will scan the last 48h of runtime errors, network 4xx/5xx, and the QA harness output, and come back with the reproducer + root cause before writing any code. If nothing surfaces, I'll flag it and ask you to describe the symptom before proceeding.

### Audit checklist (report only, no code)
Auth session hydration, trial countdown source of truth, Stripe subscription status webhook → cache path, `profiles` refresh on OAuth vs email, onboarding-complete flag persistence, sign-out cache teardown parity. Deliver as a short table with pass/fix rows.

---

## Phase 2 — AI Companion Polish (no talking avatar)

- Generate one premium AI portrait asset (`imagegen` premium tier, transparent PNG) and wire it into `GreetingHeader` (Home) and `pilot.tsx` hero. Reuse existing `OrbBadge` for state; portrait sits behind the orb with a soft aurora glow.
- Elevate Companion on Home: promote `CompanionHero` above the fold, enlarge portrait, add idle breathing animation (CSS `@keyframes`, respects `prefers-reduced-motion`), pulse glow when a fresh brief is available, speaking-indicator ring reused from `SpeakingIndicator.tsx`.
- Greeting quality: extend `resolveHero` signals to include next shift (from `shifts`), last night's sleep summary (from `wearable_readings` or manual entry), recovery score, and last conversation topic (from `coach_messages`). Compose greeting server-side in `/api/brief` so it's cache-friendly and voice-ready.
- Conversation quality: raise system prompt to include shift + sleep + recovery context; add persona presets (Calm Coach, Direct Ops, Warm Friend, Analytical) mapped to voice defaults.
- Voice UX: in `VoiceSettings`, group by persona, keep the "★ Current" pin, add inline 3-second preview using the existing `/api/tts` route.

Explicit non-goal: no animated talking avatar, no Simli/D-ID work.

---

## Phase 3 — Wearable Integration (Fitbit + Oura)

Existing scaffolding: `src/lib/wearables/{fitbit,oura}.server.ts`, OAuth callbacks under `src/routes/api/public/wearables/{fitbit,oura}/callback.ts`, `wearable_connections` and `wearable_readings` tables.

Investigation deliverable before code:
- Confirm Fitbit + Oura OAuth apps exist and secrets are set (`FITBIT_CLIENT_ID/SECRET`, `OURA_CLIENT_ID/SECRET`); if not, list what you need to create in each provider console.
- Verify token refresh paths and cron sync (`api/public/wearables/cron.ts`) actually pull sleep sessions.

Implementation:
- Normalize both providers into `wearable_readings` with fields: sleep duration, bedtime, wake time, HRV, resting HR, provider sleep score.
- `/health` "Connections" card: Connected state, Last synced timestamp, Sync now button (triggers a serverFn that calls the provider sync). Disconnect stays.
- Feed the latest reading into the Companion brief context (Phase 2 above) and `/api/insights`.

Out of scope: Apple Health, Garmin, Whoop (remain hidden by `HIDE_PLANNED_PROVIDERS_ON_HEALTH`).

---

## Phase 4 — Health Dashboard Expansion

Extend `/health` with a Trends section pulling from `wearable_readings` + manual sleep logs:
- 7/30-day charts: sleep duration, consistency (bedtime std-dev), recovery, sleep debt (target − actual, rolling 7d), HRV, resting HR.
- Weekly summary card with delta vs previous week.
- Use `recharts` (already installed) with theme tokens; empty states when no wearable connected point to the connections card.

---

## Phase 5 — Notifications

Existing: `src/lib/notifications/{schedule,run.server,client,copy}.ts`, VAPID push wired via `src/lib/push/*`, pg_cron dispatcher.

Investigation: enumerate which of the five notification types are already scheduled vs missing, and where each triggers from (client `scheduleNextWindDown` vs server cron).

Deliver all five as server-scheduled push (survives app close, unlike client `setTimeout`):
- Morning Brief — 45 min before shift start or 07:30 default.
- Evening Wind-down — 60 min before target bedtime.
- Bedtime reminder — at target bedtime.
- Recovery reminder — after a low-recovery night, mid-morning.
- Shift countdown — 2h before shift.

Each type honors quiet hours + per-type toggles in `notification_prefs`. Logged to `notification_log` for dedupe.

---

## Smart Alarm
Untouched. `SMART_ALARM_ENABLED` stays `false`. No files in `src/lib/alarm/*`, `src/components/SmartAlarmCard.tsx`, or `dispatch-alarms.ts` will be edited this phase.

---

## Execution Order

Batched to keep each ship reviewable:
1. **Batch A — Auth refresh fix + QA bug repro/fix.** Small, unblocks trust in signup.
2. **Batch B — Companion visual polish (portrait, glow, home layout).** Design-only, no data changes.
3. **Batch C — Companion brief context + persona/voice UX.**
4. **Batch D — Wearables (Fitbit + Oura end-to-end).**
5. **Batch E — Health dashboard trends.**
6. **Batch F — Notifications (five types, server-scheduled).**

Each batch: implement → typecheck → security scan → publish → your on-device verify → next batch.

## Technical Notes

- Router: keep `_authenticated` gate untouched; verification callback stays public.
- Auth cache invalidation must filter on `SIGNED_IN` / `USER_UPDATED` / `SIGNED_OUT` only (not `TOKEN_REFRESHED`) to avoid the 401 storm noted in project guidance.
- Wearable serverFns require `requireSupabaseAuth`; cron sync uses `CRON_SECRET` header (already wired).
- Notification cron reuses existing pg_cron infra; do not create new cron jobs manually — extend the existing dispatcher.
- All new tables/columns follow the GRANT + RLS ordering rule.

Approve to proceed with **Batch A** only, or tell me which batches to reorder / drop.