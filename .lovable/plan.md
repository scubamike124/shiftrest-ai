# Pre-Launch UX Polish — Investigation Report & Plan

Full codebase audit complete. Findings below are ranked and batched into shippable phases so each one is small, testable, and independently revertible.

---

## Priority-Ranked Findings

### High Priority (ship before launch)

| # | Finding | Files | Difficulty |
|---|---|---|---|
| H1 | **Signed-in users see a flash of the marketing landing page** on `/` before client-side redirect to `/dashboard` (100–300ms) | `src/routes/__root.tsx:206–210` | M |
| H2 | **No Settings entry point in `AppSidebar` or `BottomNav`** — four `settings.*` routes are only reachable via deep links | `src/components/site/AppSidebar.tsx`, `src/components/BottomNav.tsx` | S |
| H3 | **`h-screen` / `min-h-screen` on root shells** clip content under iOS Safari's address bar | `src/routes/__root.tsx:232,242,244,255`, `src/components/site/AppSidebar.tsx:44`, `src/routes/coach.tsx:290`, `src/routes/share.tsx:148` | S |
| H4 | **Custom keyframe animations lack `prefers-reduced-motion` guards** (`.pulse-dot`, `.float-y`, `.ticker-track`, `.dock-glow`) | `src/styles.css:150–163,175,245–249` | S |
| H5 | **Dead duplicate `CompanionHero`** at `src/components/companion/CompanionHero.tsx` — never imported; richer than the one in use | Delete or wire in | S |

### Medium Priority (polish before launch if time allows)

| # | Finding | Files | Difficulty |
|---|---|---|---|
| M1 | **`DebugHUD` mounts on every page load in production** (guarded UI, but JS still runs, listeners still register) | `src/routes/__root.tsx:261` | S |
| M2 | **Hardcoded `bg-white/5`, `border-white/10`** — breaks any future light/high-contrast theme | `src/routes/dashboard.tsx:459,497,513`, `src/components/home/HydrationCard.tsx:64`, `QuickActionsCard.tsx:23`, `SleepSoundsCard.tsx:25`, `SleepStreakCard.tsx:55`, `CompanionDock.tsx:35` | S |
| M3 | **QA route `/qa/smart-alarm` live in production** — its own comment says delete pre-launch | `src/routes/qa.smart-alarm.tsx` | S |
| M4 | **Icon-only buttons missing `aria-label`** — add-employer `+`, delete destination trash | `src/routes/profile.tsx:798`, `src/components/traffic/TrafficDestinationsCard.tsx:238` | S |
| M5 | **Custom toggle in `NotificationsSection` has no accessible name** — SR users hear "button, pressed" with no context | `src/components/NotificationsSection.tsx:409–426` | S |
| M6 | **Inline `animate-pulse` / `animate-ping` without `motion-reduce:animate-none`** — 20+ hits, only 4 guarded | `src/components/PilotOrb.tsx:24,70`, `src/routes/pilot.tsx:597`, `src/components/LongClock.tsx:313`, `src/routes/sleep.tsx:84`, others | S |
| M7 | **Three overlapping Companion entry points** (`CompanionAvatar` chip + `CompanionHero` card + `CompanionDock` orb) create ambiguity | `src/components/CompanionAvatar.tsx`, `src/components/home/CompanionHero.tsx`, `src/components/companion/CompanionDock.tsx` | M |
| M8 | **Onboarding slide dots are not clickable, no back button** — misclicks trigger consent step irreversibly | `src/components/Onboarding.tsx:195–218` | S |
| M9 | **Dead `LiveCoachSection` + `LongClockSection` in landing route chunk** | `src/routes/index.tsx:326,426` | S |

### Low Priority (post-launch)

| # | Finding | Files | Difficulty |
|---|---|---|---|
| L1 | Unused `Switch` shadcn import shadowed by local component | `src/components/NotificationsSection.tsx:6,409` | S |
| L2 | Emoji `✕` close button in `EmployerModal` — inconsistent with Lucide `<X />` elsewhere | `src/routes/profile.tsx:887` | S |
| L3 | `bg-rose-500 text-white` on mic button — use `bg-destructive` | `src/routes/companion.tsx:1552` | S |
| L4 | `bg-black/60` overlay in manual modals — use semantic token | `src/routes/dashboard.tsx:766`, `src/routes/profile.tsx:881` | S |
| L5 | Duplicate `/auth` links in footer ("Sign in" + "Get started") | `src/components/site/SiteFooter.tsx:38–40` | S |
| L6 | `NotificationsSection` uses plain text loader, no skeleton | `src/components/NotificationsSection.tsx:186–188` | S |
| L7 | `ShiftFormModal` save button has no "Saving…" state | `src/routes/dashboard.tsx` | S |
| L8 | CompanionHero mobile dismiss X has no visible label — only aria | `src/components/companion/CompanionHero.tsx:174` | S |
| L9 | `version.tsx` fully hardcoded `bg-[#0b1020] text-white` | `src/routes/version.tsx:70` | S |

### Simplification Opportunities (not blocking)

- **Extract `BottomSheet` primitive** shared by `ShiftFormModal` + `EmployerModal` (identical scaffold, drift risk).
- **Create `/settings` index route** as a proper hub instead of orphaned deep routes.
- **Consolidate `DebugHUD`** to a single dev-only root mount instead of four instances.

---

## Implementation Plan (After Approval)

Ship as **6 small, independently testable phases**. Each phase = one publish, one visual review.

### Phase 1 — Motion & viewport hygiene (safest first)
- Add `prefers-reduced-motion` block to `src/styles.css` for `.pulse-dot`, `.float-y`, `.ticker-track`, `.dock-glow`.
- Swap `min-h-screen` → `min-h-dvh` in `src/routes/__root.tsx` marketing/app/bare shells and `AppSidebar.tsx`.
- Add `motion-reduce:animate-none` to unguarded inline `animate-*` usages.

**Files:** `src/styles.css`, `src/routes/__root.tsx`, `src/components/site/AppSidebar.tsx`, `src/routes/coach.tsx`, `src/routes/share.tsx`, `src/components/PilotOrb.tsx`, `src/routes/pilot.tsx`, `src/components/LongClock.tsx`, `src/routes/sleep.tsx`.

### Phase 2 — Kill dead code
- Delete `src/components/companion/CompanionHero.tsx` (H5).
- Delete `src/routes/qa.smart-alarm.tsx` + the `dispatchEvent` line it depends on in `src/lib/alarm/foreground.ts` (M3).
- Delete `LiveCoachSection` + `LongClockSection` from `src/routes/index.tsx` (M9).
- Remove unused `Switch` import in `NotificationsSection.tsx` (L1).

### Phase 3 — Accessibility labels
- Add `aria-label` to add-employer button (M4a), traffic-destination delete button (M4b).
- Add `aria-labelledby` (or programmatic label) to custom `Switch` toggle rows in `NotificationsSection` (M5).
- Replace emoji `✕` with Lucide `<X />` in `EmployerModal` (L2).

### Phase 4 — Nav discoverability + landing flash
- Add Settings entry to `AppSidebar` linking to `/profile` (Settings hub) (H2).
- On `/` route, render null (or a splash) while `signedIn === null`, then redirect signed-in users before painting marketing hero (H1).

### Phase 5 — Prod hygiene
- Wrap root `<DebugHUD>` in `{import.meta.env.DEV && ...}` (M1).
- Replace `bg-white/5` / `border-white/10` with `bg-secondary/20` / `border-border/40` in the 6 identified files (M2).
- Replace `bg-rose-500 text-white` with `bg-destructive text-destructive-foreground` (L3).
- Collapse duplicate `/auth` footer links (L5).

### Phase 6 — Onboarding polish
- Make slide dots clickable + add Back button in `Onboarding.tsx` (M8).
- Add "Saving…" state to `ShiftFormModal` (L7).
- Skeleton loader for `NotificationsSection` hydration (L6).

**Deferred (post-launch):** M7 (Companion entry consolidation — needs product decision), simplification opportunities (BottomSheet extraction, `/settings` hub route, DebugHUD consolidation), L4/L8/L9.

---

## Approval Needed

Reply with which phases to run (e.g. "run 1 and 2", "run all", "skip 6"). I'll ship them one at a time with a visible checkpoint between each.
