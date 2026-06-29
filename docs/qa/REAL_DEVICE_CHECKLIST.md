# AI Companion — Real-Device QA Checklist

> Goal: validate behaviors that headless Playwright cannot prove. Run this on a
> **physical iPhone (Safari)**, a **physical Android (Chrome)**, and one
> **Mac/PC desktop browser** before flipping the production-ready switch.
>
> Where to find the data: open `/companion` and triple-tap the avatar to reveal
> the **Debug HUD** in the bottom-left corner.

Build under test: see `build …` line in the HUD.

---

## 0. Setup (each device)

- [ ] Cold-load `/companion` over cellular (not localhost / not wifi cache).
- [ ] Sign in with a real account (not a fixture).
- [ ] Triple-tap avatar → HUD visible.
- [ ] Confirm HUD shows: `Authenticated: YES`, `Auth Header: Attached`, `mode: normal`.

---

## 1. Audio Unlock (iOS Safari is the hard case)

- [ ] First tap on Nova plays the greeting audibly (not silent).
- [ ] HUD `audioCtx` flips to **running** within ~500 ms of tap.
- [ ] No `NotAllowedError` or `autoplay` warning in console after the first tap.
- [ ] Lock the phone, unlock, return to tab → next reply still plays.
- [ ] Switch to another app for 30 s, return → next reply still plays.

## 2. Voice Volume Parity

- [ ] Greeting and a follow-up reply sound **the same loudness** (no pumping).
- [ ] At 30% device volume the reply is still clearly intelligible.
- [ ] No clipping / distortion at 100% device volume.

## 3. Pronunciation (speak each prompt to Nova, listen to the reply)

Verify each result is spoken naturally — no letter-by-letter, no "dot", no
"oh-clock", no stray commas mid-phrase.

- [ ] "What time should I set the alarm for **8:00 AM**?" → *eight o'clock a.m.*
- [ ] "Wake me at **8:30 PM**." → *eight thirty p.m.*
- [ ] "I slept **7.5 hours**." → *seven and a half hours*
- [ ] "Battery is at **85%**." → *eighty-five percent*
- [ ] "It's **72°F** outside." → *seventy-two degrees Fahrenheit*
- [ ] "Tomorrow's high is **21°C**." → *twenty-one degrees Celsius*
- [ ] "Meeting on **2026-06-29**." → *June twenty-ninth, twenty twenty-six*
- [ ] "Meeting on **6/29/2026**." → same as above
- [ ] "Christmas is **12/25**." → *December twenty-fifth*
- [ ] "Visit **https://example.com/docs**." → *the link example dot com*
- [ ] "Email **jane@example.com**." → *jane at example dot com*
- [ ] "**Dr. Smith** at **7:00 AM**." → *Doctor Smith … seven o'clock a.m.*
- [ ] "At **12:00 PM** and **12:00 AM**." → *noon and midnight*
- [ ] "Rock **and** roll all night." → no inserted comma after *and*.
- [ ] "**500 mg** with **8 oz** of water." → *five hundred milligrams … eight ounces*.

## 4. Lip-Sync & Facial Realism

- [ ] Mouth opens with speech, closes between phrases (no black-dot mustache).
- [ ] HUD `viseme` cycles through ≥3 distinct keys during a sentence (not stuck on REST).
- [ ] Eyes blink at irregular intervals; both eyelids close together.
- [ ] Subtle head sway visible during idle (≥10 s observation).
- [ ] HUD `emotion` updates when reply tone changes (e.g. *neutral → encouraging*).
- [ ] Switch Sleep Mode in **Settings → Companion** → HUD `mode: sleep`,
      replies sound hushed, breathing slows.

## 5. Microphone Persistence

- [ ] First mic prompt grants permission; HUD `micPerm: granted`.
- [ ] After 3 consecutive turns HUD `micTrack` remains `ready`/`recording`
      (no re-prompt, no `acquiring` loop).
- [ ] Background the app for 60 s, return → mic still works without re-prompt.

## 6. Performance Soak (20–30 minutes continuous conversation)

- [ ] HUD `fps` stays **≥ 50** on iPhone, **≥ 55** on Android/desktop.
- [ ] HUD `heap` (Chrome only) grows < **30 MB** over 20 min — no obvious leak.
- [ ] No audible glitches, dropouts, or stuck visemes after 50+ replies.
- [ ] Device does not become noticeably warm.

## 7. Network Resilience

- [ ] Toggle airplane mode for 5 s mid-reply → graceful error, no white screen.
- [ ] Tap again after reconnect → next reply works without reload.

## 8. SSR / Hydration

- [ ] **Hard reload** `/companion`. Open devtools console **before** load.
- [ ] No `Hydration failed` / `did not match` warning for the time greeting.
- [ ] Greeting text matches current local time within one frame.

---

## Reporting

For each ❌ failure, capture:

1. Device + OS + browser version.
2. HUD screenshot (`Authenticated`, `audioCtx`, `micTrack`, `viseme`,
   `emotion`, `fps`, `heap`, `mode`, `build`).
3. The exact prompt spoken / typed.
4. Console snippet if any.

Do **not** mark the AI Companion production-ready until every box above is
checked on at least one iPhone Safari, one Android Chrome, and one desktop
browser.
