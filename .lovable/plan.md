
# Pre-Launch Polish & Stability — Investigation Report

Investigation only. No code will be written until you approve a batch.

---

## 1. Investigation Findings

### Batch A — Home & AI Companion

**A1. Greeting truncation on small phones (375px iPhone SE / mini)**
`src/components/home/CompanionHero.tsx` uses `text-2xl` + `truncate` on the H1 in a `grid-cols-[auto_minmax(0,1fr)]` next to a 144px (`h-36 w-36`) portrait. On 375px viewports the text column is ~180px, so "Good evening, Christopher" truncates to "Good evening, Chri…". The sub-line uses `line-clamp-2`, hiding the second half of context on small screens.

**A2. "scubamike124" username showing up**
`src/lib/user/display-name.*` correctly returns only `user_prefs.preferred_name` (no email fallback). The leak is upstream:
- `handle_new_user` DB trigger writes `split_part(email,'@',1)` into `profiles.display_name`.
- `src/lib/welcome-email.functions.ts` reads `profiles.display_name` and injects it into the welcome email as `{{name}}` → "Hi scubamike124".
- Any component still reading `profiles.display_name` (a few older components / potentially AI context assembly) will echo it. Needs a full grep sweep + a "no email-derived names, ever" rule.

**A3. Generic AI Companion replies**
`src/lib/ai/context.server.ts` assembles context but the persona overlay is short and the model rarely gets: recent memory highlights, last brief summary, current shift phase, user's own words from the last 24h. Replies feel generic because the prompt is generic. Needs richer context injection + persona-tuned opening patterns per day-part.

**A4. Portrait life**
`PilotPortrait.tsx` has a `breathe` class + speaking `animate-ping`. It does NOT have: idle micro-drift, thinking shimmer, or state cross-fade. Adding a slower secondary glow layer + `will-change: transform` keeps it 60fps on iOS.

**A5. Greeting quality**
`src/lib/greeting/context.ts` + `src/lib/time/day-part.ts` produce solid but formulaic lines ("You've recovered well"). Needs variety pool + weighting by data confidence so it doesn't repeat.

---

### Batch B — Mobile UI Audit (planned method)

I will run Playwright at 375×812 (iPhone SE), 390×844 (iPhone 14), and 430×932 (iPhone 15 Pro Max) across every authenticated route, capture screenshots into `/tmp/browser/mobile-qa/`, and produce a defect list with file:line references. Known suspects from static review:
- Dashboard: employer picker chip row can horizontal-overflow with >3 employers.
- `/pilot` and `/companion`: header controls may clip behind iOS status bar without `pt-[env(safe-area-inset-top)]` on the outer wrapper.
- `BottomNav.tsx`: verify 44×44 min touch target on all icons.
- Legal pages: `prose` typography inconsistent with rest of app.
- Cards using `text-xs` for values (should be ≥14px per iOS HIG).

Deliverable: single markdown defect table with severity + screenshot link.

---

### Batch C — Regression Test (planned method)

Scripted flows via Playwright + a manual matrix. Deliverable is a pass/fail table, not fixes.

Flows to script: Sign Up → Verify Email → Login → Session persistence across reload → Password reset → Logout → Delete Account. Feature flows: AI Coach Brief, Voice playback (with bearer), Smart Light Plan, Schedule CRUD, Partner Mode share code round-trip, Memory purge, Data export, Notification enroll, Upgrade → Stripe Checkout → webhook → premium unlock → portal → cancel.

---

### Batch D — Production Readiness (planned method)

Audit checklist against actual code, not a fresh implementation. Focus:
- Missing `errorComponent` / `notFoundComponent` on any route with a loader (grep).
- Empty states on: `/memory`, `/inbox`, `/decisions`, `/plan`, `/schedule` when no data.
- Offline: verify SW `warm-offline` covers `/dashboard`, `/pilot`, `/companion`, static assets.
- AI timeout: confirm `/api/ai` has abort + fallback message; TTS has retry cap.
- Owner alerts: verify `notifyOwner` fires on Stripe webhook failure, email queue DLQ, AI 5xx bursts.
- Lighthouse mobile pass on `/` and `/dashboard` — record baseline.

---

## 2. Root Cause Summary

| # | Symptom | Root Cause |
|---|---|---|
| A1 | Greeting truncates | `text-2xl` + fixed 144px portrait on 375px viewport |
| A2 | "scubamike124" name | `handle_new_user` seeds `profiles.display_name` from email; welcome email reads it |
| A3 | Generic AI replies | Thin context payload + short persona overlay |
| A4 | Portrait feels static | Only breathe + ping; no thinking/idle drift |
| A5 | Repetitive greetings | Single-line-per-condition template, no variety |

---

## 3. Files That Will Change (per batch)

**Batch A1 (greeting fit):** `src/components/home/CompanionHero.tsx`, `src/components/companion/PilotPortrait.tsx` (responsive size prop).

**Batch A2 (name cleanup):** `supabase/migrations/*` (new — stop email-seeding display_name), `src/lib/welcome-email.functions.ts` (use preferred_name first, then a neutral fallback), grep-driven small edits to any component still reading `display_name`.

**Batch A3 (richer AI):** `src/lib/ai/context.server.ts`, `src/lib/ai/prompts.server.ts`.

**Batch A4 (portrait life):** `src/components/companion/PilotPortrait.tsx`, `src/styles.css` (new keyframes).

**Batch A5 (greeting variety):** `src/lib/greeting/context.ts`.

**Batch B:** UI-only edits to files surfaced by the audit; list finalized in the report.

**Batch C:** No code changes unless a P0 defect blocks launch — those become separate mini-batches.

**Batch D:** Add missing boundaries, empty states, and owner-alert hooks only where audit shows gaps.

---

## 4. Risks

- **A2 migration** — changing `handle_new_user` doesn't retroactively fix existing rows. Need a one-time UPDATE to null out `display_name` where it equals `split_part(email,'@',1)`.
- **A3 prompt changes** — richer context = more tokens. Must respect `has_ai_budget` and keep p50 latency <2s.
- **A4 animations** — layered blurs on iOS Safari can jank; will test on real device viewport before commit.
- **B fixes** — global spacing/typography changes risk regressions elsewhere; keep edits scoped to individual components.
- **Batch C** may surface Stripe/email issues that expand scope. If so, we stop and re-plan.

---

## 5. Recommended Implementation Order

Smallest, safest, most visible first:

1. **A1** — greeting fits on 375px (5-min visual win)
2. **A2** — kill "scubamike124" everywhere (trust win)
3. **A5** — greeting variety (cheap quality bump)
4. **A4** — portrait life (perceived polish)
5. **A3** — richer AI context (highest impact, highest risk)
6. **B**  — mobile audit → fix P0s → publish
7. **C**  — regression matrix → fix any P0s
8. **D**  — production-readiness gaps

Each batch: implement → typecheck → mobile Playwright verify → report → wait for "go" → next.

---

## 6. Out of Scope (confirmed postponed)

Fitbit, Oura, Apple Health, Smart Alarm, wearables, HRV, full AI avatar.

---

**Awaiting approval.** Reply "go A1" (or any batch) to begin. I will not touch code until then.
