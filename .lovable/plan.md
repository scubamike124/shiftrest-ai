# Investigation — Conversation style save error

## Root cause (confirmed)

**It's a backend-schema mismatch, not a UI/tap issue.** Three layers of the app disagree on the allowed values:

| Layer | Allowed values | Location |
|---|---|---|
| UI options | 9: coach, companion, minimal, **friend, professional, warm, encouraging, motivational, supportive** | `src/components/AssistantSettings.tsx:12-22` |
| TS type | Same 9 | `src/lib/prefs.ts:3-12` |
| DB CHECK constraint | **3 only**: coach, companion, minimal | `user_prefs_assistant_mode_check` on `public.user_prefs` |
| Loader whitelist | Same 3 — silently coerces anything else to `"coach"` | `src/lib/prefs.ts:238` |

Selecting one of the 6 new options fires an UPDATE with e.g. `assistant_mode = 'friend'`, Postgres rejects it with `23514 new row for relation "user_prefs" violates check constraint "user_prefs_assistant_mode_check"`, the mutation throws, and the generic "Couldn't save — please try again" toast surfaces. Even if the DB accepted it, `prefs.ts:238` would revert it to `"coach"` on the next load — same visible symptom either way.

The UI was expanded (probably to match the 7 voice `PERSONALITY_OPTIONS` in `src/lib/voice/profile.ts`) without updating either the DB constraint or the loader.

Not a tap-target issue, not a scroll issue — the first three save because they happen to be the only values the DB allows.

## Answers to your three questions

1. **Save-payload / enum mismatch?** Yes — the DB `CHECK` on `user_prefs.assistant_mode` still only permits the original three values.
2. **UI/tap-target issue?** No. The buttons render and dispatch fine; taps map to the correct value.
3. **What's the real error?** Postgres `23514` (check-constraint violation) on `user_prefs_assistant_mode_check`. The toast text is generic; the underlying PostgREST response is a 400 with a "violates check constraint" body.

## Proposed fix (recommended — expand backend to match UI)

Two small changes; keeps the 9 options the product intends.

1. **Migration**: drop and recreate the CHECK constraint with all 9 values.
   ```sql
   ALTER TABLE public.user_prefs DROP CONSTRAINT user_prefs_assistant_mode_check;
   ALTER TABLE public.user_prefs ADD CONSTRAINT user_prefs_assistant_mode_check
     CHECK (assistant_mode = ANY (ARRAY[
       'coach','companion','minimal','friend','professional',
       'warm','encouraging','motivational','supportive'
     ]));
   ```
2. **`src/lib/prefs.ts:238`**: replace the 3-value whitelist with a single allowed-set derived from the `AssistantMode` union so it can never drift again:
   ```ts
   const ALLOWED_MODES = new Set<AssistantMode>([
     "coach","companion","minimal","friend","professional",
     "warm","encouraging","motivational","supportive",
   ]);
   assistantMode: ALLOWED_MODES.has(mode) ? mode : "coach",
   ```

No UI changes needed. The saved value flows into system-prompt / coach-personality rendering already; those code paths accept an arbitrary string and only key off it for tone hints, so unknown-to-them modes will still work (falling through to the default tone) — safe to expand.

## Alternative (not recommended)

Trim the UI back to 3 options in `AssistantSettings.tsx` and shrink `AssistantMode` to `"coach" | "companion" | "minimal"`. Cheap but throws away the product intent behind those 6 tones.

## Files touched (recommended path)

- New migration in `supabase/migrations/` — CHECK constraint swap
- `src/lib/prefs.ts` — single-source-of-truth allowed-set on the loader

No changes to code — reporting first per your request. Say the word and I'll ship the recommended fix.
