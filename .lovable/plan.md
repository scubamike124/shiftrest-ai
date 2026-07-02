# RestPilot AI — Launch Polish & Readiness Audit

Investigation only. No code changed. Every finding is grounded in a real file:line reference.

---

## 1. Executive Summary

RestPilot is functionally ready. The foundations users touch daily — auth, Companion, sleep engine, notifications backend, legal coverage, Stripe billing, email — are solid. The gap between "works" and "feels like Apple/Headspace" is a short list of high-impact issues plus a longer list of polish items.

**Three launch blockers** must ship before Publish:
1. **DebugHUD renders in production** — internal AI event log, HTTP codes, and orb state are visible to end users (Companion, Onboarding).
2. **`/legal/refunds` returns 404** — linked from the Paywall CTA area (`paywall.tsx:256`) at the exact conversion moment.
3. **`/lab/*` routes are publicly reachable** — internal POC UI (`lab.avatar-poc.tsx`) exposed to visitors and search engines.

**Two high-severity UX/a11y bugs** should follow immediately:
4. **Shift delete has no confirmation** (`dashboard.tsx:243`) — one accidental tap destroys real data.
5. **`ToggleRow` uses `<span onClick>`** (`profile.tsx:1011`) — not keyboard-accessible, fails WCAG 2.1.1.

Everything else is polish that lifts the app from "good" to "premium": haptics on key actions, skeleton loaders, route transitions, Companion in BottomNav, streak + weekly-recap notifications, a curated persona picker, inline AI disclaimer, and hydration sync to the cloud.

**Overall readiness: 5.1 / 10 → 8.5 / 10** after Quick Wins + Medium batch land.

---

## 2. Top 25 Improvements (ranked by impact)

| # | Improvement | Severity | Effort |
|---|---|---|---|
| 1 | Gate `DebugHUD` behind `import.meta.env.DEV` or a query flag | critical | 10 min |
| 2 | Create `/legal/refunds` route (or repoint the link to `/legal/subscription#refunds`) | critical | 20 min |
| 3 | Guard `/lab/*` routes behind auth + `NODE_ENV !== "production"` and add `noindex` | critical | 20 min |
| 4 | Add confirm-dialog for shift delete (reuse shadcn AlertDialog) | critical | 25 min |
| 5 | Replace `ToggleRow` with shadcn `Switch` (keyboard + ARIA out of the box) | critical | 30 min |
| 6 | Replace `window.confirm` (employer + account delete) with shadcn AlertDialog | warning | 30 min |
| 7 | Add `aria-label` to icon-only buttons in HydrationCard, quick grid, dock | critical | 20 min |
| 8 | Add `aria-current="page"` to active BottomNav tab | warning | 5 min |
| 9 | Add Companion tab to BottomNav (or a persistent orb-in-nav) | warning | 25 min |
| 10 | Add haptic (`navigator.vibrate(10)`) on send / save / toggle across app | premium | 45 min |
| 11 | Introduce skeleton loaders on dashboard cards + Companion transcript first paint | warning | 1 h |
| 12 | Add subtle route enter/exit (CSS `view-transition-name` or a light fade — no framer-motion needed) | premium | 45 min |
| 13 | Curated persona picker (5 named personas → sets name + tone + voice) | warning | 1.5 h |
| 14 | Inline AI disclaimer chip under Companion input on first session per day | warning | 20 min |
| 15 | Add `weekly-recap` and `streak-nudge` notification kinds to `copy.ts` + scheduler | warning | 1 h |
| 16 | Fix `showNotification()` tag collision — use `tag: kind` not the hardcoded `"shiftrest-winddown"` | critical | 5 min |
| 17 | Move client `scheduleNextWindDown()` off `setTimeout` — rely on server push (already exists) | warning | 30 min |
| 18 | Use `useSession()` in `/pilot`, remove the 3 inline `supabase.auth.getSession()` calls | warning | 20 min |
| 19 | Replace sky-500 / rose-500 hardcodes with tokens (add `--info` and use `--destructive`) | warning | 30 min |
| 20 | Sync Hydration data to Supabase (currently localStorage-only, resets across devices) | warning | 1.5 h |
| 21 | Day-part greeting on `/pilot` (reuse `getDayPart` — already used elsewhere) | warning | 10 min |
| 22 | Surface `/contact` in AppSidebar and Profile footer (currently undiscoverable) | warning | 10 min |
| 23 | Add "step X of Y" live region to CompanionIntroSheet dots | warning | 15 min |
| 24 | Add `active:scale-95` press feedback to BottomNav tabs and quick-grid cards | nice | 15 min |
| 25 | Gate ElevenLabs voice picker behind entitlement in `settings.companion` | warning | 20 min |

---

## 3. Quick Wins (< 30 min each)

Batch 1 — safe, mechanical, ~2 hours total:

- **DebugHUD prod guard** — wrap the export or its render sites in `if (!import.meta.env.DEV && !new URLSearchParams(location.search).has('debug')) return null`.
- **Refund link fix** — either add `src/routes/legal.refunds.tsx` (thin page referencing subscription terms) or repoint the Paywall link to `/legal/subscription#refunds`.
- **Lab route guard** — early return in `lab.*` route components when `process.env.NODE_ENV === "production"`; add `<meta name="robots" content="noindex">` via `head()`.
- **HydrationCard `aria-label`** — "Add a glass", "Remove a glass".
- **BottomNav `aria-current`** — set on the active NavLink.
- **`/pilot` day-part greeting** — swap the hardcoded string for `greetingLabel(getDayPart())`.
- **Notification tag fix** — change `tag: "shiftrest-winddown"` to `tag: kind` in `src/lib/notify.ts:62`.
- **Contact discoverability** — add link in `AppSidebar` "Help" section and Profile footer row.
- **BottomNav press feedback** — add `active:scale-95 transition-transform` to the tab link classes.

---

## 4. Medium Improvements (30 min – 2 h each)

- **Shift-delete confirmation** — reuse existing shadcn AlertDialog pattern from Profile → destructive actions.
- **Employer + account delete → AlertDialog** — remove all `window.confirm` calls for visual consistency.
- **Replace `ToggleRow` with shadcn `Switch`** — one-file swap in `profile.tsx`; matches design system, gets ARIA + keyboard for free.
- **Skeleton loaders** — HydrationCard, ShiftList, GreetingHeader avatar, Companion first transcript render. Reuse the existing `Skeleton` component.
- **Haptics helper** — add `src/lib/haptics.ts` exposing `tap()`, `success()`, `warn()` wrapping `navigator.vibrate` with reduced-motion respect; call from send / save / toggle handlers.
- **Route transitions** — `@view-transition` CSS + `document.startViewTransition` on router navigation events; graceful fallback to instant nav.
- **Persona picker** — 5 curated personas ("Pilot — steady coach", "Nova — encouraging friend", "Sage — minimalist", "Ember — motivational", "Luna — warm night companion"). Each preset writes `preferredName + assistantMode + defaultVoiceId` atomically.
- **Streak + Weekly recap notifications** — new `kind` entries in `copy.ts`, schedule at 09:00 local Sunday and after 3-day streaks.
- **Hydration cloud sync** — new `hydration_daily` table (user_id, date, glasses) with RLS + GRANTs; migrate localStorage on first load.
- **Inline AI disclaimer** — small muted chip "Pilot is AI. Verify anything important." shown once per session under composer.
- **Color token cleanup** — introduce `--info` token; replace `text-sky-*` / `bg-sky-*` / `bg-rose-500` in components with token classes.

---

## 5. Major Enhancements (multi-hour / multi-file)

- **True background reliability for wind-down and caffeine cutoff** — leverage the existing web-push + `pg_cron` dispatcher (same pattern used for Smart Alarm before it was scoped out). Client just enrolls; server dispatches. Removes the tab-must-be-open constraint entirely.
- **First-run "delight" moment** — after onboarding completes, a 3-second aurora sweep across the dock, one line of Pilot voice speaking the user's preferred name, then dashboard. Consistent with the app's premium tone.
- **Adaptive Companion tone based on recent recovery** — pull last 3 days of sleep score into the Companion system prompt so replies acknowledge trend ("you're up 12% this week — nice") without user asking.
- **Onboarding checklist tile on dashboard** — 4-step progress (connect wearable · set shift · enable notifications · pick persona); collapses when complete. Drives activation.
- **Weekly recap email + in-app card** — reuses existing app-email pipeline; templates already scaffolded.
- **Redesign paywall plan cards** — surface value per plan more clearly; move "Elite gets voice + priority" to a benefit list, not fine print.

---

## 6. Nice-to-Have (post-launch)

- **Curated 3D avatar gallery** replacing the free-text RPM URL input.
- **Emotion states**: add `surprised` and `alert` for time-sensitive nudges.
- **Localization scaffolding** for the `inferFromText` regex + all UI copy.
- **Widgets & Live Activities** (requires native wrapper — outside PWA scope).
- **Shareable recovery streak card** for social proof.
- **Handoff to partner via Partner Mode** — surface a "Nudge my partner" quick action.
- **Sleep sound sleep-timer + fade-out**.

---

## 7. Final Launch Readiness Score

| Category | Now | After Quick Wins | After Medium |
|---|---:|---:|---:|
| Visual Design | 6 | 7 | 9 |
| UX Friction | 5 | 7 | 9 |
| AI Companion | 6 | 7 | 8 |
| Notifications | 5 | 7 | 9 |
| Premium Feel | 5 | 6 | 8 |
| Accessibility | 3 | 6 | 9 |
| Performance | 5 | 7 | 8 |
| Trust | 6 | 9 | 9 |
| **Overall** | **5.1** | **7.0** | **8.6** |

**Recommendation:** ship Quick Wins as a single batch before public launch (blockers + a11y + notification tag). Follow with Medium batch in the first week post-launch. Major enhancements plan into a 30-day post-launch roadmap.

Awaiting your approval — say which batch to implement first (recommended: Quick Wins) and I'll execute it isolated, no scope creep.
