# Launch Blocker — Onboarding Save Spins Forever

## Root cause

Two compounding bugs:

1. **Missing Data API GRANTs** (primary). `public.legal_acceptances` and `public.user_prefs` have **no `GRANT` for the `authenticated` or `service_role` roles**. Supabase's PostgREST denies every write with `permission denied for table …` regardless of RLS. So when the user taps **I agree — Get started**:
   - `recordAcceptanceFn` → `INSERT INTO legal_acceptances` → denied
   - `recordAcceptanceFn` → `UPSERT user_prefs.consent_json` → denied
   - `markOnboarded` → `UPSERT user_prefs.onboarded_at` → denied

2. **Onboarding swallows / mishandles failures**. In `src/components/Onboarding.tsx → finish()`:
   - `markOnboarded()` only `console.error`s its failure, so the modal dismisses but onboarding never actually completes — next load re-opens the modal (looks like "spinning forever / never moves forward").
   - There is no `try/finally` around `setBusy`, so any thrown error after `setDismissed(true)` leaves the button in its busy state.
   - The user never sees the real reason (permission denied) — only a generic toast or a stuck button.

This is environment-independent (preview and production both miss the grants).

## Fix

### 1. Database migration — add missing GRANTs

Both tables are auth-only (every policy scopes to `auth.uid()`), so no `anon` grant.

```sql
GRANT SELECT, INSERT, UPDATE, DELETE ON public.legal_acceptances TO authenticated;
GRANT ALL ON public.legal_acceptances TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_prefs TO authenticated;
GRANT ALL ON public.user_prefs TO service_role;
```

### 2. `src/lib/prefs.ts` — make `markOnboarded` actually throw on failure

Today it only `console.error`s. Throw so the caller can react and the user sees a real error.

### 3. `src/components/Onboarding.tsx` — robust `finish()`

- Wrap the whole flow in `try / catch / finally` so `setBusy(false)` always runs (no infinite spinner).
- Only `setDismissed(true)` **after** both `recordAcceptanceFn` and `markOnboarded` succeed.
- Show a user-friendly toast with the real error message on failure.
- Button already disabled while `busy` — prevents double-tap.

### 4. `src/lib/legal/consent.functions.ts` — surface the user_prefs upsert error

Replace the silent `console.error` on the `consent_json` upsert with a thrown error so the client knows the save didn't fully complete.

## Files changed

- Migration (new): grants on `legal_acceptances` + `user_prefs`
- `src/lib/prefs.ts` — `markOnboarded` throws on error
- `src/components/Onboarding.tsx` — try/catch/finally, ordered state updates, surfaced errors
- `src/lib/legal/consent.functions.ts` — throw on user_prefs upsert failure

## Verification

- DB: `\dp public.legal_acceptances` and `public.user_prefs` show grants for `authenticated` + `service_role`.
- Sign in (email/password and Google), complete onboarding → single Save tap → modal closes → land on `/dashboard`; refresh does not re-prompt.
- Force a failure (revoke a grant temporarily) → button returns to idle, toast shows real error, no infinite spinner.
- Tested on iPhone Safari (375×598) and desktop Chrome.

## Acceptance criteria mapping

| Criterion | Met by |
| --- | --- |
| Save completes on one tap | GRANTs added |
| Redirect to dashboard | `markOnboarded` succeeds → `prefs.onboarded` true → existing redirect logic runs |
| No infinite spinner | `try/finally` around `setBusy` |
| Friendly error on failure | `toast.error(err.message)` |
| Real error logged | `console.error` preserved |
| No double-tap | `disabled={busy}` already in place |
| iOS Safari + desktop | Pure data-layer fix, no platform-specific code |
| Google + email/password | Both go through the same server fn |
