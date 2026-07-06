/**
 * Resolve the browser/runtime IANA timezone (e.g. "America/Los_Angeles").
 * DST-aware because it defers to Intl at query time.
 *
 * Returns null if Intl is unavailable or the resolver throws. Callers should
 * fall back to `undefined` / longitude math only after this returns null.
 */
export function detectDeviceTz(): string | null {
  try {
    if (typeof Intl === "undefined") return null;
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
}
