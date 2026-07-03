# Phase 2 — Dead Code & Cleanup Plan

Deep audit complete. Below is every candidate with proof of zero references. Grouped by confidence so you can approve the risk level you want.

---

## Tier A — Zero-risk removals (proven unreferenced)

I will remove these unconditionally on approval. TypeScript check after each batch.

| # | Item | LOC | Evidence |
|---|---|---|---|
| A1 | `src/components/home/CompanionHero.tsx` (dead duplicate — real one lives at `src/components/companion/CompanionHero.tsx`) | 70 | No imports of the `home/` path anywhere |
| A2 | `src/routes/qa.smart-alarm.tsx` (QA harness, self-comment says delete pre-launch) | 519 | No `<Link>`, no `navigate()` targeting `/qa/smart-alarm` |
| A3 | `src/routes/qa.voice.tsx` (voice-matrix QA harness) | 325 | No `<Link>`, no `navigate()` targeting `/qa/voice` |
| A4 | `src/lib/api/example.functions.ts` (template placeholder `getGreeting`) | 22 | Zero callers |
| A5 | `src/assets/app-icon.png` (orphan; PWA uses `public/icon-*.png`) | — | No references in src or public |
| A6 | Commented-out `SmartAlarmCard` import in `src/routes/dashboard.tsx:10` | 1 | Stale |
| A7 | Shadcn `Switch` named import in `src/components/NotificationsSection.tsx:6` (shadowed by local `function Switch` at line 409) + the "keep unused imports happy" comment at line 469 | ~2 | Local shadows import |
| A8 | `LiveCoachSection` + `LongClockSection` in `src/routes/index.tsx` (defined, never rendered — from Phase 1 audit) | ~150 | Not present in render tree |

**Tier A total: ~1,090 LOC removed.**

---

## Tier B — Feature-flag-gated dead code (needs your call)

These are components/lib files reachable only via a hardcoded `false` flag. Removing them also lets us delete the flag and simplify branches.

| # | Item | LOC | Notes |
|---|---|---|---|
| B1 | `ADVANCED_ADJUSTMENT_ENABLED = false` in `SmartAlarmCard.tsx:25` + its `if` branch (~15 lines) | 15 | Local flag, always false |
| B2 | `SMART_ALARM_ENABLED = false` in `src/lib/flags.ts` + simplify the two consumers (`settings.morning.tsx:129`, `MorningBrief.tsx:138`) to always exclude alarm | 10 | Alarm entry is permanently hidden already |
| B3 | `src/components/SmartAlarmCard.tsx` + `src/components/SmartAlarmCoach.tsx` (only reached via the two dead flags + the QA route being removed in A2) | ~350 | Only makes sense to delete if you're committing to shipping without Smart Alarm at launch |

**Tier B total: ~375 LOC.** Approve B1+B2 alone if you want to keep the components for a future Smart Alarm revival. Approve B3 for full removal.

---

## Tier C — Untargeted routes (needs product decision)

Zero navigation links from the app; only reachable by typing the URL. These may be intentional dev/ops tools.

| # | Item | LOC | Question |
|---|---|---|---|
| C1 | `src/routes/version.tsx` (deployment fingerprint page) | 141 | Do ops/support open `/version` manually? If not → delete |
| C2 | `src/routes/health.tsx` + `src/lib/health/trends.ts` (health trends view) | 476 | Is this launching in v1? Nothing links to it |
| C3 | `src/routes/lab.avatar-poc.tsx` + `.debug.tsx` + `.index.tsx` + `.simli.tsx` (avatar POC — Simli experiment) | 596 | POC done? If work is preserved elsewhere → delete |

**Tier C total: ~1,213 LOC.** Answer yes/no per item.

---

## Explicitly NOT removing

- `src/routes/unsubscribe.tsx` — registered as a server route in `src/start.ts`, receives real inbound email link traffic.
- `src/components/ui/**` (shadcn primitives) — even if unused today, they're a component library; removals here don't pay off.
- `src/routeTree.gen.ts`, `src/router.tsx`, `src/routes/__root.tsx`, `src/integrations/**` — framework/generated.

---

## Verification plan

After each tier's removals:
1. `tsgo` typecheck must pass.
2. Grep for stale references to deleted symbols.
3. Confirm no runtime imports break (Vite HMR should stay green).

Publish only once all approved tiers land and TS is clean.

---

## Approve

Reply with which tiers to run, e.g.:
- **"A only"** — safest, ~1,090 LOC.
- **"A + B1/B2"** — safest + kill the always-false flags but keep Smart Alarm components dormant.
- **"A + B + C"** — full sweep, ~2,678 LOC gone (confirm each C item).
- **"A + B + C1 + C3, keep health"** — mix and match.
