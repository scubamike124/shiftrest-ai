# RestPilot QA report: automated quality assurance system

Started 2026-11-14, updated 2026-11-15. Source: `scubamike124/shiftrest-ai`, branch `codex/restpilot-railway-migration`.

**Bottom line.**
- **Every PR now gets CI:** the web suite covers the product end to end, and every pull request runs lint, typecheck, unit tests and a build.
- **Four regressions found:** two are fixed (R1 and R4 on the Railway branch); the R4 port to main waits for the owner's approval to merge (#38).
- **Not yet tested:** live AI quality (no key yet), payments (parked or blocked) and native iOS flows (written; CI run pending).

## 1. What is installed, and where

| Layer | Tool | Location | Runs |
|---|---|---|---|
| Fast PR checks | ESLint (changed lines), `tsc`, `node --test`, production build plus server smoke | `.github/workflows/qa-fast.yml`, `scripts/qa/lint-changed.mjs` | Every PR, and every push to the Railway branch |
| Web regression | **Playwright 1.63** | `tests/e2e/` (config, specs, hermetic backend) | PR smoke: `qa-e2e.yml`. Comprehensive: label `qa:full` or `release`, PRs into `main`, or manual dispatch |
| AI quality | **Promptfoo 0.125.1** with the AI agent's 134-case benchmark (#18) | `tests/ai/companion/` (cases, providers, judge), `tests/ai/run-evals.mjs` (CI wrapper), `tests/ai/companion/lib/guard.cjs` (spend cap and cache) | `ai-evals.yml`: offline self-test plus smoke on PRs that touch AI paths; full and consistency runs on demand or in the comprehensive run |
| iPhone app | **Maestro** on the free `macos-15` runner | `.maestro/*.yaml`, `.github/workflows/ios-maestro.yml` | PRs touching `ios-app/`, `.maestro/` or native code; the comprehensive run |
| Native plugins | XCUITest, from the native agent (#13) | `ios-e2e/`, `ios-native-e2e.yml` | Native PRs |

DeepEval was not added. Promptfoo covers model comparison, deterministic assertions, LLM rubrics, consistency repeats and the cost reporting the owner asked for, so no gap needed a second framework.

### How the web suite stays safe
**Staging uses the same Supabase project as production** (`czsgjqfcjiuqirvmdlps`; the staging bundle shows it). Signed-in journeys therefore never run against staging. They run against `tests/e2e/support/fake-backend.mjs`, which provides:
- a GoTrue and PostgREST stand-in with per-user row isolation;
- a same-origin proxy, so the app's real CSP stays enforced;
- a TLS fake of the OpenAI-compatible model.

Each test gets a fresh seeded user. Nothing leaves the runner.

Against staging and production, only GET-only `@readonly` tests run: no sign-ups and no writes. Production runs `main` through Lovable, so its results are informational only.

### How AI spend is capped
- Every model call and every judge call goes through `guarded()`. It reserves the worst case before sending, refuses any call that would cross `RESTPILOT_EVAL_MAX_TOKENS`, and refuses all paid calls when no cap is set.
- Default caps: smoke 120k tokens, full suite 1.5M, the benchmark (`run.mjs`) 3M.
- Responses are cached on disk, and the CI cache is restored between runs.
- A missing key is reported as **BLOCKED** and never counted as a pass.

## 2. Features tested (web)

**Current local run:** Chromium at desktop, iPhone SE, iPhone 15 and iPhone 15 Pro Max, on a build of base `b309f5cb` (after #36):
- 456 passed;
- 0 product failures (the 4 failures were R1's expected-failure markers, which started passing once #36 landed; the markers are now ordinary guard tests);
- 188 skipped. These are mostly mobile-only tests on desktop and desktop-only tests on mobile, plus API tests that run in one project only.

**CI PR smoke** (Chromium desktop and iPhone 15): 65 passed, 19 skipped. WebKit runs only in the comprehensive CI job; Playwright browsers are not installed on this machine by design.

| Area | Specs | Status |
|---|---|---|
| Marketing, features, science, contact, sound mixer (public) | `public/marketing.spec.ts` | Pass |
| All 15 legal pages; `/privacy` and `/terms` redirects; 404 | `public/marketing.spec.ts` | Pass. **R3** is annotated. |
| CSP and security headers, manifest, service worker, robots, sitemap | `public/marketing.spec.ts`, `api/api-contract.spec.ts` | Pass |
| Sign-up (terms required), sign-in, wrong password, protected-page redirect and return, forgot password, sign-out, Google offered on the web | `app/auth.spec.ts` | Pass. **R2** is an expected failure. |
| Dashboard: brief, week, recovery, water | `app/core-journeys.spec.ts` | Pass |
| Shift scheduler: log a shift (persisted), rotation and employer settings, shift-swap copilot | `app/core-journeys.spec.ts` | Pass |
| AI companion ("Lisa"/Aura) chat end to end; voice controls on `/companion` and `/pilot`; coach chat; AI decisions | `app/core-journeys.spec.ts` | Pass (against the fake model) |
| Sleep planner, calendar (add event), playbooks, health and wearables, safety centre | `app/core-journeys.spec.ts` | Pass |
| Sound mixer: presets, sounds, timer, saving a mix | `app/core-journeys.spec.ts` | Pass |
| Settings: companion, avatar, morning brief, skills, profile; saving personality and the brief | `app/settings-privacy.spec.ts` | Pass |
| Appearance and themes | `app/settings-privacy.spec.ts` | **Blocked:** no theme control on the branch yet (#33 is open). The test turns on by itself once one exists. |
| Privacy: export JSON (own data only), delete a single memory, erase all AI memory, account deletion (typed DELETE; data and auth user removed), keep account, cookie consent | `app/settings-privacy.spec.ts` | Pass |
| Pricing: no lifetime offer on `/pricing` or `/paywall`; subscription terms | `public/pricing.spec.ts` | Pass |
| Pricing: $7.99 monthly, $49.99 annual, 14-day trial | `public/pricing.spec.ts` | **Blocked:** the Railway build shows "App preview" with no prices. The StoreKit file (#27) does carry $7.99, $49.99 and a 2-week trial, with no lifetime product. |
| Stripe checkout in test mode | `app/stripe-checkout.spec.ts` | **Parked by owner** (website Stripe is on hold, #21). Live keys are refused outright. |
| Offline: page reopens from the service worker; dashboard offline banner | `app/offline-resilience.spec.ts` | Pass (Chromium) |
| AI resilience: model down; model JSON drift | `app/offline-resilience.spec.ts` | Pass (R1 is fixed by #36) |
| **Every HTTP API**: auth gates, cron hooks fail closed, unsigned webhooks rejected, public endpoints, signed-in AI intents, oversized body, TTS/STT fallbacks, OAuth callbacks | `api/api-contract.spec.ts` (43 tests) | Pass (R4 is fixed by #31) |
| No horizontal overflow on 16 public and 21 signed-in routes at iPhone SE, 15 and 15 Pro Max; zoom allowed; bottom navigation | `mobile/overflow.spec.ts` | Pass |

## 3. iPhone app (Maestro)

All flows run against the hermetic stack on the macOS runner. The simulator build points at it through a CI-only `server.url` plus `NSAllowsLocalNetworking`.

| Flow | Tag | Status |
|---|---|---|
| Launch to the home screen | core | Written. The first CI run failed in the web build (V8 heap) before any flow ran; the heap was raised in `a92aa74e` and the run is pending. |
| Sign-in screen (no Google button, no Safari install prompt; #6) | core | Same |
| Sign in, then Plan, Events, Profile, Home | core | Same |
| "Reminders on this iPhone", the iOS notification permission alert, Allow | core | Same |
| Account deletion entry point and typed confirmation (cancelled) | core | Same |
| Privacy controls reachable | core | Same |
| Offline screen with the server stopped | offline | Same |
| HealthKit permission sheet (declined) | healthkit | Runs only once the build declares HealthKit. **#17 is still open.** |
| Apple sandbox purchase | blocked | **Blocked.** StoreKit Testing (#27) applies only to Xcode/XCTest runs, and RevenueCat (#28) needs the owner's project, its `appl_` key and the StoreKit certificate. Run it on a signed TestFlight build with a Sandbox Apple Account. |
| Universal link to `/plan` | blocked | **Blocked.** Needs a signed build with Associated Domains. Notification-tap deep links are covered by `ios-native-e2e.yml`, and link filtering by `tests/native-*.test.mjs`. |

Reminders, the offline screen and notification taps are also covered by the native agent's XCUITest lane (#13).

## 4. AI quality

| Item | Result |
|---|---|
| Offline self-test, $0 | **134/134** cases assembled by the production prompt code with the DATA HONESTY guardrail present (CI and local) |
| Smoke run on the current model | **BLOCKED: needs `GEMINI_API_KEY`.** Reported as blocked, not passed. |
| Model comparison, current vs candidates | **Pending key.** See `AI-BENCHMARK.md` from the AI agent: harness ready, no model run. |
| Consistency (3 repeats), latency (TTFT, p50/p95), cost | Measured by the harness once keys exist. None reported yet. |
| Spend-guard tests | 5/5. The cap refuses, a missing key costs nothing, cache hits work without a key, repeats are cached separately. |

**Scoring criteria** come from the benchmark's named metrics (`correctness`/`time_math`, `relevance`, `safety`, `honesty`/`grounding`, `memory`/`personalization`, `format`/`voice`, `tool_use`), using deterministic checks first:
- schedule and clock-time windows;
- no invented wearable data;
- no diagnosis or prescription dosing;
- referral for red flags.

Safety-sensitive cases cite NIOSH, FDA, NHLBI and NIMH pages, and Drake et al. 2013 for caffeine. An LLM rubric judge grades relevance and tone. Personas include ER nurses, paramedics and firefighters, on rotating and 24/48 schedules, with overtime and conversational memory.

## 5. Regressions found and corrected

| ID | Severity | What | Where | Status |
|---|---|---|---|---|
| **R4** | High; live in production | The Oura and Fitbit OAuth callbacks returned **HTTP 500 on every request**, so wearables could never connect. `Response.redirect()` has immutable headers, and the security-headers middleware in `src/start.ts` sets headers on every response. | Staging and restpilotai.com | **Fixed on Railway in #31** (merge `83a7d6ff`). **Main port #38 is APPROVED** but waits for the owner's explicit approval to merge. After merging, a Lovable **Publish** is needed to go live. |
| **R1** | High | Valid model JSON that omits fields or uses an unknown enum (urgency "critical") crashed the **whole dashboard**. This is a risk during any model swap. | `/api/ai`, `/api/insights`, dashboard cards | **Fixed by #36** (AI agent: schema validation plus card error boundaries). Verified by `app/offline-resilience.spec.ts`, which failed before #36 and passes after. |
| **R2** | Low | Signing in from `/memory`, `/pilot`, `/decisions`, `/health`, `/settings/*` and other pages lands on `/dashboard`, because `SAFE_RETURNS` in `src/routes/auth.tsx` omits them. | Railway branch | Open. It is an expected failure (`app/auth.spec.ts`) and flips once fixed. **Repro:** signed out, open `/memory`, sign in, and you land on `/dashboard`. **Owner:** UI/auth agent. |
| **R3** | Low | `/legal` shows the effective date one day early in US time zones ("June 26" for 2026-06-27). The cause is `toLocaleDateString()` without `timeZone: "UTC"` in `legal.index.tsx`, which also triggers React hydration error #418. | Railway branch | Open. A fix exists on `fix/legal-date-hydration` (main) but not here. **Repro:** in an America/* time zone, open `/legal`; the console shows error #418 and the date is off by one. |

Other findings routed to their owners:
- **Wearable OAuth `state` is not bound to the user's session** (CSRF and account-linking risk). Found by the independent review of #26 and addressed by the open **#25**.
- `reason` is double-encoded in callback errors.
- #18's post-approval commit `2c4891b6` was reviewed independently (comment on #18): it is safe. Minor note: `reasoning_effort` is sent to non-reasoning OpenAI judges.

Harness issues found and fixed along the way (not product bugs):
- Sign-out after #14 also clears `sessionStorage`, so the test session injector now writes the session once.
- The proxy's keep-alive sockets caused intermittent 502s; keep-alive is now off.
- The fast-check lint step failed on promotion PR #4; it is fixed by #35.

## 6. Untested or blocked, with reasons

| Area | Why | What unblocks it |
|---|---|---|
| Live AI quality, model comparison, consistency, latency, cost | No AI key | `GEMINI_API_KEY` (Google AI Studio; current model `gemini-3-flash-preview`) plus one judge key (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY` or `GEMINI_API_KEY`) as repository secrets |
| Website Stripe checkout | **Parked by owner** | Owner un-parks it. Then set `E2E_STRIPE_TEST_SECRET_KEY` (`sk_test_…`, RestPilot's own account) and `E2E_STRIPE_UNPARK=1` |
| Apple sandbox purchase | No App Store Connect products or Sandbox tester; StoreKit Testing does not apply to Maestro | App Store Connect products, a **Sandbox Apple Account**, RevenueCat `appl_` key and StoreKit certificate; run on TestFlight |
| HealthKit sheet | #17 not merged | Merge #17; the flow then runs automatically |
| Universal links | Unsigned simulator build | Signed build with Associated Domains plus AASA on restpilotai.com |
| Appearance and themes | #33 not merged | Merge #33; the test then activates |
| Prices on the website | Railway build is in App Preview mode | Subscriptions work restores the plans |
| WebKit and real Mobile Safari | WebKit runs only in the comprehensive CI job; real Safari only on device | Label a PR `qa:full`; the device checklist below |
| Real Oura/Fitbit token exchange | Needs provider OAuth apps | Provider credentials and registered callback URLs |
| Required checks on the Railway branch | The proxy refuses branch-protection writes (HTTP 403) | The owner runs the command below |

**Branch protection.** Make "Lint, typecheck, unit tests" and "Production build" required on `codex/restpilot-railway-migration`:

```bash
gh api -X PUT repos/scubamike124/shiftrest-ai/branches/codex/restpilot-railway-migration/protection --input - <<'EOF'
{"required_status_checks":{"strict":false,"contexts":["Lint, typecheck, unit tests","Production build"]},
 "enforce_admins":false,"required_pull_request_reviews":null,"restrictions":null}
EOF
```

Do **not** protect `main`: Lovable's bot pushes to `main` directly, and required checks there could break production syncing.

## 7. Remaining real-device verification checklist

Run on a physical iPhone, in Safari and in the TestFlight app. Also see `docs/qa/REAL_DEVICE_CHECKLIST.md`.

- [ ] Companion voice: the first tap plays audio; audio survives lock and unlock and a switch to another app (iOS audio unlock).
- [ ] Notification permission prompt, a reminder banner arrives, and tapping it opens the right screen.
- [ ] Offline: airplane mode shows the offline screen, then the app recovers without restarting.
- [ ] HealthKit: the Connect sheet asks for read-only types; deny and allow both behave; no data leaves the phone (#17).
- [ ] Sandbox purchase: monthly $7.99 and annual $49.99 with the 14-day trial; restore; no lifetime product.
- [ ] Universal link from Messages or Mail opens the app on `/plan`.
- [ ] Account deletion from inside the app (Apple guideline 5.1.1(v)) completes and signs out.
- [ ] Layout on iPhone SE, 15 and 15 Pro Max: no zoom-out, safe areas, bottom navigation reachable (#8 and #22).
- [ ] Oura and Fitbit connect end to end after #38 is published.

## 8. Running list

| State | Items |
|---|---|
| **Completed** | Fast checks merged (#29, #35); branch head green at 474/474 unit tests. Eval spend guard merged (#12). R4 fixed on Railway (#31). Web suite: 456 passing on Chromium across 4 viewports. API contract (43 tests). Offline self-test 134/134. |
| **Failed (open product defects)** | R2, R3 |
| **Blocked** | Live AI evals (key); website prices (App Preview); themes (#33); HealthKit (#17); Apple sandbox purchase; universal links; branch protection (proxy) |
| **Parked by owner** | Website Stripe checkout (6 test runs) |
| **Unverified** | First green Maestro run (fix pushed; result pending); WebKit comprehensive run; real-device checklist (§7); R4 on production until #38 merges and is published |

## PRs

| PR | What | State |
|---|---|---|
| #12 | Eval spend guard, cache and CI wrapper over the companion benchmark | Merged `e2418924` |
| #29 | QA fast checks | Merged `fee0a051` |
| #31 | R4 fix (Railway) | Merged `83a7d6ff` |
| #35 | Fast checks: tests always report; push lint; promotion-PR skip | Merged `26c9dcb4` |
| #38 | R4 port to `main` | APPROVED; waiting for owner approval to merge |
| #39 | This QA system (Playwright, Maestro, comprehensive CI, report) | In review |
| #26 | First R4 fix | Closed. It accidentally committed local test output, including a throwaway self-signed localhost key that has no use anywhere. The branch `claude/restpilot-fix-wearable-callback-redirect` could not be deleted through the proxy; the owner may delete it. |
