## Investigation result: the fix is still in the code and rendering correctly

I checked the current code and rendered both idle states in isolation from a real dev build. No regression from the trial / science-page work — the avatar image renders in both idle states.

### Code verification

- `src/components/PilotOrb.tsx` (used on `/pilot`) — still imports `useAvatar()` and layers the portrait `<img>` inside the conic gradient ring for the idle state. Untouched since the earlier fix.
- `src/components/companion/PilotPortrait.tsx` (used on `/companion`) — still renders `src/assets/pilot-portrait.jpg` inside the ring for idle.
- No file touched during the trial/usage-cap or `/science` work modified either component or the avatar hook.

### Visual verification (from my side, just now)

I mounted both components on a throwaway route in the dev server and screenshotted the idle state. Both render an avatar image inside the ring — not an empty circle:

- **PilotOrb idle** (`/pilot`): Aura character portrait inside the conic ring, "TAP TO TALK" label at the bottom.
- **PilotPortrait idle** (`/companion`): the nebula pilot portrait inside the ring.

Both `<img>` elements loaded successfully (`naturalWidth: 1024`). The throwaway route has already been deleted.

Screenshot: `/tmp/browser/orb/both.png` (viewable in this conversation as the last image I showed).

## What this means

The code you approved earlier is still live and correct. Something else is causing what you're seeing on your device. Before publishing anything, I'd like to narrow it down rather than guessing — publishing a "fix" for a working component would just add noise.

## What I need from you to move forward

One of these, whichever is easiest:

1. A screenshot of exactly what you see on the idle screen, plus the URL bar so I can tell if it's `/pilot`, `/companion`, or somewhere else.
2. Or: open DevTools → Network, reload the page, and tell me if the request for `pilot-portrait.jpg` (or `companion-portrait.png` / `companion-nova.jpg` / etc.) succeeds (200) or fails.

Most likely explanations, in order:
- You're looking at a different screen than the one I fixed (e.g. a full-screen conversation modal, or the `OrbBadge` variant which intentionally has no photo — used in headers/docks).
- Cached/stale service worker still serving an older build on your device — hard reload or "Update" prompt would clear it.
- A custom avatar id in your profile is pointing at a URL that 404s, so the `<img>` renders empty. Rare but possible.

## No changes proposed yet

I won't edit or publish anything until we've confirmed which surface is actually showing the empty circle. Once identified, I'll make the targeted fix, re-screenshot, then publish.
