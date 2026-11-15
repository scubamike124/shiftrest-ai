# RestPilot product fixes — issues 1, 2, 5 and 8 (Nov 14, 2026)

Owner authorization of Nov 14 2026. Rules followed:
- Preserve working functionality, customer data and authentication.
- Improve; do not rebuild.
- Every PR gets an independent review: a fresh agent sees only the diff and the goal, and posts "Independent review verdict: …".
- Nothing is called done without verification.

Development target: `codex/restpilot-railway-migration`, which auto-deploys to Railway staging. Production (`main`, served by Lovable) received only the lifetime removal.

| Issue | PR | Base | Merge SHA |
|---|---|---|---|
| 5 Lifetime removal | #9 | migration | `21c3b39` |
| 5 Lifetime removal (production) | #19 | `main` | `08e2545` |
| 2 Schedule consistency + one-tap overtime API | #11 | migration | `aede1d1` |
| 8 Privacy and account controls | #14 | migration | `0202fd4` |
| 1 AI accuracy and confidence (+ this document) | #23 | migration | (this PR) |

---

## Issue 5 — Lifetime membership removed (owner decision)

**Found**
- Migration branch: `/pricing` and `/paywall` were already the plan-free App Preview page, with Stripe disabled at the adapter. The checkout server function still accepted `restpilot_lifetime`. `/paywall?plan=lifetime` was a valid link. The Subscription Terms, Terms of Service, legal index and renewal disclosure still offered "Lifetime — USD 99 one-time".
- `main` (production): Lifetime appeared on the homepage pricing preview, `/pricing` (cards and comparison matrix), `/paywall` ("Founding Member — Limited Time", $99) and the legal pages. Checkout accepted any lookup key, including any one-time price.

**Fixed**
- **Checkout.** `createCheckoutSession` refuses `restpilot_lifetime` ("Lifetime membership is no longer offered…") in its input validator, before any Stripe call. Only `restpilot_monthly` and `restpilot_annual` are accepted, and any non-recurring Stripe price is refused. On the migration branch the payment-mode code path was removed. On `main` it is kept but can no longer run, to keep that diff minimal.
- **UI.** Lifetime is removed from the homepage, `/pricing` and `/paywall` (main) and from the paywall search params. A stale "lifetime" checkout intent saved in sessionStorage is ignored.
- **Legal.** The pages now say Lifetime "has been permanently discontinued and is no longer available for purchase". §9 is kept and renamed "Lifetime access (existing purchasers)".

**Preserved**
- Monthly $7.99, Annual $49.99 and the 14-day trial (`trial_period_days: 14`, "Start 14-day free trial").
- The webhook still records paid lifetime checkouts, including delayed `async_payment_succeeded` for past purchases.
- `subscription.ts` and `realtime/access.server.ts` still treat `lifetime` as paid.
- Account deletion still skips Stripe cancellation for `lifetime_cs_` rows.
- Profile still thanks Founding Members.
- No Stripe dashboard or API changes.

**Evidence**
- Tests:
  - `tests/billing-security.test.mjs` and `tests/lifetime-discontinued.test.mjs` on the migration branch: lifetime refused with zero Stripe calls, even if a one-time price still exists; payment mode never created; monthly and annual keep the 14-day trial; no route or component offers lifetime; entitlement readers and the webhook still honor it.
  - `tests/lifetime-discontinued.test.mjs` on `main` (6 tests): the same checks, plus $7.99, $49.99 and "14-day free trial" still render on `/pricing`, `/paywall` and the homepage.
  - `tests/webhook-persistence.test.mjs`: past lifetime grants still pass.
- **Staging (Playwright, iPhone 13 viewport, build `b-1794698536573`):**
  - `/pricing`, `/paywall` and `/paywall?plan=lifetime` contain no "lifetime" or "$99".
  - `/legal/subscription` lists Monthly USD 7.99 and Annual USD 49.99 and states that Lifetime is discontinued.
  - There is no horizontal scroll (390 = 390).
  - Staging has no plan cards or trial copy to check: the App Preview page replaced pricing in the migration. The 14-day trial is enforced in checkout code and tests.
- **Production:** see "Production deployment" below.

### Production deployment (Lovable)

- **Lovable does NOT auto-publish `main`.** Evidence:
  - PR #2 (robots.txt) merged into `main` on Nov 10. Five days later `https://restpilotai.com/robots.txt` still shows the old Lovable sitemap host.
  - `/api/public/version` still reports build `b-1786931160964` from Aug 17.
  - After #19 merged (`08e2545`), production still shows Lifetime $99 on `/`, `/pricing` and `/paywall` (Playwright, iPhone viewport).
- **Server code is published together with the frontend.** `main` has no Supabase edge functions (`supabase/` holds only migrations). Checkout, the webhook and the other server routes are TanStack Start server functions in the same Nitro/Cloudflare build, so the checkout refusal goes live with the same Publish. No database migration is needed for this change.
- **Until the owner publishes,** production still sells Lifetime, through both the UI and the old checkout function.

**Owner-only step — publish in Lovable (iPhone):**
1. Open Safari and go to lovable.dev. Sign in with the account that owns the RestPilot project (`shift-rest-ai`).
2. Open the project. Wait for the chat or history to show the GitHub commit "Merge pull request #19" (`08e2545`). Lovable syncs `main` automatically; if it isn't there, pull to refresh.
3. Tap **Publish**. On a phone this is the globe/Publish button at the top right; it may be under the "…" menu if the screen is narrow.
4. In the publish sheet, tap **Update** (or **Publish update**) and confirm.
5. Open https://restpilotai.com/pricing in Safari. Pull to refresh, or close and reopen the tab to bypass the cached app. Check that only Monthly $7.99 and Annual $49.99 appear, with "14-day free trial". Do the same on https://restpilotai.com/paywall.

This also publishes the other `main` changes not yet live: PR #2 (robots.txt sitemap host). Nothing else is pending on `main`.

### Subscription system and App Store compliance (report only; the subscriptions agent owns IAP)

- **Guideline 3.1.1.** Production's web paywall sells digital subscriptions through Stripe embedded checkout. If the iOS shell loads this site, it must not offer Stripe purchase in the app. Outside the US storefront exception for external purchase links, digital subscriptions must use In-App Purchase. The app-aware gating (another agent) and native IAP (subscriptions agent) must cover `/paywall`, `/pricing`, the homepage pricing preview, and profile "Manage subscription" / "Restore purchases".
- **Guideline 3.1.2 disclosures** (production web paywall): price and period, auto-renewal, the free trial ("No charge today · Cancel anytime before your trial ends"), and Terms, Privacy and Subscription Terms links are all present. A native IAP paywall must repeat them and link the EULA and privacy policy in the app's metadata.
- **Lifetime.** An existing web Lifetime purchase is an entitlement Apple's IAP knows nothing about. The native entitlement check must also accept `subscriptions.status = 'lifetime'`; it is server-side, so this works if the app reuses `has_active_subscription` / `voiceEntitlement`.
- **Railway build.** `isPaymentsConfigured()` is false, so Profile shows "App preview access" even to paying and lifetime users, and hides "Manage subscription". Server-side entitlement still honors their payments, so they keep access. Account deletion fails closed for a user with an active (non-lifetime) Stripe subscription, because Stripe is disabled at the adapter and cancellation cannot be confirmed. That violates 5.1.1(v) (in-app account deletion) for those users. The migration's subscription-retirement plan has to resolve it before any App Store review.
- **Owner: archive the lifetime price in Stripe.** The webhook still grants Lifetime for any paid `restpilot_lifetime` payment-mode session, which it needs for past and delayed payments. Any Stripe Payment Link or other Stripe-hosted entry point for that price outside the app could therefore still sell it. Archive the `restpilot_lifetime` price and any payment links in the Stripe dashboard. This step is owner-only; no Stripe changes were made here.

---

## Issue 2 — Sleep schedule consistency

**Found (conflicting recommendations across screens)**
- Caffeine cutoff: 8h before sleep on the dashboard Long Clock (labelled an "8h half-life", which is wrong; caffeine's half-life is about 5h). Plan, the 7-day plan, recommendations and server reminders used 6h.
- Light after a night shift: the Long Clock said "bright light from sunrise" for 3h while the Plan screen said "amber glasses on at sunrise".
- Pre-shift meal: 75 minutes before clock-in (7-day plan), 90 (recommendations, the same moment as waking) or 120 (Plan, night shifts only).
- The 7-day plan put the amber-glasses sunrise on the morning BEFORE a 22:00–23:59 night shift.
- The in-app wind-down notification (`notify.ts`) fired `windDownMin` BEFORE clock-out (17:00 for a 07:00–19:00 shift) and said the sleep window was about to start. Every screen starts the wind-down AT clock-out. It also ignored multi-week rotation.
- Server reminders considered only the first shift of each day. They missed the bright-light reminder for shifts starting between 00:00 and 01:29, because it falls on the previous evening.
- DST:
  - `utcFromLocal` used the offset at the naive instant, so it was an hour off right after a change.
  - It mis-normalized negative minutes (-30 became 22:30, not 23:30).
  - Ambiguous fall-back times resolved differently by hemisphere.
  - Screens added durations by wall clock while reminders used elapsed time, so on DST nights they disagreed by an hour.
- The Plan screen listed events by clock time, so a night shift's morning sleep appeared before the wake-up.

**Fixed**
- `src/lib/schedule-core.ts` is the single computation:
  - `SCHEDULE_RULES` holds the numbers.
  - `instantsForWindow` and `anchorInstants` give the canonical instants: clock-in and clock-out are wall clock, everything else is elapsed time.
  - `shiftAnchorsOn` turns those instants into minute-of-day values for screens.
  - `ANCHOR_WHY` holds the customer-facing "why this time" text.
- Users of the module: the Plan screen, the dashboard Long Clock (via `src/lib/clock-bands.ts`), the 7-day plan, recommendations, the server reminder cron (`computeDueReminders`) and the in-app wind-down notification. `weekIndexFor` delegates to the module's rotation rule.
- "Why this time?" disclosures appear on the Plan screen and the 7-day plan. Long Clock reasons appear in its existing detail sheet.
- **Behaviour changes users will see:**
  - The meal is shown 75 minutes before clock-in on every screen, for all shift types.
  - On shift days the Long Clock's light band starts at wake-up, with an amber-glasses marker after night shifts.
  - The cutoff is 6h before sleep everywhere.
  - Plan events are in chronological order.
  - On DST nights, sleep length is real elapsed time.

**One-tap overtime / shift change API** (for the app agent's home-screen button and the native notification rescheduler):

```ts
import { buildSchedule, applyShiftChange, ShiftChangeError } from "@/lib/schedule-core";

// 1. Concrete occurrences from the weekly template + rotation, in the user's IANA zone.
//    Occurrence ids are `${templateShiftId}@YYYY-MM-DD`. Shifts that ended within
//    `lookbackMin` (default 24h) are kept so "I'm still here" can extend them.
const schedule = buildSchedule({ shifts, tz, from: new Date(), days: 7,
  cycleAnchor: prefs.cycleAnchor, cycleWeeks: prefs.cycleWeeks });

// 2. Apply one change to ONE occurrence (pure; the weekly template is not edited).
const result = applyShiftChange(schedule, change, { prefs, now: new Date() });
// change is one of:
//   { kind: "extend", shiftId, endsAt? | extraMinutes? }     "My shift was extended"
//   { kind: "reschedule", shiftId, startsAt?, endsAt? }      "My shift changed"
//   { kind: "cancel", shiftId }
//   { kind: "swap", shiftId, take: { id?, startsAt, endsAt, title? } }
//   { kind: "add", shift: { id?, startsAt, endsAt, title? } }
// result:
//   schedule              new Schedule
//   sleepPlan             SleepOpportunity[]: windDownStart, sleepStart, sleepEnd, caffeineCutoff,
//                         sleepMinutes, shortTurnaround, why[]
//   reminders             PlannedReminder[]: the FULL future set, sorted; { id: `${kind}:${shiftId}`,
//                         kind, at, shiftId, why }; kinds match ReminderKind
//                         (bright-light, shift-start, caffeine-cutoff, shift-end-recovery, wind-down)
//   cancelledReminderIds  ids that existed before and no longer do
//   summary               one-line text for a toast
// Throws ShiftChangeError (user-facing message) for overlaps with another shift, an "extension"
// that ends earlier, end <= start, or shifts > 24h.
```

Native scheduling: replace previously scheduled notifications with `result.reminders`, using `id` as a stable key (hash it if the platform needs integers), and cancel `result.cancelledReminderIds`. Persisting a one-off change server-side, so the cron also follows it, is not part of this API. The cron reads the weekly template; persisting overrides needs a table, which belongs to the migration owner.

**Evidence**
- `tests/schedule-core.test.mjs` (23 tests):
  - midnight crossing and a 00:30 start;
  - two- and three-week rotation;
  - an overnight shift still running;
  - fall-back and spring-forward nights;
  - `utcFromLocal` gaps, overflow and the earlier-instant rule in NY, Berlin, Sydney, Lord Howe and Auckland;
  - short-turnaround trimming;
  - extension past midnight, explicit end time, cancel, swap, reschedule and add;
  - overlap checked only on the changed shift;
  - an extension across fall-back;
  - extending after the scheduled clock-out.
- `tests/schedule-consistency.test.mjs` loads the real Plan, 7-day plan, Long Clock band, recommendation, cron and in-app notification code. For 9 cases in America/New_York and Australia/Sydney, ordinary and DST dates, it asserts identical times for wake, meal, caffeine on, cutoff, wind-down, sleep start, sleep end, shift start and shift end. Each cron reminder kind must be sent exactly once.
- Probe (independent reviewer and author): `utcFromLocal` over more than 560,000 wall times in 11–12 zones. Every existing time round-trips, ambiguous times take the earlier instant, and gap times move forward.
- Independent review: two REQUEST_CHANGES rounds on #11, both addressed (see the PR thread), then APPROVE at `c83035c` (merged `aede1d1`).

**Remaining**
- Screens, sun times and the in-app notification use the device zone. The cron uses `notification_prefs.timezone`, which defaults to the device zone, so they agree unless a traveller's stored zone is stale. A single per-user zone source for travel is a product follow-up.
- When both server push and in-app notifications are on, the wind-down alert can arrive twice at the same moment. This was already true before; the two copies now agree on the time.
- A 19:00–07:00 shift is classed as "evening", not "night" (night is a start in [22:00, 04:00)), so it gets no amber-glasses advice. This is unchanged and flagged for product review.

---

## Issue 1 — AI accuracy and confidence

**Audit: how scores and recommendations are produced**

| Value | Source | Kind |
|---|---|---|
| Fatigue (0–100) and the 14-day horizon | `insights.ts` rules: shift type, length, turnaround, backward rotation, carry-over; adjusted by wearable sleep debt, efficiency and HRV if present | Rule-based estimate |
| Recovery (0–100) | Weighted blend: circadian debt from the schedule, fatigue, wearable adjustments | Rule-based estimate |
| Schedule stability and circadian debt | `sleep-engine.circadianDebt` from shifts only | Rule-based estimate |
| Sleep debt (hours) | Wearable sleep duration vs. target | Measured input, derived value |
| Last night (duration, efficiency, HRV, RHR) | Oura/Fitbit readings | Measurement |
| Health trends | Wearable readings | Measurement and statistics |
| Hydration | User taps; fixed 8-glass goal; stored only on the device | Self-logged |
| AI brief, recap, tomorrow preview | LLM given `contextString` | AI prediction / text |
| Schedule times | `schedule-core` rules | Rule-based recommendation (issue 2) |

**Found**
- Fatigue and recovery were shown as bare "/100" numbers with no indication they are estimates.
- Every caller passes only the newest wearable night, yet:
  - sleep debt was called "Rolling 7-day" and "over last 7 nights";
  - the newest night was used as "last night" however old it was, so a reading weeks old drove today's fatigue and the AI context.
- With no wearable data, the dashboard showed "debt 0.0h", which looks like a measured zero.
- The home hero labelled the schedule-based circadian score "Sleep debt". The greeting stated "Recovery looks low" and "You're carrying some sleep debt" as facts, from schedule data only.
- The AI recap displayed a model-generated "Readiness Δ" number. No readiness data is ever sent to the model, so the number was invented. "Sleep recovered N min" was shown even without any wearable data.
- The AI context did not say which data existed, which left the model free to state measurements it did not have.

**Fixed**
- The fatigue and recovery tiles carry "Estimates, not measurements." plus a source line, either:
  - "Calculated from your shift schedule. No wearable sleep data is used.", or
  - "Calculated from your shift schedule, adjusted with N nights of Oura/Fitbit sleep data."
- Wearable readings older than 2 days (history: 7 days) are ignored. Copy states the real number of nights. With no data, sleep debt reads "unknown (no recent wearable sleep data)".
- The hero reads "Schedule strain N/100 · estimates". The schedule-stability card says it is "Estimate calculated from your shift pattern … Not a sleep measurement." Greeting lines describe the schedule.
- AI recap:
  - it is labelled "AI-written" and states its sources;
  - "Readiness Δ" is no longer shown;
  - "Sleep recovered" appears only with real wearable sleep, labelled as an AI estimate.
- `contextString` ends with a data-sources line. Without wearable data it tells the model "Do not state or guess any sleep duration, HRV, heart rate, readiness or other wearable measurement."
- Hydration is labelled "Logged by you on this device … general guide". Health metrics say "Measured by your wearable".
- The schedule-based calculations are unchanged; a test pins the fatigue and recovery values.

**Evidence:** `tests/ai-accuracy.test.mjs` runs the real `computeInsights`. It covers:
- no-data provenance;
- one fresh night: provider, night count, no "7 nights" claim;
- stale data ignored, with the estimate unchanged;
- the calculations pinned;
- the labels present on each screen;
- the recap's readiness number removed and sleep numbers gated on real data.

**For the AI agent (not changed here):** server-side AI context (`src/lib/ai/context.server.ts`) and the response schemas in `src/routes/api/ai.ts` still ask the model for `readinessDelta` and `sleepRecoveredMin`. Remove them, or fill them from measured data server-side, rather than relying on the UI gate.

---

## Issue 8 — Privacy and account controls

Checked by code reading against all 52 Supabase migrations, by handler tests with mocked IO, and against browser storage. No Supabase Storage buckets are used.

| Control | Result |
|---|---|
| Account creation and login | Email/password and Google OAuth through Supabase. Earlier repairs: accessible recovery forms and truthful Forgot Password. Sign in with Apple is not offered in the UI. If it is enabled, deletion must revoke the Apple token (App Store 5.1.1(v)). |
| Password management | Change password: Supabase `updateUser`, minimum 8 characters, confirmation. **Fixed:** the inputs had no accessible names. |
| Data export | Paginated, fails rather than returning a partial export; covers every user table. Not included: `trial_usage`, `ai_request_allowance` (usage counters) and the email logs, which are keyed by email. |
| Account deletion | Every table with `user_id` is either explicitly deleted or cascades from `auth.users`. Stripe is cancelled first, and sign-in is kept on failure so the user can retry. **Fixed:** the owner alert stored the deleted user's email in `ops_alert`, which outlives the account. **Fixed:** sessionStorage (AI recaps) was not cleared after deletion. |
| AI memory deletion | Purges proposals, memories, recommendations, patterns and feedback; fails on partial erasure. **Fixed:** AI content cached on the device is now cleared too. |
| Privacy preferences | **Fixed:** "Pause learning" stopped only pattern proposals. The coach's chat memory extractor kept writing `ai_memory`; it now re-reads consent server-side and fails closed. **Fixed:** the nightly `ai-learn` job wrote "Tends to find/ignore …" memories for anyone with feedback, even with memory off or paused; it now requires consent. The independent reviewer found this one. |
| Wearable data permissions | **Fixed:** disconnect deleted only the tokens, although the policy promises readings are "deleted on disconnect". It now deletes readings, then tokens, then readings again, and reports failures. **Fixed:** the wearable UI is hidden, so earlier users could not revoke access. Profile now lists existing connections and orphaned data with "Disconnect and delete data". |
| Local storage | **Fixed:** sign-out cleared only the offline plan snapshot. AI recaps (sessionStorage, not keyed by user), hydration logs, companion history and legacy local shifts stayed for the next person on the device. They are now cleared; device settings are kept (cookie consent, alarm sound, voice and avatar choice). |
| Subscription management | Production: Stripe billing portal from Profile. Railway: hidden, and deletion fails for active Stripe subscribers (see issue 5). |

**Evidence:** `tests/privacy-controls.test.mjs` runs the real handlers. It covers:
- disconnect order and the failure paths;
- a deletion alert with no email;
- storage clearing, including storage that throws;
- AI cache clearing and the Profile wiring;
- the memory extractor making no model call and no write when memory is paused, disabled, unreadable or missing.

Independent review on #14: one REQUEST_CHANGES round (nightly `ai-learn` wrote memories without consent; fixed, with a test), then APPROVE at `0ce3bcb` (merged `0202fd4`).

**Findings for other owners (not changed here)**
- Memory extractor (AI agent): it saves memories directly. The Memory page says "nothing is saved until you say yes", and the extractor's categories include `health` although the privacy policy says no health memories are kept.
- Retention copy (owner, counsel): `email_send_log` and `email_unsubscribe_tokens` keep the email after deletion, and the deletion confirmation itself adds a row. `suppressed_emails` must be kept to honor unsubscribes. The deletion manifest says `retained: []`. The policy's retention table should name these.
- Apple: in-app deletion exists (Profile → Delete account, typed confirmation). On the Railway build it fails for active Stripe subscribers (issue 5).

---

## Owner-only items
1. **Publish in Lovable** so restpilotai.com stops selling Lifetime. Steps are above.
2. **Archive** the `restpilot_lifetime` price and any Stripe Payment Links for it in the Stripe dashboard.
3. Decide the subscription-retirement plan for the Railway build. Until then, account deletion fails closed for active Stripe subscribers and Profile hides their plan.
4. Decide on memory consent (direct saves, `health` category) and the retention wording for email logs.
