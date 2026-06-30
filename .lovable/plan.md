# Investigation Report — 3 Launch Blockers

Earlier internal errors were transient. Nothing was implemented since the Preferred Name publish. No duplicate work.

---

## ISSUE #1 — First greeting still says "Scubamike124"

### Root cause
`src/routes/companion.tsx` was **missed** in the Preferred Name pass. It has its own local `firstName()` that still falls back to `partnerName` → **email prefix** → "there", and never reads `prefs.preferredName`.

```ts
// src/routes/companion.tsx:95
function firstName(p: Prefs, email: string | null): string {
  if (p.partnerName?.trim()) return p.partnerName.trim().split(/\s+/)[0];
  if (email) return email.split("@")[0]...;  // ← "Scubamike124"
  return "there";
}
```
Called in 3 places: greeting text (L349), greeting speak (via `greetingTextRef`), and the visible hero greeting (L1313).

Also still wrong:
- `src/components/companion/CompanionHero.tsx` — `firstNameFromEmail(data.user?.email)` fallback (L32, 74). Reads `profiles.display_name` then email prefix; never reads `preferred_name`.

Not cached in localStorage/sessionStorage — it's recomputed each render from `useSession().user.email` + `prefs.partnerName`. So as soon as the code uses `prefs.preferredName`, the next mount is correct (no cache bust needed).

### Smallest fix
1. `src/routes/companion.tsx` `firstName()` → `return p.preferredName?.trim() || "there"`. Drop the `email` argument and the email-prefix branch. Update both call sites.
2. `src/components/companion/CompanionHero.tsx` → fetch `user_prefs.preferred_name` (mirror the `ArrivalHero` pattern) and drop `firstNameFromEmail` + the `profiles.display_name` read.

Risk: very low. If `preferredName` is empty for some legacy user, the greeting becomes "Hi, I'm here." / "Hi there, I'm here." — already the documented fallback.

---

## ISSUE #2 — First greeting too loud / fast on iPhone

### Root cause
The greeting **does** go through `speak()` → same `speakQueued` pipeline, same ElevenLabs preset, same `VOICE_GAIN`. So it isn't a different audio path. Two real causes remain:

1. **Sentence shape.** Opener is `"Hi {Name}, I'm here. How can I help tonight?"` — a very short lead clause with no leading punctuation. ElevenLabs renders short, punchy openers ~10–15% louder/faster than mid-prose sentences. We already proved this on the Dashboard Voice Briefing and fixed it by prepending `"… "` in `VoicePlayer.tsx`. The Companion greeting never got that softener.
2. **iOS first-unlock transient.** On the very first playback after `AudioContext.resume()`, Safari's output gain ramps up over ~80 ms. With a hard-consonant opener ("Hi"), the perceived loudness spikes. Once the context is warm, every later reply sounds normal — matches the user's report exactly.

Files involved: `src/routes/companion.tsx` (L351–356 builds `opener`, L385 speaks it), `src/lib/companion/speak.ts` (pipeline — already correct).

### Smallest fix
In `src/routes/companion.tsx`, prepend the same `"… "` soft lead-in we use for the briefing, and add a tiny clause-break comma so ElevenLabs eases in:
```ts
const opener = `… Hi ${name}. I'm here — how can I help tonight?`;
// (sleep variant similarly softened)
```
That alone matched briefing loudness in our prior fix. No pipeline changes, no gain changes.

Risk: cosmetic only. The visible text on screen shows the leading "…", which looks intentional ("soft pause"); if you'd rather hide it visually we can store `displayText` vs `spokenText` separately (slightly larger change).

---

## ISSUE #3 — Smart Alarm doesn't work

### What exists today
- UI (`SmartAlarmCard.tsx`) → `aiSmartAlarm()` picks the time → writes a `user_events` row with title `"Alarm: 7:15 AM"`, `kind: personal`.
- Cron worker (`run.server.ts` + `schedule.ts` L168–183) reads upcoming personal events with `title ~ /^alarm:/i`, builds a `smart-alarm` candidate, and dispatches it as a **Web Push notification** marked `critical: true` (bypasses quiet hours + daily cap).
- Persists in DB ✔. Survives refresh ✔. Visible in the "alarms" list ✔.

### What's missing / why it feels broken
1. **There is no in-app alarm sound.** Delivery is a Web Push notification only. On iOS, Web Push requires the PWA to be **installed to Home Screen + notification permission granted** (Safari 16.4+). In a regular Safari tab it will never fire — that's likely what the user is seeing.
2. **No fallback for users who haven't enabled push.** If `push_subscriptions` row is missing or `notif.smart_alarm = false`, the cron silently skips. There's no client-side timer that beeps the alarm if the tab/PWA happens to be open.
3. No `Notification.requestPermission()` prompt or "Add to Home Screen" coaching in the Smart Alarm card, so users don't realize an extra step is required.

### Smallest launch-safe fix (no rewrite)
A. **Disclose the requirement in the card.** Add a one-line note + a "Test alarm" button that fires a local notification immediately so the user can verify permission + delivery in 5 seconds. If `Notification.permission !== "granted"`, show "Enable alerts" CTA that calls `Notification.requestPermission()` and on iOS adds "Install to Home Screen first."
B. **Client-side foreground alarm fallback.** When the app is open at fire time, play a short audible alarm via the existing audio pipeline (1 looped chime, max 30 s, stop button). Implementation: `setTimeout` set on alarm-list mount to the soonest upcoming `Alarm:` event within 24h; on fire, play `/sounds/alarm.mp3` through `prepareVoicePlayback()` + a new `playAlarm()` (mirrors `speakQueued`, reuses gain stage). Cleared on unmount + on delete.
C. No changes to scheduler/cron — already correct.

This gives users (a) a working alarm when the app is open (works on every browser, including Safari tab), and (b) push delivery when installed as PWA with permission. That is the realistic "launch-safe" surface; true OS-level alarms that ring with the screen off require a native wrapper (out of scope).

Risk: low. Audible playback gated behind same user-gesture unlock the Companion already uses; if no gesture happened yet (page opened in background), iOS will queue audio and play it on next focus — acceptable.

---

## Recommended fix order & credit estimate

| # | Fix | Files touched | Credits |
|---|-----|---------------|---------|
| 1 | Issue #1 — preferredName in Companion + CompanionHero | 2 | ~1 |
| 2 | Issue #2 — soft lead-in opener | 1 | ~0.5 |
| 3 | Issue #3A — permission/disclosure + Test alarm button | 1 | ~1.5 |
| 4 | Issue #3B — foreground audible alarm fallback | 2 (new `playAlarm` helper + card hook) | ~2 |

Total ≈ 5 credits. Issues #1 and #2 can ship together in one publish (≈1.5 credits) and unblock the visible launch concerns immediately; #3A+#3B can follow in a second pass.

Awaiting approval before implementation.
