
# Wearable Sync v1 — Fitbit + Oura

## Scope decision

Web app, no native wrapper yet. That rules out:
- **Apple Health** — iOS-only, requires native HealthKit bridge.
- **Google Fit REST API** — deprecated by Google, shutting down 2026; replacement (Health Connect) is Android-native only.

So v1 ships the two providers that are fully web-OAuth, cover sleep + HRV + resting HR, and are the most-used by shift workers:
- **Fitbit** (OAuth 2.0 PKCE, free dev tier, Sleep + Heart Rate Variability + Resting HR scopes)
- **Oura Ring** (OAuth 2.0, Personal API v2, sleep / readiness / HRV / RHR)

Apple Health + Whoop are left for the native phase (separate plan once we wrap with Capacitor).

## What the user sees

1. **Profile → Connected devices** card replaces the current "Coming soon" pill.
2. Two buttons: **Connect Fitbit**, **Connect Oura**. Tapping opens the provider's OAuth consent page; on return the card shows *Connected · last synced 2m ago* with a **Disconnect** and **Sync now** button.
3. **Dashboard** gains a small "Last night" strip below the AI brief: Sleep duration, Sleep efficiency, HRV, Resting HR — pulled from whichever device synced most recently.
4. **Fatigue engine** (`src/lib/insights.ts`) now consumes real sleep instead of estimated-from-shift sleep when a wearable reading exists for that night; otherwise falls back to the current estimator. The Plan and Coach screens automatically reflect the better data.

## Technical design

### Database
New migration:
```sql
CREATE TABLE public.wearable_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider IN ('fitbit','oura')),
  access_token text NOT NULL,        -- encrypted at rest by Supabase
  refresh_token text,
  expires_at timestamptz,
  provider_user_id text,
  scope text,
  last_sync_at timestamptz,
  last_sync_error text,
  created_at timestamptz DEFAULT now(),
  UNIQUE (user_id, provider)
);

CREATE TABLE public.wearable_readings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider text NOT NULL,
  date date NOT NULL,                -- the "night of" date
  sleep_start timestamptz,
  sleep_end timestamptz,
  sleep_duration_min int,
  sleep_efficiency numeric,          -- 0..1
  deep_min int, rem_min int, light_min int,
  hrv_ms numeric,
  resting_hr int,
  raw jsonb,
  fetched_at timestamptz DEFAULT now(),
  UNIQUE (user_id, provider, date)
);
```
Both tables get the standard GRANT block + RLS scoped to `auth.uid()` (SELECT/INSERT/UPDATE/DELETE own rows). `service_role` ALL for the sync worker.

### Server routes (public, signature-verified callbacks)
- `GET  /api/public/wearables/fitbit/callback` — exchanges code → tokens, upserts row, redirects back to `/profile?connected=fitbit`.
- `GET  /api/public/wearables/oura/callback`   — same shape for Oura.
- `POST /api/public/wearables/cron`            — pg_cron-triggered nightly sync; auth via `CRON_SECRET` header.

### Server functions (auth-gated)
- `startWearableOAuth({ provider })` — returns the provider auth URL with PKCE/state stored in `sessionStorage`.
- `disconnectWearable({ provider })` — deletes the connection row.
- `syncWearableNow({ provider })` — manual pull for the signed-in user.
- `getWearableSummary()` — returns the most recent reading + connection statuses for the dashboard.

### Token & refresh handling
Each provider client lives in `src/lib/wearables/{fitbit,oura}.server.ts`: `exchangeCode`, `refreshIfExpired`, `fetchLastNight`. Tokens are refreshed automatically inside `syncWearableNow` and the cron handler.

### Secrets to add (via add_secret, after plan approval)
- `FITBIT_CLIENT_ID`, `FITBIT_CLIENT_SECRET`
- `OURA_CLIENT_ID`, `OURA_CLIENT_SECRET`
- `CRON_SECRET` (generated)

User has to register the OAuth apps in each provider's developer portal and paste the IDs — I'll walk them through it when we get there. Redirect URIs use the stable `project--{id}.lovable.app` URL.

### Fatigue engine integration
`src/lib/insights.ts` gets a new helper `getActualSleep(userId, date)` that prefers `wearable_readings.sleep_duration_min` and falls back to the current shift-based estimate. The existing recovery score formula is unchanged — it just receives better inputs. AI coach context (`src/routes/api/coach.ts` and `src/lib/insights.ts`) gains a "Last night from your Fitbit/Oura: 6h 12m, HRV 38ms" line so the assistant can reference real numbers.

## Files to create
- `supabase/migrations/<ts>_wearables.sql`
- `src/lib/wearables/types.ts`
- `src/lib/wearables/fitbit.server.ts`
- `src/lib/wearables/oura.server.ts`
- `src/lib/wearables/wearables.functions.ts`
- `src/routes/api/public/wearables/fitbit/callback.ts`
- `src/routes/api/public/wearables/oura/callback.ts`
- `src/routes/api/public/wearables/cron.ts`
- `src/components/WearableCard.tsx` (Profile section)
- `src/components/LastNightStrip.tsx` (Dashboard widget)

## Files to edit
- `src/routes/profile.tsx` — replace "Coming soon" block with `<WearableCard />`.
- `src/routes/index.tsx` — render `<LastNightStrip />` under the AI brief.
- `src/lib/insights.ts` — wire `getActualSleep` into the recovery calc.
- `src/routes/api/coach.ts` — include last-night wearable data in the system prompt.

## Test plan (will be run before marking complete)
1. Connect Fitbit on the published site → callback returns, card shows Connected.
2. Disconnect → row removed, card resets.
3. Connect Oura → same flow.
4. **Sync now** → reading row inserted, dashboard strip shows numbers within 5s.
5. Refresh page → values persist.
6. Force token expiry (set `expires_at` to past) → next sync refreshes successfully.
7. AI coach asked "How did I sleep?" → references the wearable number, not an estimate.
8. Sign out / sign in as different user → no cross-user data leakage (RLS).
9. Mobile viewport 375×812 → card, buttons, strip all readable and tappable.
10. Disconnect both providers → dashboard strip falls back to shift-based estimate without error.

## Risks
- **OAuth app approval**: Fitbit's "personal" tier works immediately for the dev; production sharing with end users needs Fitbit's app review (free but ~1–2 weeks). Oura's Personal v2 is instant.
- **Rate limits**: Fitbit 150 req/hr per user, Oura 5000/day per app. Nightly cron + manual sync stays well under.
- **Token storage**: tokens are at rest in Postgres. RLS prevents cross-user reads; service role only used inside server functions. Acceptable for v1; can move to Supabase Vault later if needed.
- **No Apple Health users on web**: messaging on the card will say "Apple Health & Whoop coming with the iOS app" so iPhone users aren't confused.

## Out of scope for this plan
- Apple Health / HealthKit (needs native).
- Whoop (deferred — small user base, can add later via same pattern).
- Backfilling more than last 7 nights on first connect.
- Showing weekly trend charts of HRV/RHR (UI polish phase).

---

Approve and I'll start with the migration, then provider clients, OAuth callbacks, sync, UI, and finally engine integration — tested end-to-end on the published site before marking complete.
