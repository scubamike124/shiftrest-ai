# Version 1 Launch Completion — Batches A → D

Investigation-first. No code changes until you approve each batch. Smart Alarm, Apple Health, Garmin, Whoop, Samsung Health, Google Fit, smart-home, and animated avatars are out of scope for every batch below.

---

## Batch A — Account & Authentication

### What already shipped (last turn)
- `/auth/callback` now awaits `verifyOtp` → `getUser()` → `refreshSession()` before router-navigating with `replace: true`, and invalidates `subscription-state`, `prefs`, `employers` on success.
- `__root` sign-in bootstrap also invalidates `subscription-state`.

### Investigation findings
- Only **one** cache key drives trial/billing chrome: `["subscription-state"]` (read in `profile.tsx`, `paywall.tsx`, elsewhere via `src/lib/subscription.ts`). Good — one invalidation covers everything.
- Onboarding completion is stored server-side in `user_prefs.flags.onboarding_ack` (see `Onboarding.tsx`), with `localStorage` fallback for logged-out users. `migrateLocalPrefsIfNeeded` runs on sign-in — safe.
- `useSession` refreshes on every `onAuthStateChange`, so the session is authoritative.
- `email_confirmed_at` is not read anywhere in app code (searched — zero hits). Verified-vs-unverified UI is driven entirely by `subscription-state` and Supabase's own `session.user.email_confirmed_at` via the SDK. That means the callback fix already covers the reported bug **on the tab that clicked the link**.
- **Cross-tab gap** (still needs a fix): if a user verifies in one tab while another tab holds the pre-verify session, the second tab won't refresh until the token rolls. Supabase emits `USER_UPDATED` on the verifying tab but the other tab only sees `TOKEN_REFRESHED` later. Low-frequency, but worth a small storage listener in `__root`.

### Work items
1. **QA pass** (manual, no code) against the 9-step flow in your request; report a pass/fail table. Any reproducible failure gets a targeted fix — no speculative changes.
2. **Cross-tab session sync**: add a `window.addEventListener("storage", …)` in `__root` that watches the Supabase auth storage key and calls `queryClient.invalidateQueries({ queryKey: ["subscription-state"] })` when it changes. ~10 lines.
3. **`/verify-again` polish**: if the `/auth/callback` handler lands with an expired link, offer a "Resend verification email" button that calls `supabase.auth.resend({ type: "signup", email })`. Currently we only tell the user the link is expired.
4. **Sign-out hygiene audit**: confirm sign-out order is `cancelQueries → clear → signOut → navigate("/auth", replace)`; add whatever is missing.

Explicit non-goals: no schema changes, no new tables, no new auth providers.

---

## Batch B — AI Companion Polish (no talking avatar)

### Investigation findings
- `CompanionHero` already exists on Home and honors freshness/quiet/offline. It uses `OrbBadge` as the visual — no portrait.
- `pilot.tsx` (670 LOC) has a hero section but no premium portrait.
- Greeting composition (`resolveHero`) uses time-of-day + brief-period only. It has hooks for name and quiet hours but nothing about the actual shift, sleep, or recovery.
- Persona presets exist in `AssistantSettings.tsx` (9 personas, F-1). Voice selection UX was polished (F-2). Both are functional but the persona doesn't feed the greeting or system prompt.

### Work items
1. **Portrait asset**: generate one premium AI portrait (`imagegen` premium tier, transparent PNG, warm aurora vibe matching the design). Place at `src/assets/companion/portrait-hero.png`.
2. **Home**: promote `CompanionHero` above `RightNowCard`, enlarge the visual to portrait + orb overlay, add:
   - Idle breathing scale animation (~4s, `prefers-reduced-motion` safe).
   - Ambient glow that intensifies when a fresh brief is available.
   - Speaking indicator ring bound to the existing `companion:speaking` event.
3. **Pilot**: same portrait as the Pilot hero, replacing the plain title block.
4. **Smarter greeting**: extend `resolveHero` (or add a `composeGreetingContext` helper) to fold in:
   - Next shift start/end (from `shifts`).
   - Last night's sleep (from `wearable_readings` if present, else manual entry).
   - Recovery score (derived from HRV/RHR in wearable data — falls back gracefully).
   - Last conversation topic (from `coach_messages` most-recent row).
   - Do the actual sentence composition server-side in `/api/brief` so Pilot voice reads the same string.
5. **Persona wiring**: pass persona into `/api/coach` and `/api/brief` system prompt (tone/vocab shift).
6. **Voice UX**: add inline 3-second preview button per voice in `VoiceSettings.tsx` using `/api/tts`.

Non-goals: no talking avatar, no Simli/D-ID, no 3D model changes.

---

## Batch C — Wearable Integrations (Fitbit + Oura)

### Investigation findings
- Server layer already exists: `src/lib/wearables/{fitbit,oura,sync}.server.ts`, `wearables.functions.ts`.
- OAuth callbacks exist: `src/routes/api/public/wearables/{fitbit,oura}/callback.ts`.
- Cron sync exists: `src/routes/api/public/wearables/cron.ts`.
- Tables `wearable_connections` (12 cols) and `wearable_readings` (15 cols) exist with RLS.
- **Unknown until you confirm**: whether developer OAuth apps and secrets are actually provisioned. There is no `FITBIT_CLIENT_ID` / `OURA_CLIENT_ID` in the fetched secrets list.

### What you need to provide before code work
This is the "developer keys" list you asked me to document up front:

**Fitbit** (`dev.fitbit.com`):
- Create an app: OAuth 2.0 Application Type = **Server**, Callback URL = `https://restpilotai.com/api/public/wearables/fitbit/callback` (and `https://project--8243527a-2b83-4fe2-aa6d-60b0ae194313.lovable.app/api/public/wearables/fitbit/callback` for preview).
- Scopes: `sleep heartrate profile`.
- Give me the **Client ID** and **Client Secret** → I'll store as `FITBIT_CLIENT_ID` (secret) and `FITBIT_CLIENT_SECRET`.

**Oura** (`cloud.ouraring.com/oauth/applications`):
- Create an app with redirect URI = `https://restpilotai.com/api/public/wearables/oura/callback` (+ preview URL).
- Scopes: `daily heartrate personal session sleep`.
- Give me **Client ID** and **Client Secret** → stored as `OURA_CLIENT_ID` and `OURA_CLIENT_SECRET`.

### Work items (once keys are in)
1. Verify `fitbit.server.ts` / `oura.server.ts` token exchange + refresh work end-to-end.
2. Normalize both providers into `wearable_readings`: `sleep_duration_min`, `bedtime`, `wake_time`, `hrv_ms`, `resting_hr`, `sleep_score`.
3. `/health` "Connections" panel: **Connect / Disconnect**, **Connected badge**, **Last synced timestamp**, **Sync now** button (calls a `requireSupabaseAuth` serverFn).
4. Feed the latest reading into the Companion greeting/brief context from Batch B.
5. Cron: confirm the existing dispatcher hits both providers; keep it hourly.

Non-goals for this batch: Apple Health, Garmin, Whoop, Samsung, Google Fit (stay hidden via `HIDE_PLANNED_PROVIDERS_ON_HEALTH`).

---

## Batch D — Health Dashboard + Notifications

### Health dashboard
Extend `/health` with a **Trends** section reading `wearable_readings`:
- 7-day and 30-day charts (`recharts`, already installed, theme tokens): sleep duration, consistency (bedtime std-dev), recovery, sleep debt (target − actual rolling 7d), HRV, resting HR.
- Weekly summary card with delta vs previous week.
- Empty states link back to the Connections card in Batch C.

### Notifications
Existing: `src/lib/notifications/*`, VAPID push, pg_cron. Investigation shows wind-down runs client-side (`scheduleNextWindDown`), which won't fire when the tab is closed.

Deliver all five as **server-scheduled push** (survives app close):
- Morning Brief — 45 min before shift start, or 07:30 default.
- Evening Wind-down — 60 min before target bedtime.
- Bedtime reminder — at target bedtime.
- Recovery reminder — after a low-recovery night, mid-morning.
- Shift countdown — 2h before shift.

Each honors `notification_prefs` per-type toggles + quiet hours; dedupes via `notification_log`. Reuses the existing pg_cron dispatcher — no new cron jobs.

---

## Execution Order

1. **Batch A** — QA pass + cross-tab sync + resend button + sign-out audit.
2. **Batch B** — Companion portrait + Home/Pilot polish + smarter greeting + persona wiring + voice preview.
3. **Batch C** — Fitbit + Oura end-to-end (needs your provider keys first).
4. **Batch D** — Health trends + five server-scheduled notifications.

Each batch: implement → typecheck → security scan → publish → your on-device verify → next batch.

## Technical Notes

- Only cache key driving trial/verify state today is `["subscription-state"]`; keep it that way.
- `_authenticated` gate is integration-managed — don't touch.
- All new columns follow the CREATE → GRANT → RLS → POLICY ordering rule.
- Notification cron reuses the existing dispatcher; no new pg_cron jobs.
- Smart Alarm remains gated by `SMART_ALARM_ENABLED = false`.

Reply **"go A"**, **"go B"**, etc. — or send Fitbit/Oura keys and I'll queue Batch C next.