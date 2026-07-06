# What I actually checked (evidence)

## 1. Preview is the sandbox dev server, not a separate deploy

The `id-preview--…lovable.app` URL is a proxy to this project's Vite dev
server. There is no separate preview "build" that could be stale relative
to the code — HMR from this workspace lands there directly. Latest Vite
log entries (from `/tmp/sandbox-state.db`):

```
1:04:04 AM [vite] (client) hmr update /src/styles.css?direct, /src/router.tsx
1:00:33 AM [vite] (client) hmr update /src/router.tsx
12:59:59 AM [vite] server restarted
12:51:34 AM [vite] (client) hmr update /src/routes/profile.tsx
```

No build errors, no failed transforms. `curl -I` on
`/api/public/version` and `/profile` returns 302 → `lovable.dev/auth-bridge`
because preview requires a Lovable login — that's the Lovable session
gate, not an app crash. So the branch you're testing IS the code in this
workspace. Prod is older (last publish) — that explains why prod renders
the section: it doesn't have any of the recent instrumentation edits yet.

## 2. Code is present — no conditional hides the mode section

`src/components/AssistantSettings.tsx` renders `MODE_OPTIONS.map(...)`
against a hardcoded 9-item array. No prop, prefs value, or feature flag
can shrink it. `profile.tsx` L624 always renders `<AssistantSettings />`.
No error boundary swallows failures.

## 3. What I can NOT verify from the sandbox

I don't have your Lovable session, and `/profile` is gated. That means I
cannot render the authenticated preview from here and physically see
what your phone sees. Every previous "it's there" claim was based on
reading source + HMR logs, not on rendering the page.

Given prod renders fine and preview does not, the most likely causes
(in order) are:

1. Stale service-worker / installed-PWA cache on your phone serving an
   older chunk that predates the 9-mode expansion.
2. A client-side runtime error thrown mid-render of `AssistantSettings`
   only under preview conditions (different env, different data shape
   from `fetchPrefs` returning something the render doesn't like), which
   would blank part of the tree without a visible error.
3. The preview tab is on an old sandbox instance (the dev server has
   restarted multiple times tonight — connections that don't reconnect
   keep serving the old module graph until reload).

## Plan — instrument so the next screenshot is diagnostic

No functional changes. Purely visibility additions inside the
AssistantSettings card so we can see, from your phone, exactly what the
preview is running.

1. **Build stamp at the top of AssistantSettings.**
   Add a small monospaced line right under the "Your AI assistant"
   heading showing `build __BUILD_ID__` (already defined in
   `vite.config.ts`) plus a literal `modes:9` string. If the stamp shows
   an old build ID or `modes:3`, it's a cache/SW/stale-tab problem, not
   a code problem. If it shows the current build ID and `modes:9` but
   still no buttons, the render is being interrupted mid-card and I
   move to step 3.

2. **Error boundary around the mode grid.**
   Wrap only the `MODE_OPTIONS.map(...)` grid in a tiny inline
   `<ModeGridBoundary>` that catches render errors and prints the error
   name + message + stack (short) into the card, in red text. Nothing
   else changes.

3. **Fallback "always visible" mode list.**
   If the boundary catches an error, still render a plain `<ul>` of the
   9 mode labels below the error so the section is never fully invisible
   — that both proves the array is intact and gives you a way to see
   which mode is currently selected.

4. **Force a dev-server restart** after the edit so any stuck sandbox
   connection is dropped.

After you screenshot the section on preview I will know exactly which
of the three hypotheses is real, and the fix drops out of that.

## Files touched

- `src/components/AssistantSettings.tsx` — build stamp line, boundary
  wrapper around the mode grid, plain fallback list.
- `src/components/debug/ModeGridBoundary.tsx` — new tiny class-component
  boundary (React error boundaries must be class components).

Nothing in `prefs.ts`, `profile.tsx`, or the debug bus changes. No
production behaviour changes. All additions are removable in one commit
once the cause is confirmed.

## What I am explicitly NOT doing this turn

- Not publishing to production. Per your rule, no publish until preview
  is verified.
- Not claiming the section is fixed. This turn only adds instrumentation.
- Not asking you to test yet — that comes after you approve the plan
  and I've applied the instrumentation and restarted the dev server.
