# RestPilot QA report: automated quality assurance system

Started 2026-11-14, updated 2026-11-15. Source: `scubamike124/shiftrest-ai`, branch `codex/restpilot-railway-migration`.

**Bottom line.**
- **Every PR now gets CI:** the web suite covers the product end to end, and every pull request runs lint, typecheck, unit tests and a build.
- **Five regressions found:** R1 and R4 are fixed (R4 on both Railway, #31, and main, #38; main still needs a Lovable **Publish**). R2, R3 and the new R5 are open and low severity.
- **Open PRs checked against the suite** (merged locally onto the branch head): #8, #17 and #45 pass with no regressions. #33 only needed test updates for its intentional Home redesign.
- **Not yet tested:** live AI quality (no key yet), payments (parked by the owner, or blocked), and anything that needs a real iPhone (§7).

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

**Current local run:** Chromium at desktop, iPhone SE, iPhone 15 and iPhone 15 Pro Max, on a build of base `9cc2d96f` (after #43) plus this suite. Of 648 tests:
- 460 passed. Three overflow checks on iPhone 15 Pro Max first timed out on `page.goto` while the machine was loaded; they passed when re-run alone.
- 0 product failures.
- 188 skipped. These are mostly mobile-only tests on desktop and desktop-only tests on mobile, plus API tests that run in one project only.

Unit tests (`node --test tests/*.test.mjs`): 480/480 on the branch head plus this suite.

### Open PRs, each merged locally onto the branch head (2026-11-15)

| PR | Head | Unit tests | Web suite (Chromium, 4 viewports) | Verdict |
|---|---|---|---|---|
| #8 iPhone layout | `a3c1c6d1` | 480/480 | 460 passed, 0 failed, 188 skipped | No regressions. The first attempt was invalid: another process stopped the shared app server mid-run. |
| #33 Simpler iPhone Home and themes | `d78160e2` | 509/509 | 454 passed, 8 failed; after test updates, 122/122 on the affected specs (2 skipped) | **No product regression.** On phones the coach brief, water and 7-day cards move into a closed "More insights" disclosure, which is intentional. The theme test now activates, and it clicks the label of the visually hidden radio. Both tests were updated in #39. |
| #17 HealthKit | `6527114a` | 498/498 | 460 passed, 0 failed, 188 skipped | No regressions on the web. The HealthKit Maestro flow runs once it merges. |
| #45 AI quality | `d6735ab4` | 488/488 | 460 passed, 0 failed, 188 skipped | No regressions. Live answer quality still needs a key (§4). |

**CI PR smoke** (Chromium desktop and iPhone 15) passes on every #39 head. WebKit runs only in the comprehensive CI job; locally only Chromium's headless shell is installed.

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
| Launch to the home screen; header menu shows "Sign in" | core | **Pass** (CI, `25c299c7`) |
| Sign-in screen (no Google button, no Safari install prompt; #6) | core | **Pass** |
| Sign in, step through the Companion intro, then Plan, Events, Profile, Home | core | **Pass** |
| "Reminders on this iPhone", the iOS notification permission alert, Allow | core | Reached Profile but stopped scrolling before the card (the page is long). The scroll is now faster and longer; the run is pending |
| Account deletion entry point and typed confirmation (cancelled) | core | Same |
| Privacy controls reachable | core | Same |
| Offline screen with the server stopped | offline | **Pass** |
| HealthKit permission sheet (declined) | healthkit | Ran by mistake on `25c299c7`: PlistBuddy exits 0 for a missing key on the runner. Detection now uses grep. Runs once **#17** merges |
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
| **R5** | Low | The floating cookie-preferences chip (`CookieBanner`, `fixed z-[70]`) is drawn above sheets and dialogs. On the first-run Companion intro sheet it covers the **Skip** button at bottom left (seen on iPhone 11 / 414 pt in the simulator). #33 shrinks the chip to a 44 pt icon at the same position, which still overlaps. | Railway branch; also with #33 | Open. **Repro:** in the app shell or Mobile Safari at phone width, sign in on a fresh device and look at the intro sheet's bottom left. The chip sits on "Skip". **Suggested fix:** hide the chip while a dialog is open, or give it a z-index below the dialog layer. **Owner:** UI agent (#33 touches the same file). |

Other findings routed to their owners:
- **Wearable OAuth `state` is not bound to the user's session** (CSRF and account-linking risk). Found by the independent review of #26 and addressed by the open **#25**.
- `reason` is double-encoded in callback errors.
- #18's post-approval commit `2c4891b6` has had two independent reviews (comments on #18). It is safe. Minor notes: `reasoning_effort` is sent to non-reasoning OpenAI judges, and AI-BENCHMARK.md quotes Anthropic's temperature rule loosely; the conclusion "omit it" is correct.
- **#23 (AI accuracy) is not ready.** CI on its head `7ac598f4` fails "Lint (changed lines)": 50+ `prettier/prettier` errors on lines the PR added. The only commits after the APPROVE on `bf1ad93` are an empty commit and a clean base merge. A fix is prepared but not pushed: it formats only the PR's changed hunks and makes one source-text test tolerate the resulting line break. With it: 461/461 unit tests, typecheck clean, 0 lint errors.

Harness issues found and fixed along the way (not product bugs):
- Maestro: at iPhone widths "Sign in" sits in the header menu, and the first sign-in shows the Companion intro sheet over Home. The flows now handle both.
- Maestro offline flow: the bundled offline page returns to restpilotai.com as soon as that site is reachable, so in CI it opened production in Safari. The CI build now points it at the local stack.
- Maestro: a blank WebView on the first launch was WebKit's cold start (46 s), not a product defect. The launch flow allows 90 s. When Maestro's XCTest driver misses its start window, the core flows are retried once; flow failures are never retried.
- A suspected Cross-Origin-Opener-Policy (COOP) problem was ruled out: the launch flow behaves the same with and without the header.
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
| **Completed** | Fast checks merged (#29, #35). Eval spend guard merged (#12). R4 fixed on Railway (#31) and on main (#38). OAuth state signed (#25, main port #44). Web suite: 460 passing on Chromium across 4 viewports on base `9cc2d96f`, and against #8, #17 and #45. #33 passes after the test updates. API contract (43 tests). Offline self-test 134/134. Unit tests 480/480. |
| **Failed (open product defects)** | R2, R3, R5 (all low) |
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
| #38 | R4 port to `main` | Merged `f71dfe4a`. Needs a Lovable **Publish** to go live |
| #44 | OAuth state signing, port of #25 to `main` | Merged `cbae0253` |
| #23 | AI accuracy (AI agent) | APPROVE on `bf1ad93`; later commits are empty or a clean base merge. **CI lint is red**, so it is not ready (§5) |
| #39 | This QA system (Playwright, Maestro, comprehensive CI, report) | In review |
| #26 | First R4 fix | Closed. It accidentally committed local test output, including a throwaway self-signed localhost key that has no use anywhere. The branch `claude/restpilot-fix-wearable-callback-redirect` could not be deleted through the proxy; the owner may delete it. |
