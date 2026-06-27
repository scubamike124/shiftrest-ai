# Pre-Launch Validation Plan (Blocking)

Goal: prove RestPilot AI is production-ready by running real audits against the published build, fixing every issue surfaced, and producing the seven deliverables below. No new features until this phase closes.

Target URL for all live tests: `https://shift-rest-ai.lovable.app` (production). Local Playwright runs hit `http://localhost:8080` for authenticated flows where the managed Supabase session is injected.

---

## Step 1 — Lighthouse Audit

Tooling: `lighthouse` CLI (installed on demand via `nix run nixpkgs#lighthouse`) against production URL, mobile + desktop presets, on the four key routes: `/`, `/dashboard`, `/paywall`, `/legal`.

Capture JSON + HTML reports into `docs/launch/audits/lighthouse/`. Record per-category scores and the top opportunities/diagnostics.

Fix bar before moving on:
- Performance ≥ 90 mobile on `/` and `/dashboard`
- Accessibility ≥ 95 on every audited route
- Best Practices ≥ 95
- SEO ≥ 95

Likely fix areas (apply only if flagged): image dimensions/`loading="lazy"`, preconnect for fonts, render-blocking CSS, missing `lang`, MIME warnings, console errors in prod.

Deliverable: `docs/launch/audits/lighthouse-report.md` summarizing scores, fixes applied, and links to raw reports.

---

## Step 2 — Accessibility Audit (axe)

Tooling: `@axe-core/cli` via `bunx` (or Playwright + `axe-core` injected) against `/`, `/dashboard`, `/auth`, `/paywall`, `/legal`, `/memory`, `/decisions`, `/profile`.

Manual checks: tab through each route headlessly via Playwright, verify focus rings, skip-link behavior, dialog focus trap, heading order (`h1` once), form label associations, color contrast on muted text, ARIA on custom widgets.

Fix every Critical + Serious finding; document Moderate/Minor with rationale if deferred.

Deliverable: `docs/launch/audits/accessibility-report.md` (supersedes the placeholder) with raw axe JSON in `docs/launch/audits/axe/`.

---

## Step 3 — Playwright E2E Regression

Test account: rely on `LOVABLE_BROWSER_AUTH_STATUS=injected` Supabase session. For unauthenticated flows (signup, password reset, email verify, consent banner), drive fresh contexts.

Suite organized under `tests/e2e/` (Playwright Python scripts in `/tmp/browser/` per sandbox conventions, then committed where reusable):
- Auth: signup → consent acceptance → email verify path → login → logout → password reset request
- Billing: open `/paywall`, start checkout in **sandbox** env first, verify embedded session loads; live charge handled in Step 4
- Subscription mgmt: upgrade, downgrade, cancel, portal redirect
- Account: export data, purge AI memory, delete account (uses disposable test user)
- AI surfaces: Smart Alarm card render + accept/snooze, Right Now card, Companion Whisper, Long Clock interactivity, Tomorrow Preview feedback chips
- Wearables: connect flow stubs (verify "coming soon" copy where applicable, OAuth start URL builds)
- Offline: toggle `context.set_offline(True)`, verify `OfflineBanner` + cached plan render, reconnect sync
- Consent + legal: first-visit cookie banner, granular toggles persist, every `/legal/*` route 200s with required sections
- Error handling: 404 route, forced server error returns friendly boundary

Capture screenshots per step; failing assertions block the phase until fixed.

Deliverable: `docs/launch/audits/playwright-report.md` with pass/fail matrix + screenshot links.

---

## Step 4 — Live Stripe Verification

Single $1 real charge on a temporary live price (created via `payments--create_price` if needed, deleted after). Use a disposable test card on a real consumer card the user owns — confirm with the user before charging.

Verify in order:
1. Embedded checkout completes
2. `customer.subscription.created` webhook lands at `/api/public/payments/webhook?env=live` (check `subscriptions` row inserted via `supabase--read_query`)
3. Receipt email arrives
4. Portal cancellation → `customer.subscription.updated` with `cancel_at_period_end=true` → row updated
5. Refund the test charge in Stripe to clean up

Deliverable: `docs/launch/audits/stripe-live-verification.md` with timestamps, event IDs (redacted), and DB row snapshots.

> Requires user go-ahead before running — flagged in closing message.

---

## Step 5 — Cross-Device Testing

Playwright device emulation covers: iPhone 14 Safari, Pixel 7 Chrome, iPad Pro, desktop Chrome/Firefox/Edge/Safari (WebKit). Real-device pass left to user; we provide a structured checklist and screenshots from emulated runs.

Routes exercised on each device: `/`, `/auth`, `/dashboard`, `/paywall`, `/legal`, `/memory`. Assertions: no horizontal scroll, nav reachable, primary CTAs tappable (≥44px), forms submit, AI cards render.

Deliverable: `docs/launch/audits/cross-device-report.md` with screenshot grid + outstanding real-device asks for the user.

---

## Step 6 — Final Security Verification

Run `supabase--linter` and `security--run_security_scan`. Confirm only the two intentional advisories (`pg_cron` in `public`, `authenticated` EXECUTE on `has_ai_budget`/`has_active_subscription`) remain. Spot-check:
- RLS on every public table (`SELECT relname FROM pg_class WHERE relrowsecurity=false AND relnamespace='public'::regnamespace`)
- Webhook signature verification (`verifyWebhook` HMAC + 5-min window) unchanged
- `supabaseAdmin` only imported inside `.server.ts` or lazy `await import` in route handlers
- No new secrets logged; `fetch_secrets` matches expected set
- CSP / security headers (audit `__root.tsx` head + edge defaults) — add `Strict-Transport-Security`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy` via meta if missing

Add minimal rate limiting on `/api/coach`, `/api/ai`, `/api/tts` if absent (in-memory token bucket keyed by `userId` from middleware).

Deliverable: `docs/launch/audits/security-final-report.md`.

---

## Step 7 — Launch Checklist Sign-Off

Walk every item the user listed against the live build; produce a single signed checklist at `docs/launch/launch-checklist.md`:
- Legal: Privacy, Terms, Cookie, AI disclaimer, Health disclaimer (link audit via script)
- User controls: Delete account, Export data, Erase AI memory (Playwright-verified in Step 3)
- Consent: Cookie banner shows on fresh session, choices persist
- Observability: `reportLovableError` paths fire, `ai_log`/`notification_log`/`legal_acceptances` writing
- Backups: confirm Lovable Cloud daily backups noted; user-initiated export verified
- Support: footer links resolve; mailto / help URL present
- Env vars: cross-check `fetch_secrets` against `production-checklist.md`

---

## Technical Notes (for the dev)

- Playwright launches: `headless=True`, viewport `1280x1800`, screenshots only when needed, never `full_page=True`.
- Lighthouse runs headless Chrome with `--preset=desktop` and default mobile; throttle defaults left as-is for comparability.
- All audit artifacts land under `docs/launch/audits/` (new). Existing `docs/launch/*.md` reports get updated in place to reflect measured (not assumed) results.
- Fixes that affect runtime go through normal file edits; no schema changes expected. Any new migration must follow the public-schema grants rule.
- This phase is execution-only — no new features, no UX redesigns. If a finding requires a feature change, log it in `docs/launch/remaining-issues.md` and surface to the user instead of silently scoping in.

---

## Order of Execution

1. Step 6 first (cheap, blocks everything if RLS regression found)
2. Step 1 + Step 2 in parallel (read-only against prod)
3. Step 3 (longest; fix loop)
4. Step 5 (reuses Playwright infra)
5. Step 7 checklist sweep
6. Step 4 last — requires explicit user approval to charge a real card

I'll pause for your approval, then begin with Step 6 and proceed through the list, stopping only at Step 4 to get your go-ahead for the live charge.
