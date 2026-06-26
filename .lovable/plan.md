# Phase 1 / Task 2 — Persist Preferences + Onboarding

## Investigation summary

Current localStorage keys in use:
- `shiftrest.prefs.v1` (`src/lib/prefs.ts`) — `windDownMin`, `sleepHours`, `notifications`, `lowLight`, `lat`, `lon`, `locationLabel`, `partnerName`
- `shiftrest.onboarded.v1` (`src/components/Onboarding.tsx`) — completion flag

Consumers of `loadPrefs()`: `src/routes/index.tsx`, `plan.tsx`, `swap.tsx`, `share.tsx`, `profile.tsx`, `src/lib/notify.ts`.
Writers: `src/routes/profile.tsx` (settings form + location detect), `src/components/Onboarding.tsx` (sets flag only).

No prefs table exists yet. `profiles` already has `id, display_name, email, subscription_*`.

## Recommendation: Option B — new `user_prefs` table

Reasons:
- `profiles` is identity/billing; mixing app preference fields bloats it and risks coupling subscription logic to settings writes.
- A dedicated table keeps RLS scope tight, lets us evolve the schema without touching auth-critical rows, and supports cheap "preferences last updated" tracking for migration conflict checks.
- One-to-one with auth user via `user_id` PK; trivial upsert pattern.

## Database schema

```sql
CREATE TABLE public.user_prefs (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  wind_down_min smallint NOT NULL DEFAULT 120,
  sleep_hours numeric(3,1) NOT NULL DEFAULT 8,
  notifications boolean NOT NULL DEFAULT true,
  low_light boolean NOT NULL DEFAULT true,
  lat double precision NOT NULL DEFAULT 40.7128,
  lon double precision NOT NULL DEFAULT -74.006,
  location_label text NOT NULL DEFAULT 'New York, NY',
  partner_name text NOT NULL DEFAULT '',
  onboarded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_prefs TO authenticated;
GRANT ALL ON public.user_prefs TO service_role;

ALTER TABLE public.user_prefs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users select own prefs"  ON public.user_prefs FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users insert own prefs"  ON public.user_prefs FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own prefs"  ON public.user_prefs FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users delete own prefs"  ON public.user_prefs FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE TRIGGER user_prefs_set_updated_at
  BEFORE UPDATE ON public.user_prefs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
```

Onboarding flag = `onboarded_at IS NOT NULL`. No separate table needed.

## Code plan

### `src/lib/prefs.ts` — rewrite to async, cloud-backed
- Keep `Prefs` shape + `DEFAULT_PREFS` for compatibility.
- New API:
  - `fetchPrefs()` → returns row or `DEFAULT_PREFS` (logged out / no row).
  - `savePrefs(partial)` → upsert by `auth.uid()`; no-op when logged out.
  - `markOnboarded()` → upsert `onboarded_at = now()`.
  - `isOnboarded()` → boolean from row.
  - `migrateLocalPrefsIfNeeded()` → idempotent, guarded by `localStorage` flag `shiftrest.prefs.migrated.v1`:
    1. If guard set → exit.
    2. If row exists AND `updated_at` newer than legacy save → set guard, drop legacy keys, exit (don't overwrite cloud).
    3. Else read legacy `shiftrest.prefs.v1` + `shiftrest.onboarded.v1`, upsert merged values, set guard, remove legacy keys.
- Keep a synchronous `loadPrefsSync()` returning `DEFAULT_PREFS` only — used during SSR / pre-auth render to avoid layout shift; replaced by query data once mounted.

### `src/components/Onboarding.tsx`
- Replace localStorage check with query of `user_prefs.onboarded_at`.
- On "Get started" → call `markOnboarded()` then close.
- Logged-out: show onboarding once per browser using existing localStorage flag (no auth = nothing to sync).

### `src/routes/profile.tsx`
- Replace local state seeding from `localStorage` with `useQuery(['prefs'])` → `fetchPrefs()`.
- Replace direct `localStorage.setItem` calls (lines 73, 119) with `useMutation` → `savePrefs()`, invalidate `['prefs']`.
- Keep "Delete all local data" button but also clear migration guard.

### Consumers (`index.tsx`, `plan.tsx`, `swap.tsx`, `share.tsx`, `lib/notify.ts`)
- Replace synchronous `loadPrefs()` with `useQuery(['prefs'], fetchPrefs)` in components.
- `notify.ts` already async — switch its internal `loadPrefs()` calls to `await fetchPrefs()`.

### `src/routes/__root.tsx`
- After auth state becomes `SIGNED_IN`, call `migrateLocalPrefsIfNeeded()` (alongside existing shifts migration).
- Invalidate `['prefs']` on `SIGNED_IN` / `SIGNED_OUT`.

## Files to change
1. `supabase/migrations/<ts>_user_prefs.sql` (new, via migration tool)
2. `src/lib/prefs.ts` (rewrite)
3. `src/components/Onboarding.tsx`
4. `src/routes/profile.tsx`
5. `src/routes/index.tsx`
6. `src/routes/plan.tsx`
7. `src/routes/swap.tsx`
8. `src/routes/share.tsx`
9. `src/lib/notify.ts`
10. `src/routes/__root.tsx`

## Risks
- **SSR / logged-out reads**: components must tolerate `DEFAULT_PREFS` during first render. Mitigation: `useQuery` with `initialData: DEFAULT_PREFS`.
- **Race on first login**: migration vs initial fetch. Mitigation: await migration before invalidating `['prefs']` in `__root.tsx`.
- **Overwriting newer cloud prefs**: handled by "row exists → skip migration" guard.
- **Notification scheduler** runs from `notify.ts` outside React; must read prefs via direct Supabase call, not query cache.
- **Onboarding flash** for signed-in users on slow networks: gate modal on `query.isSuccess && !onboarded_at`.

## Test checklist
1. Fresh browser, sign up → onboarding shows → complete → refresh → does not show.
2. Sign out → sign back in → onboarding still does not show.
3. Change wind-down, sleep hours, partner name in Profile → refresh → values persist.
4. Sign in on a second browser → same prefs appear.
5. Change a pref on browser B → refresh browser A → updated value present (after refetch / sign-in).
6. Log out → navigate to Plan / Index / Share → no crash; defaults render.
7. Pre-existing user with legacy localStorage prefs: sign in → values migrated to cloud, legacy keys cleared, no duplicate on second login.
8. User with cloud prefs already + stale localStorage: sign in → cloud values win, legacy keys cleared.
9. Notifications toggle → Test notification still fires; wind-down scheduler picks up new prefs after save.
10. Delete account flow unaffected (cascade removes `user_prefs` row).
