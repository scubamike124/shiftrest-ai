## Pre-Launch Hardening & Launch Readiness — Investigation Plan

Investigation only. No code shipped until you approve. Typecheck runs after each step. Plan is sequenced so blocking work (security, privacy) happens before polish (UX, accessibility) and observability (monitoring).

---

### Phase 1 — Security Audit

**Current state**
- Auth: Supabase email/password + Google OAuth via Lovable broker. `_authenticated/route.tsx` gates protected subtree. `requireSupabaseAuth` middleware on server fns. Bearer attached via `attachSupabaseAuth` in `src/start.ts`.
- RLS: 20 tables, all have policies per `<supabase-tables>`. `has_role` / `has_active_subscription` / `has_ai_budget` are SECURITY DEFINER with locked `search_path`. No client-side admin/role checks found.
- Secrets: only publishable keys in `.env`. Service role, Stripe, VAPID, Lovable AI keys in Supabase secrets vault.
- Webhooks: Stripe webhook + Fitbit/Oura callbacks under `/api/public/*` (auth-bypass prefix). Need to verify each does signature/state validation.
- No `dangerouslySetInnerHTML` user content (only shadcn `chart.tsx` for CSS injection — safe).
- No raw SQL string concatenation — all queries go through Supabase client (parameterized).

**Missing / to verify**
1. Run `supabase--linter` + `security--run_security_scan` for unknown findings.
2. Confirm every `public.*` table has GRANTs matching its policies (audit all 20 migrations).
3. Audit Stripe webhook (`/api/public/payments/webhook`) for raw-body HMAC + timing-safe compare.
4. Audit wearable OAuth callbacks for `state` validation (CSRF on OAuth).
5. Audit cron endpoints (`ai-learn`, `notify`, `wearables/cron`) for shared-secret header check.
6. Confirm `supabaseAdmin` is never imported at module scope of `*.functions.ts` / route files.
7. Confirm no protected serverFn lacks `requireSupabaseAuth` (would be public endpoint).
8. Rate limiting: none today. Add per-user token bucket on `/api/ai`, `/api/tts`, `/api/coach`, `/api/brief`, `/api/swap` (Supabase table or in-memory KV — investigate).
9. Input validation: audit every `inputValidator` for Zod schemas with bounds. `/api/tts` already caps 4000 chars; check the rest.
10. No file uploads exist (no storage buckets) — N/A.
11. Audit log: `ai_log` + `notification_log` exist; need a generic `audit_log` for auth events, deletions, exports, role changes.
12. Verify `consent_json` writes are append-only (legal_acceptances) — already audit-logged.

**Files in scope (no edits this phase)**: `src/routes/api/public/payments/webhook.ts`, `src/routes/api/public/wearables/*`, `src/routes/api/public/hooks/*`, `src/routes/api/{ai,tts,coach,brief,swap,insights}.ts`, all `*.functions.ts`, all migrations.

**Risk**: rate-limiting design choice (DB vs. in-memory) affects cost & latency. Audit log schema change is a new migration.

---

### Phase 2 — Privacy & Compliance Verification

**Current state (built in legal rollout)**
- Signup checkbox + `recordAcceptanceFn({source:'signup'})`.
- Onboarding consent slide with required checkboxes.
- Cookie banner + `user_prefs.consent_json`.
- `exportAccountFn`, `purgeAiMemoryFn`, expanded `deleteAccountFn` (Stripe cancel + 18-table purge + retention manifest).
- SafetyNote / RenewalDisclosure / OfflineBanner disclosures.

**To verify (Playwright end-to-end on test account)**
1. Signup → confirm `legal_acceptances` row inserted + `consent_json` populated.
2. Onboarding completion → 5 doc rows logged with `source='onboarding'`.
3. Cookie banner: Accept all / Reject / Manage each persist to localStorage + (signed-in) `consent_json.cookies`.
4. Profile → Export downloads JSON containing all 18 user-owned tables, tokens redacted.
5. Profile → Erase AI memory → 4 tables emptied, shifts/prefs untouched.
6. Profile → Delete account → Stripe sub canceled, 18 tables purged, `subscriptions` + `legal_acceptances` retained, `auth.admin.deleteUser` succeeds, redirect to `/auth`.
7. Disclosure copy matches `/legal/privacy` retention clause.

**Files (no edits unless gaps found)**: `src/routes/auth.tsx`, `src/components/Onboarding.tsx`, `src/lib/account.functions.ts`, `src/lib/legal/consent.functions.ts`, `src/components/legal/CookieBanner.tsx`.

**Risk**: test account must be created; deletion is irreversible.

---

### Phase 3 — Performance

**Investigation**
1. Run Lighthouse (mobile + desktop) on `/`, `/dashboard`, `/paywall`, `/pricing`.
2. Bundle analysis: `bun run build` + visualize chunks; flag any >250 kB route chunk.
3. Image audit: ensure every `<img>` has `loading="lazy"` + width/height; LCP image gets `fetchpriority="high"` + preload.
4. React Query: confirm `staleTime` set on heavy queries (AI brief, recommendations); avoid refetch storms.
5. DB indexing: review hot paths — `ai_log(user_id, created_at)`, `ai_recommendations(user_id, status, created_at)`, `shifts(user_id, starts_at)`, `notification_log(user_id, created_at)`, `wearable_readings(user_id, recorded_at)`. Add missing indexes via migration.
6. API latency: check Lovable AI gateway timeouts; ensure long calls stream or move to background.
7. Caching: PWA app-shell already in place; verify `Cache-Control` headers on static assets.
8. CDN: Lovable's published edge handles this — no action.

**Files (likely)**: `vite.config.ts`, route `head()` blocks, single migration for indexes.

**Risk**: index migration on populated tables can lock briefly — use `CREATE INDEX CONCURRENTLY` where possible (not allowed inside a transaction; investigate migration runner support).

---

### Phase 4 — Accessibility

**Investigation**
1. Automated: run axe-core via Playwright on every top-level route.
2. Manual: keyboard tab order through `/auth`, onboarding, dashboard cards, paywall.
3. Color contrast: audit `text-muted-foreground` + glow buttons against `bg-background` token. Confirm no arbitrary `text-gray-*` classes (codebase uses semantic tokens — already good).
4. Icon-only buttons: audit BottomNav, sidebar, card chevrons for `aria-label`.
5. `<main>` landmark: confirm exactly one per page (root layout vs. routes).
6. Focus indicators: confirm shadcn `focus-visible` rings not overridden.
7. Font scaling: confirm dashboard doesn't break at 200% zoom (recent 146px overflow fix relevant).
8. Reduced motion: respect `prefers-reduced-motion` for circadian dial + aurora animations.

**Files (likely edits)**: BottomNav, ArrivalHero, LongClock animations, dashboard card icon buttons.

**Risk**: low — mostly attribute additions.

---

### Phase 5 — Production Monitoring

**Current state**
- `reportLovableError` in `src/lib/lovable-error-reporting.ts` captures via `window.__lovableEvents`. Wired into React error boundary?  → verify.
- Server-side: console.error only. No structured server logs to a sink.
- `ai_log` table tracks AI requests; `notification_log` tracks pushes.

**Missing**
1. Confirm a root `ErrorBoundary` calls `reportLovableError`.
2. Add window `error` + `unhandledrejection` handlers (mechanism=onerror / unhandledrejection).
3. Add `audit_log` table for: signup, signin, signout, delete, export, role grants, subscription changes, webhook failures.
4. Document Lovable Cloud's built-in uptime + backup posture (no custom action; surface in launch report).
5. Define alerting thresholds (AI 5xx > X/min, webhook failure, deletion errors).
6. Document incident response runbook in `docs/runbook.md`.

**Files**: new `audit_log` migration + helper, `src/routes/__root.tsx` global error handlers, new `docs/runbook.md`.

**Risk**: alert routing depends on Lovable Cloud notification primitives — investigate.

---

### Phase 6 — AI System Validation

**Per surface — verify failure, retry, offline, timeout, fallback**
- `/api/ai` orchestrator (all intents)
- `/api/coach` streaming
- `/api/brief` Gemini
- `/api/tts` OpenAI TTS
- `/api/swap`
- `/api/insights`
- `CompanionWhisper`, `RightNowCard`, `SmartAlarmCard`, `LongClock`, `AIBriefCard`, `TomorrowPreviewCard`, `DailyReviewCard`, `WearableCard`

**Test matrix**
1. Network offline → all cards fall back to snapshot via `OfflineBanner`/cache.
2. Gateway 429/402 → human error string via `mapUpstreamError`; UI shows retry, not raw error.
3. Gateway 500 → no infinite retry; React Query `retry: 1`.
4. AI returns malformed JSON → server `jsonMode` + safe parse; UI shows "couldn't load" state.
5. Budget exceeded (`has_ai_budget=false`) → friendly upsell/snooze message.
6. Wearable token expired → silent refresh; if refresh fails, UI prompts reconnect, no crash.
7. Voice TTS audio fetch fails → `VoicePlayer` shows error chip, transcript still readable.

**Files (likely)**: small UX fixes in the listed components if any state path is missing.

**Risk**: stress tests may surface missing error states needing UI work — scoped per finding.

---

### Phase 7 — UI/UX Polish

**Investigation**
- Loading skeletons present on dashboard cards? (audit each)
- Empty states: no shifts, no wearables, no AI memory, no recommendations
- Error states: every `useQuery` has an `error` branch
- Mobile (375px) responsiveness sweep — recent overflow fix on `/dashboard`; re-audit `/plan`, `/playbooks`, `/memory`, `/decisions`, `/events`, `/profile`
- Animation: respect `prefers-reduced-motion`; consistent easing
- Visual consistency: spacing tokens, button variants, card chrome
- Navigation: BottomNav vs sidebar parity; deep-link back-nav works

**Files**: per-finding component edits.

**Risk**: scope creep — limit to concrete defects, not aesthetic preferences.

---

### Phase 8 — Beta Readiness Checklist

Deliver `docs/beta-test-matrix.md`:
- Devices: iPhone (Safari iOS 17/18), Android (Chrome), Windows (Edge/Chrome/Firefox), macOS (Safari/Chrome/Firefox)
- Core journeys: signup → onboarding → dashboard → plan → smart alarm → companion → wearable connect → paywall checkout → portal → delete
- PWA install: home-screen install on iOS Safari + Android Chrome; offline mode works after install
- Regression: legal flows, consent, export, delete, push notifications, wearable cron

---

### Phase 9 — Launch Readiness Checklist

Deliver `docs/launch-checklist.md`:
- Env vars present in prod (Stripe live keys, VAPID, Lovable AI, Supabase secrets — already configured)
- `PAYMENTS_LIVE_WEBHOOK_SECRET` wired to live endpoint; `STRIPE_LIVE_API_KEY` test charge confirmed
- DB: production migrations applied, no pending in `supabase/migrations`
- Email delivery: Supabase auth emails configured; transactional from custom domain
- Monitoring + alerts active (Phase 5 deliverable)
- Analytics: confirm cookie-banner-gated; respect Reject
- Domain: `shift-rest-ai.lovable.app` live; custom domain status TBD with user
- SSL: handled by Lovable edge
- Backups: Supabase managed daily; document RPO/RTO
- Incident response: runbook from Phase 5

---

### Deliverables (markdown reports in `docs/launch/`)

1. `security-report.md`
2. `privacy-verification-report.md`
3. `performance-report.md`
4. `accessibility-report.md`
5. `launch-readiness-report.md`
6. `production-checklist.md`
7. `remaining-issues.md`

---

### Investigation answers

- **Files to be modified (across all phases)**: route files under `src/routes/api/*` (input validation + rate limiting), `src/routes/__root.tsx` (global error handlers), select component files for a11y + error states, `vite.config.ts` (bundle analysis only — no behavior change), `src/components/site/*` (a11y polish).
- **Migrations**: up to 3 — `audit_log` table, missing performance indexes, optional `rate_limit_buckets` table.
- **Edge functions**: none — TanStack server fns / routes only.
- **Stripe impact**: webhook verification audit only; no API changes.
- **Auth impact**: none planned; sign-out hygiene re-verified.
- **Testing**: Playwright smoke per phase; typecheck after every change; manual cross-browser per Phase 8.

---

### Proposed execution order (after approval)

1. **Phase 1 — Security Audit** (run scanners, fix any critical findings, add rate limiting + audit log).
2. **Phase 2 — Privacy Verification** (Playwright sweep against test account).
3. **Phase 5 — Production Monitoring** (error handlers + audit log + runbook).
4. **Phase 6 — AI System Validation** (failure-mode UX fixes).
5. **Phase 3 — Performance** (indexes + Lighthouse).
6. **Phase 4 — Accessibility** (axe + manual sweep).
7. **Phase 7 — UI/UX Polish**.
8. **Phase 8 — Beta Matrix** (doc).
9. **Phase 9 — Launch Checklist** (doc + final go/no-go report).

Awaiting approval to begin **Phase 1 — Security Audit**.
