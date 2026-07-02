# AI Companion Final Polish — Investigation & Plan

Investigation complete. No code changes yet. Below is the file map, dependencies, complexity, and a safe implementation order for the 15 items.

---

## Item-by-item investigation

### 1. Personalized greetings
- **Current**: Static greetings live in `src/components/home/GreetingHeader.tsx` (`greeting()`), `src/lib/companion/hero-state.ts`, `src/components/morning/cards/GreetingCard.tsx`, and are also generated in `src/routes/api/brief.ts` and `src/routes/api/ai.ts` (server-side).
- **Fix**: Introduce a single server helper `src/lib/companion/personalized-greeting.server.ts` that combines: time bucket, last night's sleep score, recovery score, next shift, next smart alarm, active recommendation. Return `{ salutation, contextLine }`. Feed it into `/api/brief` (spoken + cards) and expose via a small `/api/greeting` used by `GreetingHeader` and `CompanionHero`.
- **Complexity**: M.

### 2. Time-of-day consistency
- **Current**: Buckets are defined independently in `GreetingHeader.tsx` (5/12/17/22), `GreetingCard.tsx` (early/morning/midday), `hero-state.ts`, `lib/ai/time-directive.ts`, and `brief.ts`. Boundaries and labels differ.
- **Fix**: Add `src/lib/time/day-part.ts` exporting `getDayPart(date, tz)` → `"morning" | "afternoon" | "evening" | "night"` with canonical labels `"Good morning" | "Good afternoon" | "Good evening" | "Winding down"`. Replace every ad‑hoc bucket calc with this helper. Guarantees home, spoken brief, notifications, and hero all say the same phrase for the same moment.
- **Complexity**: S.

### 3. Preferred name everywhere
- **Current**: `CompanionHero` already reads only `user_prefs.preferred_name`. `GreetingHeader` receives `name` from the dashboard route — need to confirm it's not falling back to email/username. Server (`brief.ts`, `ai.ts`, `notifications/run.server.ts`) still uses several fallbacks in a couple of paths.
- **Fix**: 
  - Central helper `src/lib/user/display-name.ts` (client) + `src/lib/user/display-name.server.ts`: returns `preferred_name` only, empty string if unset.
  - Update `dashboard.tsx` to source name from `user_prefs.preferred_name` (not `profiles.username`).
  - Onboarding (`src/components/Onboarding.tsx`) — first step copy → "What would you like me to call you?" and writes to `user_prefs.preferred_name`.
  - Server callers use `.server` helper for greetings + notification templates.
- **Complexity**: S–M.

### 4. AI voice everywhere
- **Current**: Voice selection is in `src/components/voice/VoiceSettings.tsx` and stored on `user_prefs` (`voice_*` columns). `VoicePlayer`, `/api/tts`, and `/api/tts-elevenlabs` accept a per-request voice, but some callers pass no voice and get the default.
- **Fix**: In `/api/tts` + `/api/tts-elevenlabs`, when the request omits a voice, resolve `user_prefs.default_voice_id` server-side. Ensure Pilot, Companion, Brief, Wind-down, and Smart Alarm coach all call TTS without hard-coded voice ids so the server resolves the user's favorite.
- Tone: pass `stability`/`similarity` presets tuned for "calm & slow" (ElevenLabs `stability=0.6`, `style=0.15`, `speaker_boost=true`, `speed=0.92`).
- **Complexity**: S.

### 5. Favorite voice
- **DB**: Add column `user_prefs.default_voice_id text` (migration). Also `default_voice_provider text` if needed.
- **UI**: In `VoiceSettings.tsx`, add a ★ button per voice → writes `default_voice_id`. Show "Default" badge.
- **Server**: Above `/api/tts` change reads this column when no override.
- **Complexity**: S.

### 6. Companion home screen fill-out
- **File**: `src/routes/companion.tsx`.
- **Add cards** (reuse existing components where possible):
  - Recovery Score + Sleep Score → new `CompanionScoresCard` (data from `/api/brief` + wearable_readings).
  - Today's Focus → derived from `ai_recommendations`.
  - Today's Schedule → existing `AgendaCard`.
  - AI Recommendation → `AIBriefCard` compact variant.
  - Recent Conversations → last 5 `coach_messages`.
  - Quick Questions → predefined chips → open `/companion` with prefilled prompt.
  - Smart Suggestions → `routine_suggestions` top 2.
  - Upcoming Alarm → shows next `user_events` (kind=smart-alarm).
  - Recovery Progress → 7‑day sparkline.
- Keep the large Talk button pinned. Use a 2‑column grid on desktop, single column on mobile with subtle stagger fade‑in.
- **Complexity**: M–L.

### 7. Employer cards
- **File**: `src/components/EmployersManager` (search: `employers` table). Uses `employers` (18 cols) — should already have `color` or similar; if not, migration adds `icon text`, `color text`.
- **UI**: Preset picker (Hospital, Fire, Police, Airline, Manufacturing, Corporate, Custom) with matching emoji/lucide icon and color chip. Card shows icon + name + shift stats. Custom option = free‑text icon or emoji + color.
- **Complexity**: S.

### 8. Partner Mode (short share links)
- **DB**: New table `partner_shares` (id serial code text UNIQUE, user_id, payload jsonb, expires_at, created_at). Grants + RLS.
- **API**: `POST /api/public/partner-share` (auth'd creator: server fn generates 6-char code) returning `restpilotai.com/share/{code}`. `/share/$code.tsx` route resolves it. QR via `qrcode.react` (add package).
- **UI**: New `PartnerShareCard.tsx` with Share (Web Share API), Copy, QR, preview iframe. Illustration: simple SVG "You → Partner" with moon.
- **Complexity**: M.

### 9. Location card
- **File**: `src/components/weather/WeatherLocationCard.tsx` + new `LocationCard.tsx` on dashboard. Data from `user_prefs.current_tz`, geolocation permission → reverse geocode via Open‑Meteo, sunrise/sunset from Open‑Meteo daily.
- Add short explainer "Why location matters — jet lag, circadian light, sunrise timing."
- **Complexity**: S.

### 10. Shift Swap Copilot + "Missing authorization"
- **File**: `src/routes/swap.tsx`, `src/routes/api/swap.ts`. Auth bug is likely same class as AIBriefCard — client `fetch("/api/swap")` without `Authorization: Bearer`. Confirmed pattern seen elsewhere.
- **Fix (bug)**: attach bearer in swap client fetch; add friendly signed-out state.
- **Fix (feature)**: Extend `/api/swap` to compute Recovery Cost, Sleep Debt delta, Fatigue peak, Recovery timeline (hours), Recommended decision (accept/decline/counter), rationale, alternative swaps. Render as a stacked results card with confidence badge.
- **Complexity**: M.

### 11. Upgrade card position
- **File**: `src/routes/dashboard.tsx` (and `companion.tsx`). Move `<UpgradeCTA>` below Focus/Recommendation section, above footer. No new component.
- **Complexity**: XS.

### 12. AI personality options
- **DB**: extend `user_prefs.assistant_mode` allowed values. Current is a text column, so no enum migration needed. New set: `coach | friend | professional | minimal | warm | encouraging | motivational | supportive`.
- **Server**: `src/lib/ai/context.server.ts` — extend `MODE_OVERLAYS` with new personas and per‑mode voice prompt tweaks.
- **UI**: `AssistantSettings.tsx` — replace three-way selector with card grid, each with 1‑line personality description.
- **Complexity**: S.

### 13. Micro-animations
- Use existing tailwind animations plus Motion/React (`framer-motion` already present via companion). Additions:
  - Route transitions in `__root.tsx` `<Outlet>` wrapper.
  - `animate-fade-in` staggers on dashboard/companion card grids.
  - Talk button press → subtle spring.
  - AI thinking → reuse `ThinkingShimmer`.
  - Haptics via `navigator.vibrate(8)` in a `useHaptic()` hook.
- **Complexity**: S.

### 14. AI Avatar prep
- Existing: `Avatar.tsx`, `Avatar3D.tsx`, `CompanionAvatar.tsx`, Simli lab. 
- Prep work only: 
  - Extract emotion state → `src/lib/companion/avatar-emotion.ts` (idle/listening/speaking/celebrate/comfort).
  - Wire STT/TTS events to state store.
  - Blink loop + soft breathing motion (framer-motion) on Avatar.
  - Add "avatar reactions" hook `useAvatarReactions()` used by brief screens.
- Full lip‑sync/expression pipeline stays for Phase 1 completion later.
- **Complexity**: M.

### 15. Overall companion feel
- Cross‑cutting: consistent copy tone pass, ensure every empty state has warm microcopy, no raw errors. Add `WelcomeBackHero` on companion first-visit-per-day.

---

## Dependency graph

```text
[2 day-part helper] ──┐
                      ├─► [1 personalized greeting] ──► [6 companion home cards]
[3 preferred name] ───┘                                 │
                                                        ├─► [11 upgrade card move]
[5 favorite voice DB] ──► [4 voice everywhere] ────────►│
                                                        │
[10 swap auth fix] ──► [10 swap copilot logic] ────────►│
[7 employer schema] ──► [7 employer cards UI] ─────────►│
[8 partner_shares tbl] ──► [8 share UI + /share route] ►│
[9 location data]      ─────────────────────────────────►│
[12 personality] ─► [context.server prompt] ────────────►│
[13 micro-animations]  ─── applied last across all screens
[14 avatar prep]       ─── parallel, isolated to companion route
```

---

## Recommended implementation order (safe → shippable in batches)

1. **Batch F-1 — Foundations (no UI risk)**
   - Item 2 day-part helper
   - Item 3 preferred-name helpers + Onboarding copy
   - Item 5 migration `default_voice_id`
   - Item 12 personality overlays in `context.server.ts`
   - Migration: `partner_shares`, `employers.icon/color` if missing.

2. **Batch F-2 — Voice & Greeting**
   - Item 1 `personalized-greeting.server.ts` + wire to `/api/brief`
   - Item 4 TTS default-voice resolution + calm preset
   - Item 5 ★ favorite UI in `VoiceSettings`

3. **Batch F-3 — Bug fixes**
   - Item 10a swap "Missing authorization" bearer fix (mirrors AIBriefCard fix)

4. **Batch F-4 — Companion home**
   - Item 6 cards on `/companion`
   - Item 11 move Upgrade CTA
   - Item 9 Location card
   - Item 7 Employer card visuals

5. **Batch F-5 — Partner Mode + Swap Copilot**
   - Item 8 short share links + QR
   - Item 10b Swap decision engine output

6. **Batch F-6 — Polish**
   - Item 13 micro-animations
   - Item 14 avatar prep hooks + idle/blink

Each batch is independently publishable and rolls back cleanly.

---

## Files touched (summary)

- New: `src/lib/time/day-part.ts`, `src/lib/user/display-name.ts` (+ `.server.ts`), `src/lib/companion/personalized-greeting.server.ts`, `src/lib/companion/avatar-emotion.ts`, `src/components/companion/CompanionScoresCard.tsx`, `PartnerShareCard.tsx`, `LocationCard.tsx`, route `src/routes/share.$code.tsx`, `src/routes/api/public/partner-share.ts`.
- Modified: `GreetingHeader.tsx`, `GreetingCard.tsx`, `hero-state.ts`, `time-directive.ts`, `api/brief.ts`, `api/ai.ts`, `api/tts.ts`, `api/tts-elevenlabs.ts`, `api/swap.ts`, `swap.tsx`, `companion.tsx`, `dashboard.tsx`, `VoiceSettings.tsx`, `AssistantSettings.tsx`, `Onboarding.tsx`, `context.server.ts`, `notifications/run.server.ts`, `EmployersManager` + `WeatherLocationCard.tsx`, `__root.tsx`, `Avatar.tsx`.
- Migrations: `default_voice_id`, `partner_shares`, employers icon/color if absent.

## Risk & complexity totals
- XS: 1  · S: 7  · M: 5  · L: 1 (companion home).
- Highest risk: Item 6 (largest surface) and Item 8 (new public route). Mitigated by keeping each in its own batch with feature flag `COMPANION_HOME_V2`.

Awaiting approval to begin **Batch F-1**.
