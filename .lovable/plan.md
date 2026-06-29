# Companion Blink & Idle Animation Fix

## Root cause (Avatar.tsx)

The "crossed eyes during blink" is **entirely a rig bug**, not the portrait.

1. **Eyelids are skin‑colored solid pills painted over the photo's eyes**
   (`eyelidColor = rgb(212,168,140)`, `borderRadius:40%`, `blur(0.4px)`) — sized
   from a single percentage map `F.eyeLeft / F.eyeRight` that was tuned for
   Aura. On Nova the painted iris sits a few pixels off from `F.eye*`, so when
   the lid expands it lands slightly off‑center over the iris → reads as
   "crossed."
2. **`transformOrigin: 50% 100%` + `scaleY(lidOpenRatio)`**: at rest the lid is
   a 4 %‑tall sliver at the **bottom** of the eye box, and on blink it
   *balloons upward from the bottom* instead of closing downward like a real
   eyelid. Combined with (1), the lid sweeps **across** the iris instead of
   covering it from above.
3. **Lids `translate(glanceX, glanceY)`** during saccades, but the painted
   iris does not. Mid‑saccade the slit slides off the eye, exposing or
   re‑covering one iris asymmetrically → "one eye drifts."
4. **`halfBlinkRight` (12 % chance)**: deliberately blinks ONLY the right
   eye for 110 ms — the literal "one eye crossed" symptom. The independent
   `setBlink` / `setHalfBlinkRight` React states also de‑sync the two lids by
   a render tick when both are true.
5. **Per‑eye `lidOpenRatio` vs `lidOpenRatioRight` baselines** can differ by
   one frame during emotion changes → uneven idle look.

## Implementation

All changes in `src/components/companion/Avatar.tsx`. No portrait edits, no
nav/payment changes.

### 1. Rebuild the blink rig

- Delete `halfBlinkRight`, `setHalfBlinkRight`, and the asymmetric branch in
  the blink loop.
- Replace `blink` React state with a single `blinkProgressRef` (0 = open,
  1 = closed) advanced inside the existing rAF `tick()` so **both lids read
  the same value in the same frame** — no React state, no per‑eye drift.
- Blink controller: rAF spring with phases `close (90 ms ease‑in) → hold
  (40 ms) → open (130 ms ease‑out)`, scheduled by the existing interval
  loop. Double‑blink stays (always synchronized). Sleep mode = slower.
- Both eyelid `<div>`s read **the same** `lidOpenRatio` written via
  `style.setProperty('--lid', value)` on a shared parent — guarantees
  symmetry.

### 2. Make the lid actually look like an eyelid

- Change `transformOrigin` to `50% 0%` and invert the formula so the lid
  **closes downward from the upper lash line** (matches real anatomy and
  matches the painted brow/lash above the iris).
- Replace the flat skin pill with a soft top‑down gradient
  (`linear-gradient(to bottom, var(--eyelid-top) 0%, var(--eyelid-mid) 70%,
  transparent 100%)`) so the closing edge is a thin shadow line rather than
  a tan blob — invisible at rest, organic when closing.
- Per‑avatar tuning map (`Aura/Nova/Atlas/Sage`) for `eyeLeft/eyeRight/eyeW/
  eyeH` and `--eyelid-top/--eyelid-mid`. Read avatar id from `useAvatar()`.
  Nova gets the values its painted irises actually sit at, so the lid lands
  exactly on them.
- **Lids never translate with `glanceX/glanceY`.** Gaze is a portrait effect
  only; the lid stays locked to the eye socket so it can never slide off.

### 3. Idle realism polish (already partly present — fill the gaps)

Already in place: gaze saccades, weight shift, posture tilt, swallow,
shoulder breathing, head bob. Add/tune:

- **Micro‑smile variation** — every 9–22 s, briefly bias `mouthGroupRef`
  `cornerLift` by `+0.4` for ~900 ms, then ease back. Anti‑repeats with the
  existing `rememberAction` helper.
- **Natural blink cadence** — tighten idle blink interval to 3.5–6.5 s
  (was 2.5–9 s on some presets) and bias double‑blinks toward post‑smile.
- **Breathing already on `shoulderRef`** — verify amplitude stays ≤ 1.3 %
  scale so the face doesn't pump.
- All idle motion still gated on `prefersReducedMotion` and
  `visibilitychange` (already wired).

### 4. Verify

- Manual test: open `/companion` on iPhone Safari, watch ≥ 10 blink cycles
  on Aura, Nova, Atlas, Sage. Lids close together, land exactly on each
  iris, no drift, no cross‑eyed frame.
- Spot‑check listening / thinking / speaking states — saccades and head bob
  do not affect lid position.
- Reduced‑motion: lids stay fully open, no blink.

## Files
- `src/components/companion/Avatar.tsx` — eyelid rig rewrite, idle polish.
- (Optional) `src/lib/companion/avatars.ts` — add optional `eyeRig` per
  preset (offsets + lid colors); falls back to defaults so custom avatars
  keep working.
- `BUILD_STAMP` bump.

## Out of scope
Portrait assets, navigation, payments, voice/audio pipeline.
