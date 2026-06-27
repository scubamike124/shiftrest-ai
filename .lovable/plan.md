# RestPilot AI — Bundle Architecture Investigation

This is an investigation + proposed architecture only. No code will be written until you approve.

---

## Scope Reality Check

You've requested 5 bundles covering ~35 distinct features. Honest assessment:

- Bundles 1–3 are a natural fit for RestPilot AI (shift-worker rest coach) and reuse 70%+ of what already exists.
- **Bundle 4 (Business Workspace: Video Library, Brand Kit, Business Assets, Create Another Workflow)** and **Bundle 5 (Commercial Generator: business entry, website scan, scripts, motion consistency)** describe a **commercial/video-generation product**, not a rest/recovery app. These are a different product entirely — different DB schema, different AI models (video gen), different users, different pricing.

**Recommendation:** Drop Bundles 4 & 5 from RestPilot, or split them into a separate project. Trying to ship both inside one app will 3–5x the scope, dilute the brand, and break App Store category fit. The plan below proceeds with Bundles 1–3 only and flags 4–5 as out-of-scope pending your decision.

---

## Shared Foundation (used by all approved bundles)

One backend, three primitives — everything else composes from these:

1. **AI Context Service** (`src/lib/ai/context.server.ts`) — single function that assembles user context (prefs, shifts, wearables, fatigue, recent memory) for every AI call. Today this logic is duplicated across `coach`, `brief`, `insights`, `swap` routes.
2. **AI Memory Store** (new table `ai_memory`) — opt-in long-term facts the assistant has learned. Used by Smart Assistant, Companion Mode, Routine Learning, Daily Recommendations.
3. **Unified Scheduling/Notification Engine** — already exists (`src/lib/notifications/schedule.ts` + `run.server.ts` + pg_cron). Extend it; do not build a parallel system for alarms/reminders.

---

## Bundle 1 — Smart AI Foundation

| Feature | Implementation | Reuses |
|---|---|---|
| Smart AI Assistant | Upgrade `/api/coach` to use AI Context Service + memory recall | `coach.tsx`, `coach-personality.ts` |
| Custom AI Name | Add `assistant_name` to `user_prefs`; inject into system prompt | `prefs.ts` |
| AI Memory Engine (opt-in) | New `ai_memory` table + `memory.functions.ts` (write/read/forget); opt-in toggle in Profile | new |
| Companion Mode | Personality variant flag (`companion` \| `coach`) in prefs; same endpoint, different system prompt | `coach-personality.ts` |
| Learning Routines | Nightly cron summarizes last 7 days of shifts + sleep into 1–2 memory rows via Gemini | extends existing cron |
| Voice Interaction | Already have TTS (`/api/tts`) + `VoicePlayer`. Add Web Speech API STT in coach composer | `VoicePlayer.tsx` |
| Future AI Expansion | The Context Service + Memory Store ARE the expansion point — new features call them | — |

**DB:** 1 new table (`ai_memory`), 2 new columns on `user_prefs` (`assistant_name`, `assistant_mode`, `memory_enabled`).

---

## Bundle 2 — Daily Life Intelligence

All routed through the existing notification engine — no second scheduler.

| Feature | Implementation |
|---|---|
| Smart Alarm | New reminder kind `smart-wake` in `notifications/schedule.ts` + `copy.ts`; wakes 15–30 min before shift start, adjusted by fatigue score |
| Sleep Routine Assistant | Already 80% built (wind-down, blackout, caffeine). Add adaptive timing pulled from AI Memory |
| Commute Suggestions | Open-Meteo (already wired) + drive-time estimate based on saved location; surfaced in `/plan` and as a pre-shift notification |
| Productivity Coach | New `productivity-tip` reminder kind, fired mid-shift |
| Calendar & Reminders | New `user_events` table (id, user_id, title, at, kind, recurrence); feeds the same scheduler |
| Daily Recommendations | Extend `recommendations.ts`; render on home bento as a new card |

**DB:** 1 new table (`user_events`). 2 new notification kinds.

---

## Bundle 3 — UX Redesign

Single design pass, mobile-first, reuses current Midnight Indigo tokens.

| Feature | Implementation |
|---|---|
| Universal AI Search | New `<CommandPalette />` (cmdk) — searches shifts, employers, memories, playbooks; ⌘K on desktop, FAB on mobile. Powered by one new server fn `search.functions.ts` |
| Simplified Navigation | Collapse `BottomNav` from 5 → 4 tabs: Home, Plan, Coach, Profile. Move Playbooks/Swap/Share under Home cards |
| Homepage Redesign | Rework `routes/index.tsx` around 4 Creation Cards: **Plan Tonight**, **Log Shift**, **Ask Coach**, **Recovery Playbook** |
| Improved Dashboard | Keep circadian ring; add Today/Tomorrow/Recommendation strip above bento |

**DB:** none. Pure frontend.

---

## Affected Files (Bundles 1–3)

**New:** `src/lib/ai/context.server.ts`, `src/lib/ai/memory.functions.ts`, `src/components/CommandPalette.tsx`, `src/components/CreationCards.tsx`, `src/components/SmartWakeCard.tsx`, `src/routes/api/search.ts`, 3 migrations.

**Modified:** `coach.tsx`, `routes/api/coach.ts`, `routes/api/brief.ts`, `coach-personality.ts`, `prefs.ts`, `notifications/schedule.ts`, `notifications/copy.ts`, `run.server.ts`, `routes/index.tsx`, `BottomNav.tsx`, `routes/plan.tsx`, `routes/profile.tsx` (memory + assistant settings).

**Untouched:** Stripe/billing, wearables, auth, employers — already shipped and verified.

---

## Risks

1. **AI Memory privacy** — must be opt-in, user-deletable, never sent to model unless toggle is on. Add explicit consent UI + "Forget everything" button.
2. **Notification spam** — adding 3 new reminder kinds risks blowing past the daily cap. Need per-kind priority and stricter dedupe.
3. **STT in PWA** — Web Speech API is Chrome/Safari-only; iOS Safari support is partial. Voice input degrades to text input gracefully.
4. **Bundle 1 + 2 are deeply coupled.** Recommend shipping them together; shipping Bundle 1 alone leaves Smart Alarm/Routine learning half-wired.
5. **Bundle 3 navigation change** is a breaking UX shift for existing users — needs a one-time "What's new" sheet.

---

## Recommended Build Order

1. **Bundle 1** (foundation) — ~unblocks everything; 1 ship.
2. **Bundle 2** (built on Bundle 1's context + memory) — 1 ship.
3. **Bundle 3** (UI consolidation across new features) — 1 ship.
4. **One comprehensive QA cycle** across all three bundles before launch.

Three deploys, three verification passes — not 35.

---

## Decisions Needed From You

1. **Confirm Bundles 4 & 5 are out of scope** for RestPilot AI (or split into a separate project). They do not fit a rest/recovery app.
2. **Approve the shared foundation** (AI Context Service + Memory Store + reuse of existing notification engine).
3. **Approve the build order** (1 → 2 → 3, single QA at end).
4. **Confirm Companion Mode tone** — friendly companion vs. clinical coach vs. user-selectable (recommended).

Reply with approvals/changes and I'll begin Bundle 1.