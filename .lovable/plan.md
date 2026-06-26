## 1. Root cause

### Issue 1 — Location

Three problems compound:

**A. No manual entry.** `profile.tsx` only exposes a "Detect" button (`detectLocation`, lines 135–152) calling `navigator.geolocation.getCurrentPosition`. If the browser denies, returns a coarse/IP-based result, or the user is on a desktop far from where they actually live (VPN, work laptop), there is no way to correct it. The error handler just toasts and bails — the previous (possibly wrong) location stays.

**B. Label is just raw coordinates.** On success we save `locationLabel: "40.71, -74.01"`, not a city. Users read that and think "this is wrong" because it doesn't look like a place. There is no reverse geocoding.

**C. Default-NYC silently wins.** `DEFAULT_PREFS` in `src/lib/prefs.ts` hardcodes `lat 40.7128 / lon -74.006 / "New York, NY"`. Any new user — and any logged-out user — gets NYC sunrise/sunset in the Plan screen until they hit Detect. `plan.tsx` and `sleep-engine.ts` consume `prefs.lat/lon` directly with no "location not set" state, so the wrong sun times look authoritative.

There is no caching bug in Supabase persistence itself — `savePrefs` upserts correctly and `fetchPrefs` reads the row. The bug is UX: the user can't fix a wrong value, the label lies, and the default masquerades as real.

### Issue 2 — Paywall copy

`src/routes/paywall.tsx` (the legal blurb under the CTA, ~lines 158–166) names "Apple ID", "Settings → Apple ID → Subscriptions", and free-trial-forfeiture language lifted from Apple's required iOS disclosure. On a web-only launch with no App Store billing wired up, this is inaccurate and could be misread as a deceptive practice.

## 2. Files needing changes

- `src/lib/prefs.ts` — neutralize the default label so we can detect "not set".
- `src/routes/profile.tsx` — add manual city entry + clear permission-denied fallback; reverse-geocode on Detect so the label is a real place name.
- `src/routes/plan.tsx` — show a "Set your location" prompt when location is unset, instead of silently using NYC.
- `src/routes/paywall.tsx` — replace Apple/App Store disclosure with web-safe copy.

No changes to `sleep-engine.ts` (math is correct), no schema changes.

## 3. Exact fix plan

### Location

1. **Default = unset, not NYC.** Change `DEFAULT_PREFS.locationLabel` to `""` and add a derived `hasLocation = !!prefs.locationLabel` check. Keep lat/lon defaults so existing sun math doesn't divide-by-undefined, but treat empty label as "user hasn't picked one."
2. **Manual entry in Profile.** Add a text input ("City, region") next to Detect. On blur, geocode via the free Open-Meteo geocoding endpoint (`https://geocoding-api.open-meteo.com/v1/search?name=...`) — no API key, CORS-enabled — and save `{lat, lon, locationLabel: "City, Country"}`. If geocoding returns nothing, toast "City not found — try a nearby larger city."
3. **Detect with reverse geocoding.** After `getCurrentPosition` succeeds, call Open-Meteo reverse geocoding (`/v1/reverse?latitude=..&longitude=..`) to turn coords into "Brooklyn, NY" instead of "40.71, -74.01". If reverse-geocode fails, fall back to the coord string but still save lat/lon.
4. **Clear denial fallback.** On `getCurrentPosition` error, focus the manual input and toast "Couldn't detect — enter your city below."
5. **Plan screen guard.** In `plan.tsx`, if `!prefs.locationLabel`, render a small card: "Set your location to get accurate sunrise/sunset timing" with a link to `/profile`. Don't blank the plan, just badge it as "using default New York timing."

### Paywall copy

Replace the Apple disclosure block in `paywall.tsx` with:

> Subscriptions renew automatically at the listed price unless canceled before the renewal date. You can manage or cancel your plan anytime from your account settings. Lifetime is a one-time purchase and does not renew.

Keep Terms / Privacy / Restore links. No other paywall changes.

## 4. Migration needed

None. Schema for `user_prefs` already stores `location_label` as text; we're only changing client behavior and defaults. Existing rows with `"New York, NY"` saved as a real value remain valid (the user explicitly accepted it).

## 5. Test checklist

**Location**
- Fresh logged-in account: Profile shows "Location not set" and Plan shows the "Set your location" hint.
- Type "Austin, TX" into manual field → blur → label becomes "Austin, United States" (or similar), lat/lon updates, sun times in Plan shift accordingly, value persists across reload.
- Type gibberish "asdfgh" → toast "City not found", prior location unchanged.
- Click Detect, allow → label becomes a real city name (not raw coords), persists.
- Click Detect, deny → toast points to manual input, prior location unchanged.
- Sign out, sign back in on a different device → same location loads from Supabase.
- Plan screen sunrise/sunset visibly matches the chosen city (NY vs LA gives ~3h difference).

**Paywall**
- No occurrences of "Apple ID", "App Store", "iOS", "Settings → Apple ID" anywhere on `/paywall`.
- Renewal/cancel sentence visible under the CTA.
- Terms, Privacy, Restore purchases links still work.
- Lifetime tier still reads "one-time."

Awaiting approval before coding.