# Phase 1 — AI Companion (Investigation & Plan)

Goal: turn RestPilot from a sleep app into a daily AI companion that talks, listens, remembers, and acts. Everything below is investigation only — nothing ships until you approve.

---

## 1. Scope decisions you should make before we build

A few of the requests have real cost/scope trade-offs. Calling them out up front so we don't over-promise:

1. **Animated avatar with realistic facial expressions while speaking.** True photoreal lip-sync (D-ID / HeyGen / Ready Player Me + visemes) is paid third-party + heavy on mobile. Recommended path: ship a **stylized animated avatar** (SVG/Lottie or Rive) with mouth/eye/brow states driven by TTS volume + sentiment. Photoreal can be a v2 toggle.
2. **Smart-home control.** Real device control (Google Home, Alexa, HomeKit, SmartThings) requires per-vendor OAuth, certification, and in some cases native apps. Recommended path: ship a **Smart Home Hub UI + voice intents now**, wired to a pluggable provider layer, with **Home Assistant (long-lived token)** as the first real backend and "Coming soon" badges on Google/Alexa/HomeKit until we add them. This keeps the UX honest.
3. **Coffee maker / garage / vacuum, etc.** Same as above — exposed through the generic device layer, not bespoke per brand.
4. **Traffic intelligence with learned favorite places.** Needs a routes/places table and a maps provider (Google Maps Distance Matrix or Mapbox). Open-Meteo is weather only.
5. **Full voice control of the app.** We already have STT + TTS. The new piece is an **intent router** so spoken commands actually *do* things (play rain, set alarm, etc.) instead of just chatting.

If you want any of these descoped, say so and I'll trim before build.

---

## 2. Implementation plan (feature by feature)

### 2.1 AI Avatar Companion
- New `/companion` route + a persistent **CompanionDock** (floating, dismissible) on dashboard.
- Avatar picker: 6 stylized presets + "Upload photo" (stored in a new `avatars` Storage bucket, private, signed URLs).
- Custom name → already supported via `user_prefs.assistant_name`; expose it in the avatar picker.
- Animation: Rive or Lottie file with states `idle / listening / thinking / speaking / happy / concerned`. Mouth opens off the TTS `<audio>` `AnalyserNode` volume, blinks on a timer, expression chosen from a lightweight sentiment tag the LLM returns alongside text.
- Companion Mode toggle in Profile → drives whether the dock auto-greets, proactively whispers, and uses warmer phrasing (reuses existing `assistant_mode = "companion"`).
- Greetings ("Welcome home, Michael", "I noticed tomorrow is a workday") run through the existing `/api/ai` orchestrator with a new `companion_greeting` intent.

### 2.2 Sleep Environment (Soundscape Mixer)
- 14 looping audio tracks (rain, ocean, river, fireplace, forest, wind, thunder, white/brown/pink noise, fan, coffee shop, crickets, cabin) stored in `public/sounds/` as ~1–2 MB seamless OGG/MP3 loops.
- New `Mixer` (Web Audio API): each sound = its own `AudioBufferSourceNode` + `GainNode`, mixed to a master gain, with crossfade, fade-in/out, and an optional sleep timer.
- New `/sleep` route with per-sound volume sliders, presets (Storm, Cozy Cabin, Coastal, Deep Sleep), and a "Save mix" button.
- Persisted in new table `sound_mixes (user_id, name, tracks_json, is_favorite)`.
- AI recommendation: a new `sound_suggestion` intent reads recent fatigue + time of day and proposes a preset; surfaces as a chip on the dashboard and the dock.

### 2.3 Full Voice Control (Intent Router)
- New server file `src/lib/ai/intent-router.server.ts`. After STT transcribes the user, we send the text to the LLM with a tight JSON schema:
  ```
  { intent: "play_sound" | "set_alarm" | "start_breathing" | "sleep_mode" | "ask_question" | ...,
    args: { ... }, speak: "short confirmation" }
  ```
- Intents we'll ship in v1: `play_sound`, `stop_sound`, `set_alarm`, `cancel_alarm`, `start_breathing`, `sleep_mode_on/off`, `read_schedule`, `weather_now`, `morning_brief`, `smart_home_action`, `ask_question` (fallback to normal chat).
- Pilot already handles barge-in + TTS; we add an `onIntent(result)` callback that dispatches into the right client module (Mixer, Smart Alarm, etc.).
- Confirmation pattern: AI speaks a one-line ack ("Playing rain for 30 minutes") then executes — no extra menu taps.

### 2.4 Smart Morning Assistant
- Already have `/api/brief` + `AIBriefCard`. Upgrades:
  - Pull **sleep summary + score** from the existing insights engine.
  - Pull **weather + sunrise** from existing Open-Meteo wrapper.
  - Add **traffic & departure** (see 2.6).
  - Pull today's **calendar events** from `user_events`.
  - Coffee reminder = a new optional `user_prefs.coffee_time_offset_min` ("15 min after wake").
- Auto-trigger between wake−10 min and wake+30 min when the user opens the app; play through Pilot voice.

### 2.5 Smart Home Integration
- New tables:
  - `smart_home_providers (id, user_id, provider, status, credentials_encrypted, created_at)`
  - `smart_home_devices (id, user_id, provider_id, external_id, name, type, room, capabilities_json, last_state_json)`
- Provider abstraction in `src/lib/smarthome/`:
  - `provider.ts` interface (`listDevices`, `runAction`)
  - `home-assistant.server.ts` (first real provider — uses user-supplied URL + long-lived token)
  - `mock.server.ts` (for demos / testers)
  - Google/Alexa/HomeKit stubs flagged "Coming soon" until OAuth is wired.
- `/smart-home` route: connect provider, list devices, room grouping, toggle/run actions.
- Voice intent `smart_home_action` → `{ device, action, value }` runs through the active provider.
- All credentials live server-side; we never expose tokens to the client.

### 2.6 Traffic Intelligence
- New tables:
  - `places (user_id, label, kind: "work"|"school"|"gym"|"custom", lat, lng, address)`
  - `commute_log (user_id, place_id, departed_at, arrived_at, duration_min)` — for "learned normal"
- Server fn `predictDeparture(placeId, arriveBy)` → calls **Google Maps Distance Matrix** (preferred) or Mapbox with departure-time traffic, compares to the user's 14-day median, and returns `recommendedDepartUtc + delta`.
- Surfaced in the morning brief and via voice ("When should I leave for work?").
- Requires one new secret: `GOOGLE_MAPS_API_KEY` (or Mapbox). I'll request it before we build this slice.

### 2.7 Long Clock
- Already have a base `LongClock` component. Upgrades:
  - New table `countdowns (user_id, label, target_utc, kind, recurring, notify_offsets_min[], theme)`.
  - Built-in types: Bedtime (auto from prefs), Vacation, Birthday, Anniversary, Retirement, Holiday, Custom.
  - `/clock` route: list + add/edit, drag to reorder, theme picker (color + icon).
  - Notifications via existing push pipeline using `notify_offsets_min`.

### 2.8 AI Memory
- We already have `ai_memory` + a `/memory` page + ranking. Upgrades for the companion:
  - New first-class categories: `music`, `sleep_sound`, `bedtime`, `wake_time`, `coffee`, `family`, `work_schedule`, `place`, `routine`.
  - **Confirm-before-save**: when the extractor finds a candidate, the companion asks "Want me to remember that?" before persisting (respects "AI should never make personal assumptions").
  - Memory page already supports view/edit/delete/export/toggle — we add category filters and "Why is this remembered?" rationale.

### 2.9 Voice-First Experience
- The intent router (2.3) is the foundation. On top of it:
  - A **wake gesture** — large mic button on dashboard + dock; PTT (push-to-talk) on mobile, hold-to-talk on desktop. No always-on hot-word in v1 (battery + privacy).
  - All key flows ("Goodnight", "I'm stressed", "Play rain", "Wake me at six", "Read tomorrow's schedule") map to intents.
  - Pilot keeps brevity rules; confirmations ≤ 1 short sentence.

---

## 3. Architecture summary

```text
                 ┌──────────────┐
   mic / text →  │   /api/stt   │ → transcript
                 └──────┬───────┘
                        ▼
                 ┌──────────────┐     intent JSON      ┌───────────────────┐
                 │ /api/ai      │ ───────────────────► │ intent-router      │
                 │ (orchestrator│                      │ (client dispatch)  │
                 │  + memory +  │                      │  ├─ Mixer          │
                 │  patterns)   │                      │  ├─ Smart Alarm    │
                 └──────┬───────┘                      │  ├─ Smart Home fn  │
                        │ text + sentiment              │  ├─ Long Clock     │
                        ▼                              │  └─ Chat fallback  │
                 ┌──────────────┐                      └───────────────────┘
                 │   /api/tts   │ → audio → Avatar visemes
                 └──────────────┘
```

- Memory writes go through a new `proposeMemory()` helper that requires user confirmation before insert.
- All new server logic lives in `createServerFn` or `/api/*` routes; `supabaseAdmin` only inside handlers.

---

## 4. Backend / database changes (migrations)

New tables (each with GRANTs + RLS scoped to `auth.uid()`):
- `avatars` (Storage bucket, private)
- `sound_mixes`
- `smart_home_providers`, `smart_home_devices`
- `places`, `commute_log`
- `countdowns`

`user_prefs` adds: `companion_enabled`, `avatar_id`, `coffee_time_offset_min`, `voice_ptt_only`.

`ai_memory.category` enum extended with the new categories in 2.8.

---

## 5. Third-party services & secrets

| Service | Why | Secret |
| --- | --- | --- |
| Google Maps Distance Matrix (or Mapbox) | Traffic + departure prediction | `GOOGLE_MAPS_API_KEY` |
| Home Assistant (user-owned) | First real smart-home provider | user-supplied URL + token |
| Rive / Lottie asset | Avatar animation | none (static asset) |
| (Already have) Lovable AI, Open-Meteo, BigDataCloud, OpenAI STT/TTS via gateway | — | existing |

No new always-on subscriptions required to ship v1.

---

## 6. Privacy & security
- Avatars + smart-home tokens stored server-side; RLS scoped to owner; signed URLs only.
- Memory writes are opt-in and confirmation-gated.
- Voice audio is sent to STT and discarded; we never store raw audio.
- Smart-home provider credentials encrypted at rest (pgcrypto) and never returned to the client.
- New legal copy: smart-home + maps disclosure added to Privacy Policy and Third Parties page.

---

## 7. Recommended build order

1. **Soundscape Mixer + /sleep** (self-contained, high user value, no new APIs).
2. **Intent Router + voice commands for sounds & alarm** (unlocks voice-first).
3. **Avatar Companion v1** (stylized Rive avatar, expression states, dock).
4. **Smart Morning Assistant upgrade** (sleep score + calendar + coffee).
5. **Long Clock complete**.
6. **AI Memory: confirm-before-save + new categories**.
7. **Traffic Intelligence** (needs Google Maps key).
8. **Smart Home Hub UI + Home Assistant provider** (Google/Alexa/HomeKit stay "Coming soon").

Each slice is independently shippable and reversible.

---

## 8. Risks & recommendations
- **Photoreal avatar** is a rabbit hole; stylized Rive ships in days, photoreal is weeks + per-minute cost. Recommend stylized.
- **Always-on wake word** drains battery and triggers app-store review pain on iOS Safari (not supported anyway). Recommend PTT mic button.
- **Smart-home certification** for Google/Alexa/HomeKit takes weeks. Recommend Home Assistant first, stubs elsewhere.
- **Audio loop file size**: 14 tracks × ~1.5 MB = ~21 MB. We'll lazy-load per track, not bundle.
- **Voice intent misfires**: mitigate with a confirmation line ("Playing rain for 30 minutes — say 'cancel' to stop").

---

## 9. Open questions before I start

1. Stylized animated avatar (Rive) for v1, photoreal later — OK?
2. Smart-home v1 = **Home Assistant only**, others "Coming soon" — OK?
3. Approve adding **Google Maps Distance Matrix** for traffic (I'll ask for the key when we get to step 7)?
4. Build order above (Sounds → Voice → Avatar → Morning → Clock → Memory → Traffic → Smart Home) — keep, or reshuffle?

Awaiting approval before any code changes.
