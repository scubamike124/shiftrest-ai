## Findings before fixing

### #2 — Why "Light plan" appears to open "Today's recipe"
Not actually a wrong route. `Link to="/plan"` (in `src/components/home/QuickActionsCard.tsx`, `BottomNav.tsx`, `AppSidebar.tsx`) correctly navigates to the Smart Light Plan route. The problem is `src/routes/plan.tsx` line 207 renders `<h1>Today's recipe.</h1>` above the "Smart Light Plan" eyebrow. That h1 is stale/placeholder copy — every entry point to `/plan` therefore looks like it went to the wrong page.

So this is a **copy bug on the destination page**, not a routing bug. Same underlying cause as #1 if #1's button also lands on `/plan`.

### #1 — "View wind-down list/plan" button
I searched all `.tsx` for buttons/links containing "wind-down", "View wind", "wind-down list", "wind-down plan" and found no matching interactive element in the current source. The wind-down surfaces I did find are all passive:
- `EveningCards.tsx` → `WindDownCard` (informational card, no CTA)
- `WindDownQuickAction.tsx` (companion overlay trigger)
- `profile.tsx` "Wind-down window" slider (no navigation)

I need you to point at the exact button (screenshot or route) before I can fix it. Two likely candidates I'd like to confirm:
1. It's a CTA inside the AI Coach Brief `top_actions` / Tomorrow Preview blocks whose target is dynamic (currently defaults to `/plan`).
2. It's on a page that requires auth (I'm signed out in the sandbox so couldn't reach dashboards).

If you can share the exact page + button text, I'll wire it to the correct wind-down surface in the same pass as #2.

### #4 — Low-light interface toggle
Confirmed **no-op**. `prefs.lowLight` is written to Supabase via the toggle in `profile.tsx:639-643`, but `grep` finds zero readers of `lowLight` / `low_light` / `low-light` in any component, hook, style, or theme file — nothing consumes it to change contrast, brightness, or a theme class. It's a dead control.

### Broader nav-bug pattern (per your request)
Root cause isn't a systemic Link-wiring bug. It's that a small number of navigation targets have **stale headings that don't match the route's purpose** (e.g. `/plan` says "Today's recipe."). Combined with reused generic route names, users read the h1 as "wrong destination." Real fix is a quick audit of h1s vs. route intent — I'll do it as part of this pass.

---

## Plan

### 1. Fix #2 (direct)
- `src/routes/plan.tsx` line 207: change `<h1>Today's recipe.</h1>` → `<h1>Today's light plan.</h1>` (matches the "Smart Light Plan" eyebrow and the head title).
- Audit sibling routes (`dashboard`, `coach`, `companion`, `inbox`, `sleep`) for h1s that don't match their route intent; fix any obvious mismatches only.

### 2. Fix #3 (direct) — Remove Fitbit/Oura from Profile
- `src/components/WearableCard.tsx`: replace the connect/sync UI with a compact "Wearable sync — coming in a future update" placeholder that keeps the card slot but removes both provider rows, both Connect buttons, the OAuth mutations, and the health-trends link. Leave the underlying `wearables.functions.ts` / callback routes untouched so Phase 2 can re-enable without a migration.
- Do not delete the OAuth callback routes or server functions — Phase 2 will re-enable.

### 3. Fix #4 (direct) — Remove or wire Low-light toggle
Two options; I'll take **Option A** unless you say otherwise:
- **A (recommended, minimal):** remove the "Low-light interface" toggle section from `profile.tsx` (lines 636–644). The app is already dark-themed by default, and shipping a toggle that changes nothing is worse than shipping no toggle. Keep `prefs.lowLight` in the schema untouched.
- **B (wire it up):** add a `data-low-light` attribute to `<html>` based on `prefs.lowLight`, and add a small CSS block in `styles.css` that dims foreground/background a notch when set. Larger scope; requires design review.

### 4. Fix #1 (blocked pending your confirmation)
Once you tell me the exact button (page + label, or screenshot), I'll change its `to=` to the correct destination in the same commit as the others.

### Verify
- `tsgo` typecheck.
- Playwright screenshot of `/plan` on mobile viewport confirming new h1.
- Playwright screenshot of `/profile` confirming Fitbit/Oura rows are gone and low-light toggle is removed.
- No publish until you sign off on Option A vs B for #4 and identify #1's button.

## Technical notes
- `/plan` route path and file (`src/routes/plan.tsx`) unchanged — only visible copy.
- `WearableCard` kept as a component so its slot in `profile.tsx` doesn't shift; just its body swaps to a placeholder.
- `prefs.lowLight` field stays in `src/lib/prefs.ts` and DB schema; only the UI control is removed.
