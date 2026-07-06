## What I've verified so far (with evidence)

1. **Live DB constraint** — confirmed via direct SQL query against the production database:
   ```
   CHECK (assistant_mode = ANY (ARRAY[
     'coach','companion','minimal','friend','professional',
     'warm','encouraging','motivational','supportive'
   ]))
   ```
   All nine values are accepted. The migration is applied.

2. **Loader whitelist** (`src/lib/prefs.ts:14-24`) — actual current code:
   ```ts
   const ALLOWED_ASSISTANT_MODES: ReadonlySet<AssistantMode> = new Set([
     "coach","companion","minimal","friend","professional",
     "warm","encouraging","motivational","supportive",
   ]);
   ```
   All nine present. `rowToPrefs` uses this set at line 250.

3. **Save path** (`prefsToRowPartial` line 295) passes `assistantMode` through unchanged to `assistant_mode`. No coercion.

4. **Codebase-wide search for a second whitelist** — no other client validator restricts `assistant_mode`. The only other server references (`context.server.ts`, `notifications/run.server.ts`) are read-only prompt overlays; they can't cause a save failure. No other component or server function writes `assistant_mode`.

5. **No service worker on preview** — `src/lib/pwa/register.ts` explicitly refuses to register on `id-preview--*.lovable.app`, so stale cached JS is ruled out.

## What I couldn't verify

I cannot reproduce the failing save from this sandbox because I have no signed-in browser session against your account. That means the *actual* Supabase error response is still unseen — which is exactly the piece we need to be certain about. Everything else checks out on paper, so the answer has to be in the response body.

## Plan

**Step 1 — Add temporary, targeted logging around the round trip.**

In `src/lib/prefs.ts` `savePrefs`, log:
- the exact `partial` argument received,
- the exact `row` object being sent to `.upsert()`,
- the raw `{ data, error }` returned by Supabase (including `error.code`, `error.message`, `error.details`, `error.hint`).

In `src/routes/profile.tsx` `mutation`, log inside `onSettled` (and after `invalidateQueries`) what value comes back in the refetched cache for `assistantMode`.

All logs prefixed `[assistantMode-debug]` so they're easy to grep.

**Step 2 — You reproduce once on preview.**

Open DevTools console, tap Friend, then send me:
- the `[assistantMode-debug]` log lines, and
- the failing `user_prefs` PATCH/POST request from the Network tab (status code + response body).

**Step 3 — Fix based on what the response actually says.** Likely categories:
- `23514` check constraint → a DB layer we haven't seen enforces the old list (unlikely given the SQL above, but the response will prove it).
- `42501` RLS/permission → policy or GRANT issue on some column touched by the upsert.
- `PGRST*` schema-cache → PostgREST hasn't reloaded types.
- Something entirely different (a network error, a 400 on an unrelated column) that the generic "Couldn't save" toast has been hiding all along.

**Step 4 — Remove the debug logs** once the cause is identified and fixed.

## Why not just guess and patch again

Two previous patches were plausible from code inspection but didn't fix it. The remaining unknown is the literal response body from the failing request, which requires a real signed-in reproduction. Adding the logs is the smallest possible change that guarantees the next iteration is based on evidence rather than another hypothesis.
