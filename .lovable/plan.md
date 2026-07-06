# Plan — Sunrise/Sunset DST fix

**Status confirmed: still open.** `src/lib/sleep-engine.ts:68` still has `Math.round(lon / 15) * 60`, and all four call sites still resolve tz as `prefs.currentTz ?? prefs.homeTz ?? undefined`. Nothing was changed since the earlier investigation.

## Fix (defense in depth — both layers)

### Layer 1: sunTimes fallback (`src/lib/sleep-engine.ts`)

Replace the longitude branch (lines 62-69) so that when no tz is provided, we use the browser's IANA zone (DST-aware) instead of a static longitude offset. Longitude math stays only as a last resort for pure SSR when `Intl` can't resolve a zone.

```ts
let offsetMin: number;
if (typeof tzOrOffset === "number") {
  offsetMin = tzOrOffset;
} else if (typeof tzOrOffset === "string" && tzOrOffset.length > 0) {
  offsetMin = tzOffsetMinutes(date, tzOrOffset);
} else {
  const deviceTz = detectDeviceTz();
  offsetMin = deviceTz
    ? tzOffsetMinutes(date, deviceTz)
    : Math.round(lon / 15) * 60; // pure-SSR last resort only
}
```

### Layer 2: shared `detectDeviceTz()` helper (new)

Create `src/lib/tz.ts`:
```ts
export function detectDeviceTz(): string | null {
  try {
    if (typeof Intl === "undefined") return null;
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch { return null; }
}
```
Single source of truth; safe on server (returns `"UTC"` under Node's Intl, or `null` if unavailable — either way tzOffsetMinutes handles it).

### Layer 3: call-site fallback

Change all four sites from `... ?? undefined` to `... ?? detectDeviceTz() ?? undefined`, so a signed-in user with neither `currentTz` nor `homeTz` saved still gets their real DST-aware zone:
- `src/routes/plan.tsx:132`
- `src/lib/schedule.ts:262`
- `src/lib/recommendations.ts:66`
- `src/components/LongClock.tsx:92`

## Verification

1. Typecheck.
2. Node repro against `sunTimes(new Date(), 34.05, -118.24, undefined)` — expect sunrise ≈ 5:46 AM PDT, sunset ≈ 8:08 PM PDT (matches externally verified times). Before fix it returns 4:46 AM / 7:08 PM.
3. Publish once and ask you to reload the Smart Light Plan and confirm the displayed times.

## Files touched

- `src/lib/sleep-engine.ts` — fallback branch
- `src/lib/tz.ts` — new helper
- `src/routes/plan.tsx`, `src/lib/schedule.ts`, `src/lib/recommendations.ts`, `src/components/LongClock.tsx` — one-line tz fallback each

No math changes to the NOAA algorithm. No prefs schema changes.
