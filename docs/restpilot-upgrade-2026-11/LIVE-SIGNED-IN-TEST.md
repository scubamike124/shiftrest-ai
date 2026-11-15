# RestPilot live signed-in test (production, 2026-11-15)

- **Target:** https://restpilotai.com (Lovable `main`, as published). Nothing was published, and no migration was run.
- **Account:** the owner-approved dedicated test account (Option 1). All data is synthetic: name "WGT Test", job "Paramedic". The account was **not** deleted; tomorrow's White Glove run uses it.
- **Tooling:** Playwright (Chromium, iPhone 13 user agent, America/New_York) at 375 / 390 / 430 px. Every run blocked Stripe checkout and billing, `/api/tts`, `/api/stt`, realtime voice and push/email "send" endpoints at the network layer. Every `confirm()` was dismissed except "Erase AI memory". Nobody clicked "Start 14-day free trial".
- **Window:** 04:45–05:15 UTC (Sat 14 Nov 23:45 → Sun 00:15 New York time).
- **Status key:** PASS · FAIL · PENDING-PUBLISH (already fixed on `main`, live after the owner Publishes) · BLOCKED.

## Feature table

| # | Area | Result | Evidence (live) |
|---|------|--------|-----------------|
| 1 | Sign-in with the saved session; dashboard loads | PASS | `/dashboard` 200; greeting uses the preferred name |
| 1 | Onboarding (intro, name, 6 consent acks) | PASS (done earlier) | `onboarded_at` 04:43:40Z was set during the coordinator's first sign-in (the name was entered as "Michael"). Not repeatable on this account |
| 1 | Profile: preferred name → "WGT Test" | PASS | persists across a reload; dashboard reads "Good evening, WGT Test." |
| 1 | Employer rename "My Job" → "Paramedic" | PASS | Employers list; used as a tag on shifts |
| 1 | Rotation length 2 wks | PASS (saves) | `user_prefs.cycle_weeks = 2` |
| 2 | Shift entry: 7 shifts, Week A days + nights, Week B nights, overnight wrap | PASS | "7 shifts"; the editor shows "Week A/B" and "Overnight shifts are supported" |
| 2 | Shift edit (Sun end 07:00 → 07:30, rename) | PASS | sheet title "Edit shift"; value persisted |
| 2 | **Rotation advances to Week B** | **FAIL → fixed** | 7-day plan labels Mon 16 Nov "Wk A 7a", Wed 18 "Off": Week B shifts never apply. Fix: #53 (main), #59 (migration) |
| 2 | DST-adjacent date | PASS (n/a for shifts) | Shifts are a weekly template, not dated, so no DST date can be entered. Events accept dated entries: 2027-03-14 02:30 (does not exist in New York) was stored as 03:30 EDT (07:30Z) |
| 2 | Plan / 7-day / Long Clock / Companion times agree | FAIL (known + 1 new) | see "Cross-screen times" below. Plan vs Long Clock is fixed only on the migration branch (known). New: the Companion Smart Alarm uses server UTC → #60 / #61 |
| 2 | Sleep streak card | **FAIL (not fixed)** | "14 days in rhythm" with 7 ticks on the account's first day. `SleepStreakCard` counts weekdays that have any template shift and ignores dates and account age |
| 3 | AI Companion chat (5–8 messages) | **BLOCKED** | 1 message sent → `429 {"error":"Daily AI limit reached. It resets in 24 hours."}`. The UI degraded gracefully ("You've reached today's AI limit. I saved what you said…" + Upgrade). See "AI budget" |
| 3 | Dashboard AI cards (coach brief, right now, tomorrow preview, recap) | PASS (content) / FAIL (cost) | Content was sensible, with no medical claims. They consumed the whole free budget (below) |
| 4 | Smart reminders / notification settings | PASS (UI) | OFF by default; headless Chromium reports "Notifications are blocked for this site" with recovery steps. Not enabled, by rule (it would create a push subscription) |
| 4 | Sound mixer (/sleep) | PASS | Rain → "Playing 70%", 15 min sleep timer set ("Sleep timer set: 15 min") |
| 4 | Recovery tools: playbooks, swap copilot, partner mode, routines, inbox | PASS (render) | Playbooks list 5 protocols (not applied, to keep the schedule). Swap needs AI (blocked by the budget). Inbox item added (device-local) |
| 4 | Partner share link | **FAIL → fixed** | decoded `/share#p=` contains each shift's `notes`, `title`, `employerId` and row `id`. Fix: #54 (main), #59 |
| 4 | Calendar: public ICS URL | PASS | Companion Skills → Calendar Agenda → "Test & save" with the Google public US-holidays ICS; feed saved and listed |
| 4 | Events | PASS / FAIL (minor, not fixed) | Events add and persist. Events more than 30 days ahead are saved ("Event added.") but never listed ("Upcoming (0)"), so they can't be seen or deleted |
| 5 | Companion naming | PASS / minor | Custom assistant name "Aura" shows on /companion and /pilot headers. Minor (not fixed): the first Companion bubble says "Winding down, **there**" (prefs not loaded yet), and /pilot says "I'm **Pilot**" whatever the name |
| 5 | Avatar presets (Aura/Nova/Atlas/Sage) | PASS | switched to Nova |
| 5 | Memory page consent toggle | PASS | OFF → ON, persists after a reload; 7 categories each off by default |
| 5 | Add / export / delete memory | PASS | manual memory added; Export downloaded JSON with only that memory; "Delete all → Yes" removed it |
| 5 | Profile "Erase AI memory" | PASS | toast "AI memory cleared." |
| 5 | Branding | **FAIL → fixed** | Skills, Inbox, Smart Home, Routines and calendar/traffic cards call the assistant "**Reelo**" (23 strings). Fix: #55, #59 |
| 6 | Data export | PASS (isolation) / FAIL (completeness) → fixed | 23 KB JSON; one distinct `user_id`, one email (the test account), no other user's data. 13 user tables and `profiles` were missing → #54 (main). The migration branch already had most of them; #59 adds `trial_usage`, `store_entitlements` |
| 6 | Side effect | NOTE | Export sends the transactional email "data-export-ready" to the account address (the owner's +restpilot-test inbox). One such email was sent by this test; it is product behaviour, not a bug |
| 7 | Subscription state shown | PASS | Free: Profile shows "Upgrade to Premium"; `subscriptions` has no rows; paywall offers Monthly $7.99, Annual $49.99 |
| 7 | Lifetime $99 still on the paywall | PENDING-PUBLISH | "FOUNDING MEMBER — LIMITED TIME · LIFETIME $99" (removal #19 is merged on main) |
| 8 | Wearables UI | PASS (as designed) | Profile: "Coming in a future update — Apple Health, Oura, Fitbit, and Whoop." |
| 8 | /health dead end | FAIL (known) | "Connect a wearable" and "Manage connections" both go to /profile, which says "coming in a future update" |
| 8 | Oura / Fitbit OAuth callbacks | PENDING-PUBLISH | `GET /api/public/wearables/{oura,fitbit}/callback?code=x&state=y` → 500 (#38 / #44 merged on main) |
| 9 | Signed-in crawl 375/390/430 × 27 routes | PASS (layout) | 0 horizontal overflow on all 81 page loads. Console: 429s from /api/ai on /dashboard (budget), React #418 on /settings → /settings/companion and /privacy → /legal/privacy redirects, SW preload warnings on /inbox |
| 10 | Delete Account UI | PASS (not used) | Button present; 1st `confirm` text verified ("Delete your account? … cannot be undone."), dismissed; then 2nd confirm + type "DELETE". Account intact |
| 11a | `SAFE_RETURNS` deep-link loss | **FAIL (confirmed live) → fixed** | signed out: /memory, /health, /settings/companion, /inbox → `/auth?return=…` → after sign-in all land on `/dashboard`. Fix: #55, #59 |
| 11b | Wearable dead end | FAIL (confirmed live) | see #8 |
| 11c | Hydration error #418 | FAIL (confirmed live) | `Minified React error #418` (HTML) on every signed-out deep link → /auth, and on /settings → /settings/companion, /privacy → /legal/privacy |
| — | **User can raise own AI cap** | **FAIL (security) → fixed on migration branch; owner SQL for prod** | `PATCH /rest/v1/user_prefs` with `ai_daily_token_cap` returned 200 (tested as a no-op write of the current value 15000). Fix: migration `20261115060000_lock_ai_daily_token_cap.sql` in #59 |

## Cross-screen times (live, before any Publish)

Shift: Saturday 19:00 → Sunday 07:00 (template "Night 12h"); target sleep 8 h; wind-down 120 min; New York (sunrise 6:42 AM, sunset 4:40 PM). Captured 04:55Z (Sat 23:55 local).

| Item | /plan "Today's light plan" | Dashboard Long Clock | Dashboard "Next 7 days" (Sat) | Dashboard "Tonight" | Companion evening cards |
|---|---|---|---|---|---|
| Wind-down | 7:00 AM | 7a | 7:00 AM (120 min) | — | "about 120 minutes before bed" |
| Sleep | 9:00 AM → 5:00 PM | Sleep 9a | 9:00 AM → 5:00 PM | Sleep at 9:00 AM, 8h | **Suggested bedtime 6:00 PM** |
| Wake / alarm | Wake & bright light 5:30 PM | **Alarm 5p** | Wake 5:30 PM | — | **Wake by 2:00 AM** |
| Bright light | 5:30 PM | **6:42a (sunrise)** | 5:30 PM | — | — |
| Caffeine on | 6:30 PM | — | 6:30 PM | — | — |
| Caffeine cutoff | 3:00 AM | **1a** | 3:00 AM | — | — |
| Meal | (none) | (none) | 5:45 PM light pre-shift meal | — | — |
| Recovery | — | 5p | 5:00 PM | — | — |

- Long Clock vs Plan/7-day (caffeine cut 1 AM vs 3 AM; bright light at sunrise vs on waking; alarm 5 PM vs wake 5:30 PM) is the known disagreement. It is fixed on `codex/restpilot-railway-migration` (`schedule-core.ts`), not on `main`.
- **New:** the Companion Smart Alarm ("Wake by 2:00 AM / bedtime 6:00 PM") is 07:00 / 23:00 **UTC**: the evening brief runs on a UTC server and used `setHours(7)`. Fixed in #60 (main) and #61 (migration). The card still ignores night shifts (it defaults to a 7:00 wake): product follow-up.
- The AI "Tomorrow, already planned" card (generated at 04:43Z, before any shift existed) said wake 7:45 AM, caffeine 9:30 AM–1:30 PM, lights out 11:45 PM. It is cached for 3 h and was not regenerated after the night shifts were logged (and could not be: AI budget).

## AI budget (owner decision needed)

- Free tier `ai_daily_token_cap` = 15,000 tokens / rolling 24 h. `ai_log` for the test account: 9 automatic calls (`daily_review` ≈1.5k, `right_now` ≈1.9k, `tomorrow_preview` ≈1.8k tokens) from three dashboard visits between 04:43 and 04:45Z = **15,748 tokens**. After that every `/api/ai` call returns 429, including Companion chat. **A new free user can exhaust the day's AI by opening the dashboard about three times without ever chatting.** Those caches live in `sessionStorage`, so every new tab or app launch regenerates them.
- Suggested fixes (not made; product/cost decision): cache the automatic cards in `localStorage` per user per day, exempt them from the chat budget or give them their own small budget, and/or raise the free cap.
- For tomorrow's run and the AI-quality batch, the owner must lift this account's cap: grant the `tester` role or raise `ai_daily_token_cap` in the Supabase SQL editor (see `restpilot-test-account-status.md`). The cap-lock migration still allows changes from the SQL editor (it runs as the database owner).

## AI companion notes

- No chat replies could be judged (budget). The automatic dashboard texts were on-topic, used no medical claims, and quoted no measurements beyond the app's own scores. One sentence overstated: "It is rare to see a perfect 100 score", given for a brand-new account with no data (fatigue 0/100, recovery 100/100 shown as "Peak").
- "Voice replies on" is the default: after the one chat reply the client immediately requested `/api/tts` (blocked by the test harness). Each reply therefore uses TTS credits unless the user turns it off.

## Fix PRs

| PR | Base | What | Status |
|----|------|------|--------|
| #53 | main | rotation weeks advance without a saved anchor | open, review requested; fixed, pending Publish once merged |
| #54 | main | share link carries only times; export covers all user tables | open, review requested; fixed, pending Publish once merged |
| #55 | main | deep-link return paths; "Reelo" → RestPilot | open, review requested; fixed, pending Publish once merged |
| #60 | main | Companion evening Smart Alarm in the user's time zone | open, review requested; fixed, pending Publish once merged |
| #59 | migration | ports of #53–#55 + AI-cap lock migration | open; merge after independent APPROVE + green CI |
| #61 | migration | port of #60 + this document | open; merge after independent APPROVE + green CI |

## Not fixed (logged for follow-up)

1. Free AI budget exhausted by automatic dashboard cards (owner decision; see above).
2. Sleep streak shows 14 days on day one (fabricated metric).
3. Events more than 30 days ahead are saved but hidden on /events.
4. Companion first bubble "Winding down, there"; /pilot "I'm Pilot" ignores the custom name.
5. React hydration #418 on redirects (known).
6. /health wearable dead end (known; wearables are "coming in a future update").
7. Smart Alarm ignores night shifts.

## Screenshots and raw output

Kept outside the repo (they show the test account's email): `scratchpad/rp-live-test/` — `s2-*` schedule, `t5-*` cross-screen, `f7-*`…`f11-*` features, `c375-*`, `c390-*`, `c430-*` crawl screenshots and text dumps, `dl_*` deep-link landings, `chat-companion-*`.
