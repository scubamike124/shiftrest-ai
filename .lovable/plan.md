## 1. The debug panel code is committed

Files on disk right now:

```
src/lib/debug/assistantModeDebug.ts          (909 B, mtime 00:50)
src/components/debug/AssistantModeDebugPanel.tsx  (2.7 KB, mtime 00:51)
```

Wiring in `src/routes/profile.tsx`:
- Line 51: `import { AssistantModeDebugPanel } from "@/components/debug/AssistantModeDebugPanel";`
- Line 626: `<AssistantModeDebugPanel />` rendered directly after `<AssistantSettings … />` on line 624.

Wiring in `src/lib/prefs.ts` `savePrefs`:
- Lines 380–401: on any save that includes `assistant_mode`, pushes `savePrefs partial`, `savePrefs row -> upsert`, `upsert response data`, and `upsert response error` into the debug bus.

Mutation wiring in `src/routes/profile.tsx` (lines 94–133): pushes `mutation.onMutate partial`, `mutation.onError`, and `onSettled cache assistantMode`.

## 2. The preview build includes this commit

Dev-server (Vite) log for the preview:

```
12:51:34 AM [vite] (client) hmr update /src/routes/profile.tsx, /src/styles.css?direct
12:51:34 AM [vite] (ssr) page reload src/routes/profile.tsx
12:59:58 AM [vite] .env.development changed, restarting server...
12:59:59 AM [vite] server restarted.
```

No compile errors after either event. The preview URL you gave (`https://id-preview--8243527a-2b83-4fe2-aa6d-60b0ae194313.lovable.app`) is served by that same Vite instance — the module map that returns the transformed `AssistantModeDebugPanel.tsx` responds 200 with the expected component source. Latest change is ~10 min old and live.

I cannot end-to-end render `/profile` from the sandbox because that route is behind auth and I have no signed-in session in this environment — but the source is present, HMR applied cleanly, and the served module includes the panel code.

## 3. What the panel looks like and where

**Location**: Profile page, immediately below the "Your AI assistant" card (the one that contains Assistant name, Conversation style buttons, and Long-term memory toggle). It sits above the Voice card.

**Appearance**: an amber-outlined card with:
- Heading (amber text): "Conversation-style debug (temporary)"
- A "Clear" button on the right
- Grey helper text: "Tap a Conversation style above. The exact value sent, the raw Supabase response, and the value in the cache after refetch will appear below. Screenshot and send."
- Empty state italic text: "No events yet."
- After tapping a mode, up to 5 stacked entries (label + timestamp + JSON block) will appear.

## Plan

Given the code is confirmed present and the dev server picked it up cleanly, the most likely reason you didn't see it is a cached tab. Please:

1. Fully close the preview tab.
2. Reopen `https://id-preview--8243527a-2b83-4fe2-aa6d-60b0ae194313.lovable.app/profile` in a **new tab** (or pull-to-refresh with cache clear on mobile).
3. Scroll to the "Your AI assistant" section. The amber "Conversation-style debug (temporary)" card should be the next section below it.

If it is still not there after a fresh load, tell me — I'll switch tactics: move the panel to the very top of the Profile page (impossible to miss), add a visible build-timestamp string, and force a dev-server restart so there's no doubt about which build you're on.

No file edits in this turn — this plan is verification-only, per your request.
