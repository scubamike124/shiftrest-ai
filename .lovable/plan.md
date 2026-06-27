
# QA Round 2 — Bug Fix Plan

No new features. Each priority is investigated, fixed, then verified on iPhone Safari (375px) and desktop (1440px). After every fix I run a targeted Playwright pass + console/network check before moving on.

## Priority 1 — AI Activity Log (duplicate spam)

**Investigate**
- Read `src/lib/ai/decisions.ts`, the writer call sites (orchestrator `/api/ai`, dashboard cards, `LongClock`, recommendation accept/snooze, coach-window adjustments).
- Confirm whether duplicates originate from repeated server writes or from the feed's groupBy render.

**Fix**
- Add a dedupe guard in `logDecision()`: skip insert when the previous row for `(user_id, kind, summary)` is < 60s old (server-side check via `ai_log`/`user_events`).
- Debounce "Coach window updated" style system events on the client writer (60s window, in-memory map keyed by event signature).
- Strengthen the feed collapser in `DecisionCenterCard` / Activity feed to merge consecutive identical `summary` rows into one entry with a count badge regardless of timestamp gap within the same hour.
- Backfill clean-up: a one-shot migration that collapses existing consecutive duplicates is **not** required — UI collapser hides them.

## Priority 2 — Voice Briefing verification

- Drive `/plan` via Playwright: trigger briefing, capture loading shimmer, cancel mid-stream, replay, simulate offline (`context.set_offline(true)`), force TTS failure (mock 500 from `/api/tts`), force gateway timeout (8s).
- Confirm `VoicePlayer.tsx` re-entry guard releases on every terminal state (success, error, cancel, timeout). Add a `finally { setBusy(false) }` if any branch leaks.
- Add an 20s `AbortController` timeout to `/api/brief` + `/api/tts` fetches; surface friendly toast on abort.

## Priority 3 — Coach chat readability

- Update coach system prompt (`COACH_VOICE` in `src/routes/api/ai.ts`) to require short sections, `##` headings, bullets, no bold-asterisk emphasis.
- In `src/routes/coach.tsx` message renderer:
  - Strip stray `**` artifacts post-stream (`text.replace(/\*\*/g, '')` only when markdown parser left them).
  - Already using `react-markdown`; ensure `prose` classes + spacing.
  - Wrap any message > 1200 chars in a `<CollapsibleSection>` with "Show more" toggle (default collapsed after first 600 chars).
  - Add `<details>` style collapsibles for any `### Details` heading the model emits.

## Priority 4 — Events (Calendar / Commute / Personal)

- Audit `src/routes/events.tsx` + `user_events` server fns.
- Add Zod validation (title required, start < end, travel buffer 0–180 min).
- Verify save/edit/delete round-trip via Playwright; assert row in `user_events` after each.
- Reminders: ensure the notification scheduler subscribes on save and unsubscribes on delete.
- Imports (.ics): catch parse errors, toast on failure, never silently drop.

## Priority 5 — Profile persistence

- For every control listed, confirm: (a) load reads from `user_prefs` / `profiles` / `employers` / `wearable_connections`, (b) change handler calls server fn, (c) success toast, (d) value survives `router.invalidate()` + reload.
- Fix any optimistic-only updates by awaiting the mutation and invalidating the query.
- Export, Erase AI Memory, Delete Account already wired in `src/lib/account.functions.ts` — re-verify end-to-end.

## Priority 6 — Smart Reminders button

- Replace the dead "Not supported" state in the notifications panel with branching logic:
  - **Push API + ServiceWorker + Notification supported & permission default** → "Enable reminders" button → `Notification.requestPermission()` → subscribe via VAPID.
  - **iOS Safari without standalone PWA** → show "Add RestPilot to your Home Screen to enable reminders" with a 3-step instruction list (Share → Add to Home Screen → Open from icon).
  - **Permission denied** → explain how to re-enable in browser settings.
  - **Unsupported browser** → name the browser and recommend Safari/Chrome.

## Priority 7 — Upgrade card

- Stripe billing is live → wire the "Upgrade to Premium" CTA on the dashboard to `/paywall`.
- If `has_active_subscription(user)` is true, hide the card entirely.

## Priority 8 — Playbooks

- For each preset in `src/routes/playbooks.tsx`: open detail sheet, show explanation + preview (before/after circadian), Apply writes to `user_prefs.active_playbook` + adjusts wind-down/target sleep, Save persists.
- Add empty-state and error-state for any preset missing data.

## Priority 9 — Plan page polish

- iPhone Safari 375px audit: tighten card padding (`p-4` not `p-6`), reduce hero type scale, ensure horizontal scroll = 0, use `overflow-x-clip` on the page root, verify button min-height 44px, fix any clipped circadian ring.
- Desktop 1440px: confirm bento grid spacing stays consistent.

## Priority 10 — Final regression

Playwright sweep with authenticated session across: Home, Plan, Coach, Events, Profile, Voice Briefing, AI Activity, Memory, Partner Mode, Wearables, Legal, Export, Delete (against disposable user).

Capture:
- Console errors (must be 0)
- React warnings (must be 0)
- Failed network requests (must be 0)
- Duplicate AI events (must be 0)
- Broken nav / placeholders / unfinished screens (must be 0)

## Deliverable

A checklist returned in chat:

```text
P1 Activity dedupe        ✅ Fixed  ✅ Verified  ✅ Tested
P2 Voice Briefing states  ✅ Fixed  ✅ Verified  ✅ Tested
P3 Coach formatting       ✅ Fixed  ✅ Verified  ✅ Tested
P4 Events CRUD            ✅ Fixed  ✅ Verified  ✅ Tested
P5 Profile persistence    ✅ Fixed  ✅ Verified  ✅ Tested
P6 Smart Reminders        ✅ Fixed  ✅ Verified  ✅ Tested
P7 Upgrade card           ✅ Fixed  ✅ Verified  ✅ Tested
P8 Playbooks              ✅ Fixed  ✅ Verified  ✅ Tested
P9 Plan layout            ✅ Fixed  ✅ Verified  ✅ Tested
P10 Final regression      ✅ Clean
```

Plus any non-blocking advisories logged to `docs/launch/remaining-issues.md`.

## Order of execution

P1 → P3 → P6 → P7 → P9 (highest user-visible impact, smallest blast radius)
then P2 verification → P4 → P5 → P8
then P10 full regression.

Approve and I'll start with P1.
