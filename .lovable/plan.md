# Phase 9 — Launch Readiness Audit

Investigation-only. No code changes pending your approval.

## 1. Full Feature Checklist

| Area | Status | Notes |
|---|---|---|
| AI Companion (`/companion`) | ✅ Built | Avatar, streaming chat, memory consent, voice in/out |
| Sleep Sounds (`/sleep`) | ✅ Built | Web Audio synth mixer, presets, timer |
| Voice Commands | ✅ Built | Intent router covers play/stop/timer/save/alarm/breathing/quiet/agenda/weather/traffic/inbox |
| NL Automation Builder | ✅ Built | `/automations` parses free-text, preview-confirm flow |
| Weather Intelligence | ✅ Built | Alerts card in Daily Brief |
| Traffic Intelligence | ✅ Built | OSRM + learned baselines, destinations card |
| Calendar Intelligence | ✅ Built | RFC 5545 read-only feeds, "Leave earlier" hints |
| Personal Intelligence | ✅ Built | `/inbox`, PersonalPlanCard, priority detection |
| Smart Home Registry | ✅ Built | `/smart-home`, private device list |
| Sleep Automation | ✅ Built | Sound presets + ambient timer |
| Quiet Mode | ✅ Built | Mutes TTS + non-urgent notifications |
| AI Memory + Proposals | ✅ Built | `/memory`, confirm-before-save, export/delete |
| Routine Suggestions | ✅ Built | Cross-skill suggester, consent toggles |
| Health & Wearables (`/health`) | ✅ Built | Fitbit + Oura; trends + planned providers |
| Inbox `?add=` / `?complete=` | ✅ Hardened | Prefill only; confirm to complete |
| Payments | ✅ Built | Stripe live + sandbox, webhook, portal |
| Legal pages | ⚠️ Built but `/legal/*` reports 404 on edge — needs republish verification |
| Onboarding + Consent | ✅ Built | Modal + signup checkbox |
| Dashboard / CompanionHero | ✅ Built | Briefs (morning/afternoon/evening) |
| Mobile PWA | ✅ Built | Manifest, SW, offline snapshot |
| Accessibility baseline | ✅ axe clean on public surface | Authed surface unsampled |
| Analytics | ✅ `analytics.ts` events; `ai_log`, `notification_log` audit tables |
| Security/RLS | ✅ Phase 1 hardening migration applied |

## 2. User-Flow Test Plan (Authenticated)

1. Signup → consent checkbox → email verify → onboarding → dashboard
2. Google OAuth via Lovable broker → dashboard
3. Dashboard renders correct brief for time window
4. Companion: text + voice command "play rain", "set timer 30 min", "goodnight"
5. Sleep: load preset, save mix, breathing overlay
6. Memory: receive a proposal → accept → appears in Memory page; pause learning
7. Routine Suggestions: accept → automation created → runs and logs
8. NL Routine: "every weekday at 10pm dim lights and play rain" → preview → save
9. Quiet Mode toggle: TTS muted, non-urgent notifications deferred
10. Inbox: `?add=Pick up groceries` prefills; `?complete=groceries` requires confirm
11. Calendar feed add → AgendaCard shows next event + "Leave earlier" hint
12. Traffic destination add → baseline learns → alert when slower
13. Weather alert card renders with location
14. Smart Home: add device → toggle from automation
15. Wearable: connect Fitbit/Oura → `/health` shows trends
16. Paywall: open as logged-in user → sandbox checkout → portal cancel → webhook updates row
17. Profile: export data, delete AI memory, delete account
18. Offline: airplane mode → cached plan + OfflineBanner; reconnect

## 3. Mobile QA Checklist

- iOS Safari 17+: PWA install, push permission, Smart Alarm screen, voice mic
- Android Chrome: PWA install, push delivery, voice mic
- iPad Safari: dashboard split layout, long clock
- Touch targets ≥ 44px (audit `size="icon"` buttons)
- No horizontal scroll at 360px
- Safe-area insets for notch/home-indicator
- Audio autoplay policy: confirm user-gesture gate before synth starts

## 4. Accessibility Checklist

- Single `<main>` per route (regressed once on legal — re-verify)
- Icon-only buttons have `aria-label` (sweep `BottomNav`, `VoiceCommandButton`, `PilotOrb`)
- Form labels associated on `/auth`, `/inbox`, `/automations`
- Color contrast: re-run after `--indigo-glow` brighten
- Focus traps in `BreathingOverlay`, `CompanionIntroSheet`, `RecommendationDetailSheet`
- `aria-live` on streaming companion replies and toast region
- Keyboard path through onboarding + paywall

## 5. Security / RLS Review

- Re-run `supabase--linter` immediately pre-publish; expect 2 known advisories only
- Verify RLS on all 32 public tables (spot: `ai_log`, `notification_log`, `wearable_connections`, `personal_items`, `companion_routines`, `smart_devices`, `traffic_destinations`, `calendar_feeds`, `routine_suggestions`, `automation_runs`)
- Verify GRANTs match policies (no accidental `anon` on user-scoped tables)
- `requireSupabaseAuth` on every user-data server fn; admin client only in `.server.ts` or dynamic-imported in handlers
- Webhook signature verification: Stripe (`verifyWebhook`), cron endpoints under `/api/public/*`
- Rate limiting on `/api/coach`, `/api/ai`, `/api/tts` — currently only token-budget cap (gap)
- Secrets: no service role in client bundle (grep `SUPABASE_SERVICE_ROLE_KEY` in `dist/`)

## 6. Privacy Review

- Memory: confirm-before-save honored end-to-end
- Export (`exportAccountFn`) returns all user-owned tables
- Delete account purges across all tables + cancels Stripe sub
- Wearable disconnect deletes readings (per retention table)
- Consent banner persists across sessions; cookie categories enforced
- AI memory does not learn sensitive health categories (verify extractor allowlist)
- Calendar/Smart Home/Personal Items all private to user; no shared views

## 7. Analytics Verification Plan

- Trace each `analytics.track(...)` call site to event taxonomy
- Confirm `ai_log` rows written for every AI surface (coach, brief, narration, recommendations)
- Confirm `notification_log` rows for every push send
- Confirm `legal_acceptances` for signup + each consent change
- Spot-check `user_events` for companion intents and automation runs

## 8. Known Risks

- **`/legal/*` 404 on production edge** (carried from prior pass) — must republish + verify with `curl -I`
- **Authenticated E2E not run in sandbox** — `LOVABLE_BROWSER_AUTH_STATUS=signed_out`
- **Live Stripe charge never executed** — pending owner approval
- **WebKit/Firefox headless** not pre-installed — Chromium-only coverage
- **Push delivery on iOS Safari + Android Chrome** not verified on real device
- **No edge-layer rate limiting** on `/api/coach|ai|tts` beyond 24h token cap
- **Native wearables** (Apple Health, Garmin, WHOOP, Health Connect) still "coming soon"
- **Voice STT** depends on browser SpeechRecognition; Safari iOS partial support
- **NL Routine Builder** is pattern-based; ambiguous phrases may produce empty step list (silent)
- **Smart Home registry has no real device control** — registry only, no actuation outside automations

## 9. Bugs Found (static review this pass)

- None new beyond inherited blockers above. No `TODO`/`FIXME` markers in `src/`.
- Inherited: `/legal/*` 404; `region` axe moderate on footer microcopy; perf 70/65 mobile on `/` and `/paywall` (aurora CLS + Stripe iframe).

## 10. Recommended Fixes (to schedule)

Pre-launch (blocking):
1. Republish; `curl -I` every `/legal/*` route; if still 404, inspect Worker logs
2. Owner signs into preview → re-run authed Playwright E2E sweep
3. Owner runs $1 live Stripe charge end-to-end + portal cancel
4. Real-device pass: iPhone Safari, Android Chrome, iPad
5. Re-run Lighthouse mobile on `/` and `/paywall` post-fixes (target ≥ 90)
6. Run `supabase--linter` immediately before publish

Pre-launch (non-blocking but recommended):
7. Add edge token-bucket rate limit to `/api/coach`, `/api/ai`, `/api/tts`
8. Surface NL Builder "couldn't parse" state instead of empty preview
9. Sweep icon-only buttons for `aria-label`
10. Defer Stripe.js until paywall mount; preload aurora hero layer

Post-launch:
- Apple Health / Garmin / WHOOP / Health Connect wrappers
- WebKit + Firefox headless coverage in CI
- Smart Home real-device control (Matter / HomeKit / Google Home)
- Voice STT fallback for Safari iOS via `/api/stt`
- Custom domain
- Color-contrast audit on authed surfaces
- A/B test paywall tiers

## 11. Launch Blockers

1. `/legal/*` edge 404
2. Authed E2E regression
3. Live Stripe verification
4. Real-device cross-browser pass

## 12. Nice-to-Have Post-Launch

Rate limiting · native wearables · cross-browser CI · domain · NL builder UX polish · Smart Home actuation · Pilot voice expansion · referral/sharing · in-app changelog · A/B paywall

## 13. Rollback Plan

- Frontend: revert to previous publish via project history → "Update" republish
- Backend (DB): no destructive migrations queued; if a Phase 9 migration ships, include `DOWN` SQL and snapshot row counts before apply. Lovable Cloud daily backups + PITR available
- Stripe: webhook endpoint is idempotent; pause webhook delivery from Stripe dashboard if cascading failures
- Push: clear `push_subscriptions` rows for affected users; clients re-subscribe on next visit
- Communication: status note via in-app banner (`OfflineBanner`-style component) + email via Lovable Email

## 14. Launch-Readiness Score

**ALMOST READY**

- Code, security, accessibility baseline, and SEO/Best-Practices all meet bar
- Four manual gates remain (legal 404 republish, authed E2E, live Stripe, real-device)
- No known data-loss, auth-bypass, or privilege-escalation risks

## 15. Must Fix Before Launch

1. `/legal/*` 404 — republish + verify
2. Owner-driven authed E2E pass
3. Live Stripe $1 test + portal cancel
4. iOS Safari + Android Chrome real-device pass (PWA install + push)
5. `supabase--linter` clean run immediately pre-publish

## 16. Can Wait Until After Launch

Edge rate-limit · native wearable wrappers · WebKit/Firefox CI · Stripe.js deferral · NL builder UX · Smart Home actuation · custom domain · contrast audit on authed surfaces

## 17. Estimated Risk Level

**LOW–MEDIUM**

- Low: data integrity, auth, RLS, privacy controls
- Medium: legal pages SEO indexing if 404 persists; payments until live charge verified; iOS push until real-device confirmed

## 18. Final Recommendation

**Hold public announcement.** Proceed to the four manual gates above; soft-launch / beta is safe today on the preview URL. Once the four blockers clear, ship.

---

Awaiting approval to proceed with the pre-launch fix pass (legal republish verification, optional rate-limit + NL builder polish, axe sweep, Lighthouse re-run).
