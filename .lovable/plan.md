# Bug — Companion shows "scubamike124"

## Root cause (data, not code)

The A2 backfill cleared `profiles.display_name` when it matched the email prefix, but it never touched `user_prefs.preferred_name`. That column is the *only* thing the Companion and Home greetings read from — so any row where `preferred_name` was already set to an email-prefix value keeps rendering that value.

Confirmed against the live DB:

| email | preferred_name |
|---|---|
| `scubamike124@gmail.com` | **`scubamike124`** ← this is the affected account |
| `scubamike124@yahoo.com` | `Michael` |
| `scubamike124+test1@gmail.com` | `Joe` |
| `scubamike124+verify1@gmail.com` | `Bill` |
| others | `NULL` |

Query `WHERE lower(preferred_name) = lower(split_part(email,'@',1))` returns **2 rows** across all users — this account plus one other.

The code path itself is already correct:

- `src/routes/companion.tsx:97` → `p.preferredName?.trim() || "there"` (falls back to "there", never email).
- `src/routes/dashboard.tsx:342` → `name={(prefs.preferredName ?? "").trim()}` (feeds `CompanionHero`, blank string when unset).
- `src/components/companion/CompanionHero.tsx:64` → uses `loadPreferredName()` (reads `preferred_name` only).
- `src/components/ArrivalHero.tsx` → uses shared helper.
- Morning / afternoon / evening brief `.functions.ts` → use `greetingName(preferred_name)` (blank fallback).
- Welcome email → shared helper, rejects email-prefix.

Full-repo sweep for the requested strings found no offending call sites:
- `email.split("@")` — no matches.
- `user.email` / `session.email` used for greeting text — none (the one occurrence in `companion.tsx` is marked *"sessionEmail removed: Preferred Name is the sole source for personalization"*).
- `user_metadata.email` — none.
- `profile.display_name` / `profile.email` rendered as a greeting — none. `profiles.display_name` is only read by the welcome-email helper, which already rejects an email-prefix match.
- `auth.user()` / `auth.getUser()` returning a name to a greeting — none.

**So no component needs to change. The offending name is a stale row in `user_prefs`.**

## Fix (one migration, one small guard)

### 1. Backfill migration — clears email-prefix values from `user_prefs.preferred_name`

```sql
UPDATE public.user_prefs up
SET preferred_name = NULL
FROM auth.users u
WHERE u.id = up.user_id
  AND up.preferred_name IS NOT NULL
  AND lower(btrim(up.preferred_name)) = lower(split_part(u.email, '@', 1));
```

Affects 2 rows (verified). After this runs, the Companion greeting for `scubamike124@gmail.com` becomes `"Good afternoon, there."` (companion route) / `"Good afternoon"` name-less (dashboard hero) — matching the intended chain.

### 2. Small guard so this cannot re-appear from user input

`src/lib/prefs.ts` `savePrefs()` (or a thin wrapper in the save path used by Onboarding + Profile): if the submitted `preferredName`, lower-cased and trimmed, equals `split_part(session_email, '@', 1)`, drop it to `null` server-side. Keeps a well-meaning user from re-saving their username-lookalike name, and future-proofs against any onboarding pre-fill regression.

Implementation location: the existing server-side `savePrefs` server function (whichever `.functions.ts` currently owns the write) — load the caller's email from `context.claims.email` and null the field before insert. If that write is currently client-only via publishable key, add a light server-side rewrite. (Confirm exact function during implementation; no client changes required.)

### 3. No component changes

Investigation confirms every greeting surface already flows through `preferred_name` and never touches email. The visible "scubamike124" is a stored value, not code output.

## Affected files

| File | Change |
|---|---|
| `supabase/migrations/<new>.sql` | Backfill described above. |
| `src/lib/prefs.ts` or the server-side `savePrefs` handler | Reject email-prefix on save (server-side only). |

No component, route, or helper edits.

## QA plan

1. Before running: confirm on device the Companion header still says "Good afternoon, scubamike124." for the affected account.
2. Apply migration.
3. Re-open Companion — greeting should be "Good afternoon, there." (companion route) and dashboard hero should show a name-less "Good afternoon".
4. Set Preferred Name to "Mike" in Profile → both surfaces show "Good afternoon, Mike."
5. Try to set Preferred Name to "scubamike124" → save silently strips it back to blank; greetings fall back to name-less.
6. Verify voice brief, morning/afternoon/evening briefs, and welcome email all render name-less (or "Mike") — no "scubamike124" anywhere.
7. Confirm the other affected row's greeting is also cleaned up (identify via query and QA if the user is available).

Awaiting **"go"** to implement.
