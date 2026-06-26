
# Phase 1 / Task 1 — Persist Shifts in Supabase

## Goal
Replace `localStorage`-only shift storage with a Supabase-backed `shifts` table so users keep their schedule across devices and browser clears. No UI redesign. No changes to payments, coach history, OAuth, or password reset.

## 1. Current state (investigation findings)

- `src/lib/shifts.ts` defines `Shift = { id, day (0–6), start (min from 00:00), end (min) }` and reads/writes the JSON array under `localStorage["shiftrest.shifts.v1"]`.
- Call sites for `loadShifts` / `saveShifts`:
  - `src/routes/index.tsx` — main editor; reads on mount, writes on every add/delete.
  - `src/routes/plan.tsx` — reads on mount.
  - `src/routes/share.tsx` — reads own shifts.
  - `src/routes/swap.tsx` — reads current shifts.
  - `src/routes/playbooks.tsx` — overwrites all shifts when applying a template.
  - `src/lib/notify.ts` — reads to schedule wind-down notifications.
- `src/routes/coach.tsx`, `src/routes/profile.tsx`, `src/routes/paywall.tsx`, `src/components/Onboarding.tsx` only import the `DISCLAIMER` constant — untouched by this task.
- No `shifts` table exists today; only `profiles` is in the DB. Auth (email + OAuth) is already wired.

## 2. Database design

Single table `public.shifts`, one row per shift, owned by the signed-in user. Keep current numeric `day` + `start` + `end` model rather than absolute timestamps — the entire app's logic (debt score, plan, playbooks, notifications) is built around weekday-relative minutes, and changing the shape is out of scope.

The plan request mentions `title`, `start_time`, `end_time`, `shift_type`, `notes`. The current app does not use any of those — adding them as nullable optional columns is safe and forward-compatible, but we will not wire UI for them in this task.

### Schema
```text
public.shifts
  id            uuid    PK, default gen_random_uuid()
  user_id       uuid    NOT NULL, FK -> auth.users(id) ON DELETE CASCADE
  day           int2    NOT NULL  (0=Mon .. 6=Sun)  CHECK 0..6
  start_min     int2    NOT NULL  CHECK 0..1439
  end_min       int2    NOT NULL  CHECK 0..1439
  title         text    NULL
  shift_type    text    NULL
  notes         text    NULL
  created_at    timestamptz NOT NULL DEFAULT now()
  updated_at    timestamptz NOT NULL DEFAULT now()

INDEX shifts_user_id_idx ON (user_id)
TRIGGER shifts_updated_at  BEFORE UPDATE -> public.set_updated_at()  (already exists)
```

### Migration SQL (preview — not executed yet)
```sql
CREATE TABLE public.shifts (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  day         SMALLINT NOT NULL CHECK (day BETWEEN 0 AND 6),
  start_min   SMALLINT NOT NULL CHECK (start_min BETWEEN 0 AND 1439),
  end_min     SMALLINT NOT NULL CHECK (end_min BETWEEN 0 AND 1439),
  title       TEXT,
  shift_type  TEXT,
  notes       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.shifts TO authenticated;
GRANT ALL ON public.shifts TO service_role;

ALTER TABLE public.shifts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users select own shifts" ON public.shifts
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users insert own shifts" ON public.shifts
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own shifts" ON public.shifts
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users delete own shifts" ON public.shifts
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE INDEX shifts_user_id_idx ON public.shifts (user_id);

CREATE TRIGGER shifts_updated_at
  BEFORE UPDATE ON public.shifts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
```

## 3. `src/lib/shifts.ts` — change shape

Keep the `Shift` type, `DAYS`, `fmt`, `parseTime`, `toTimeInput`, `endAbsolute`, `DISCLAIMER` exports unchanged.

Replace the two storage functions:
- `loadShifts()` → `async fetchShifts(): Promise<Shift[]>` — reads current user's rows via `supabase.from('shifts').select(...).order('day').order('start_min')`, maps DB → `Shift`. If no session, returns `[]`.
- `saveShifts(next)` → split into granular ops because re-writing the whole array per change is wasteful and racy:
  - `addShift(input: Omit<Shift,'id'>): Promise<Shift>`
  - `updateShift(id, patch): Promise<void>`  (not currently used by UI but cheap to add)
  - `deleteShift(id): Promise<void>`
  - `replaceAllShifts(next: Shift[]): Promise<void>` — used only by Playbooks ("Apply"); deletes all existing user rows then bulk-inserts.
- Add `migrateLocalShiftsIfNeeded(userId): Promise<void>` — guarded by a sentinel localStorage key `shiftrest.shifts.migrated.v1`. On the first authenticated load: if old `shiftrest.shifts.v1` exists and the sentinel is unset, insert each row with the user id, then set the sentinel and remove the legacy key. Idempotent; survives repeated logins. If the user already has rows in the DB, skip insert (treat as "already migrated").

DB row ↔ `Shift` mapping:
```text
{ id, day, start_min, end_min }  ⇄  { id, day, start, end }
```

## 4. Component changes (minimal, presentation untouched)

- **`src/routes/index.tsx`** — replace `loadShifts()` with a TanStack Query `useQuery({ queryKey: ['shifts'], queryFn: fetchShifts })`. Replace `saveShifts(next)` in `addShift` / `removeShift` with `useMutation` wrapping `addShift` / `deleteShift`, then `queryClient.invalidateQueries(['shifts'])`. UI markup unchanged.
- **`src/routes/plan.tsx`** — swap `loadShifts()` for `useQuery(['shifts'], fetchShifts)`. Render unchanged.
- **`src/routes/share.tsx`** — same swap for the "my shifts" branch.
- **`src/routes/swap.tsx`** — same swap before the AI call.
- **`src/routes/playbooks.tsx`** — replace `saveShifts(shifts)` with `await replaceAllShifts(shifts)` then navigate.
- **`src/lib/notify.ts`** — `scheduleNextWindDown` becomes async (`await fetchShifts()`); the single caller in `src/routes/__root.tsx` already runs it in an effect, so we just drop the `await` and ignore the promise.
- **Move route gating** — these routes now require a session. Move them under `src/routes/_authenticated/` (the integration-managed gate already exists per project rules) **or** keep them top-level and have `fetchShifts` return `[]` when signed-out. **Decision for this task:** keep top-level, return `[]` when signed-out, and let the existing `/auth` CTA in the UI handle the sign-in nudge — moving routes is a navigation change out of scope.

No server functions needed — the browser Supabase client + RLS is sufficient and matches existing patterns in the project.

## 5. Files that will change

```text
supabase/migrations/<new>.sql        NEW   shifts table + RLS + grants + trigger
src/lib/shifts.ts                    EDIT  swap storage layer; keep types/helpers
src/routes/index.tsx                 EDIT  useQuery/useMutation; same JSX
src/routes/plan.tsx                  EDIT  useQuery
src/routes/share.tsx                 EDIT  useQuery
src/routes/swap.tsx                  EDIT  useQuery (or one-shot fetch in handler)
src/routes/playbooks.tsx             EDIT  await replaceAllShifts
src/lib/notify.ts                    EDIT  await fetchShifts
src/routes/__root.tsx                EDIT  call the migration helper once after auth, and await the notify scheduler
```

Files explicitly **not** touched: `coach.tsx`, `paywall.tsx`, `profile.tsx`, `auth.tsx`, `Onboarding.tsx`, `subscription.ts`, the supabase auto-generated integration files.

## 6. Risks & mitigations

- **Signed-out users on `/`** — page currently works offline via localStorage. After the change, signed-out users see an empty schedule. Mitigation: leave the existing "Sign in" UI affordances; surface a small "Sign in to save your schedule" hint when not authenticated (copy-only, no redesign).
- **Migration double-insert** — handled by the sentinel key + the "skip if DB already has rows" guard.
- **Race on Playbooks "Apply"** — `replaceAllShifts` does delete-then-insert; wrap in a single Supabase transaction is not possible from the client, so we accept brief inconsistency. Mitigation: invalidate query after both calls succeed; on partial failure, surface a toast.
- **Latency** — first paint of `/` no longer instant. Mitigation: TanStack Query's cache + show the existing empty state while loading (no spinner change).
- **RLS regression on other tables** — none; we only add policies on the new table.
- **Type drift** — Supabase types regenerate after migration; component code must be written after the migration runs.
- **SSR** — `fetchShifts` runs only client-side (browser Supabase client). Routes already render with `mounted` guards, so SSR shape is unaffected.

## 7. Test checklist

Functional (one signed-in user):
1. Sign in → empty schedule renders.
2. Add a shift → row appears in DB (`select * from shifts where user_id=...`), UI updates.
3. Edit a shift (delete + re-add via existing UI) → DB reflects new row, old row gone.
4. Delete a shift → row removed in DB, UI updates.
5. Apply a Playbook → previous shifts cleared, new set inserted; counts match.
6. Hard refresh → schedule reloads from DB, identical to pre-refresh.
7. Log out → schedule view empties; sign back in → schedule restored.

Migration:
8. Pre-seed `localStorage["shiftrest.shifts.v1"]` with 2 shifts, sign in → both rows appear in DB exactly once, sentinel set, legacy key removed.
9. Reload after migration → no duplicate insert, sentinel still set.
10. Sign in as a second user on same browser → sees their own shifts only, no leakage from user A's migrated rows.

Security (RLS):
11. As user B, attempt `select * from shifts where user_id='<user A id>'` via browser client → returns 0 rows.
12. As user B, attempt `update`/`delete` on user A's row id → 0 rows affected.
13. Anonymous (signed-out) `select` → permission denied / 0 rows.

Notifications:
14. With shifts saved server-side, "Test notification" still fires; scheduler uses fresh DB read.

## 8. Out of scope (explicit)
Payments, coach history persistence, OAuth provider config, password reset, account deletion UI, UI redesign, server functions, edge functions. No changes to `Shift` field semantics (day/start/end remain minutes-from-midnight).
