/**
 * Time-zone helpers — single source of truth for IANA → offset math,
 * body-clock comparison, and DST transition detection.
 *
 * Design notes
 * ────────────
 * - All conversions go through `Intl.DateTimeFormat`. No tables, no deps.
 * - "Offset minutes" everywhere means "minutes EAST of UTC" (positive for
 *   Asia, negative for the Americas). Matches the convention used in
 *   `src/lib/notifications/schedule.ts`. The opposite of
 *   `Date.prototype.getTimezoneOffset()` (which returns the negation).
 * - "Minute of day" is 0..1439, measured from local midnight in the
 *   relevant tz. Anything that needs a true instant uses a `Date` / UTC ms.
 *
 * Edge cases handled
 * ──────────────────
 * - Unknown / typo'd tz → falls back to UTC (offset 0) so the app keeps
 *   rendering instead of throwing.
 * - Half-hour and 45-minute zones (IST = +330, NPT = +345, ACWST = +525) —
 *   `Intl` returns the correct offset.
 * - Negative-offset zones (e.g. -08:00 PST) — sign preserved.
 * - DST transitions — `tzOffsetMinutes` is called *at the instant in
 *   question*, so a sleep block that straddles a DST jump uses the
 *   correct offset on each side.
 * - Antimeridian zones (Pacific/Kiritimati at +14, Pacific/Niue at -11) —
 *   handled by `Intl`, no manual modulo.
 *
 * Do NOT use `(lon / 15) * 60` anywhere downstream — it is wrong at every
 * political boundary and breaks during DST. Use `tzOffsetMinutes(date, tz)`.
 */

/** Common shorthand alias → IANA, so callers can pass either. */
const TZ_ALIAS: Record<string, string> = {
  UTC: "UTC",
  GMT: "Etc/GMT",
  EST: "America/New_York",
  EDT: "America/New_York",
  CST: "America/Chicago",
  CDT: "America/Chicago",
  MST: "America/Denver",
  MDT: "America/Denver",
  PST: "America/Los_Angeles",
  PDT: "America/Los_Angeles",
  BST: "Europe/London",
};

/** Best-effort cleanup of a user-supplied tz string. */
export function normalizeTz(tz: string | null | undefined): string {
  if (!tz) return "UTC";
  const trimmed = tz.trim();
  if (!trimmed) return "UTC";
  return TZ_ALIAS[trimmed.toUpperCase()] ?? trimmed;
}

/** True if Intl will accept this tz without throwing. */
export function isValidTz(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Browser/runtime tz, or UTC if unavailable. Safe on SSR. */
export function detectDeviceTz(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

/**
 * Minutes EAST of UTC for the given tz at the given instant.
 * Returns 0 for invalid input — never throws.
 */
export function tzOffsetMinutes(date: Date, tz: string): number {
  const zone = normalizeTz(tz);
  try {
    const dtf = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    const parts = dtf.formatToParts(date);
    const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
    // `Intl` returns 24:xx:xx for "midnight" in some locales — normalize.
    const hour = get("hour") === 24 ? 0 : get("hour");
    const asUtc = Date.UTC(
      get("year"),
      get("month") - 1,
      get("day"),
      hour,
      get("minute"),
      get("second"),
    );
    return Math.round((asUtc - date.getTime()) / 60_000);
  } catch {
    return 0;
  }
}

/**
 * Convert a local wall-clock (Y-M-D + minute-of-day in `tz`) to a true UTC
 * instant. Mirrors `utcFromLocal` in notifications/schedule.ts.
 */
export function utcFromLocal(
  y: number,
  m: number,
  d: number,
  minuteOfDay: number,
  tz: string,
): Date {
  const naiveUtcMs = Date.UTC(
    y,
    m - 1,
    d,
    Math.floor(minuteOfDay / 60),
    minuteOfDay % 60,
  );
  const offsetMin = tzOffsetMinutes(new Date(naiveUtcMs), tz);
  return new Date(naiveUtcMs - offsetMin * 60_000);
}

/** Y/M/D + minute-of-day in `tz` for a given UTC instant. */
export function localPartsInTz(
  date: Date,
  tz: string,
): { year: number; month: number; day: number; minuteOfDay: number; weekday: number } {
  const zone = normalizeTz(tz);
  try {
    const dtf = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      weekday: "short",
    });
    const parts = dtf.formatToParts(date);
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
    const hour = Number(get("hour")) === 24 ? 0 : Number(get("hour"));
    const minute = Number(get("minute"));
    const wkMap: Record<string, number> = {
      Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
    };
    return {
      year: Number(get("year")),
      month: Number(get("month")),
      day: Number(get("day")),
      minuteOfDay: hour * 60 + minute,
      weekday: wkMap[get("weekday")] ?? 0,
    };
  } catch {
    // UTC fallback
    return {
      year: date.getUTCFullYear(),
      month: date.getUTCMonth() + 1,
      day: date.getUTCDate(),
      minuteOfDay: date.getUTCHours() * 60 + date.getUTCMinutes(),
      weekday: date.getUTCDay(),
    };
  }
}

/**
 * Body-clock offset = how many minutes the local clock is AHEAD of the
 * user's home clock at this instant. Positive when traveling east.
 *
 *   bodyClockOffsetMinutes("Asia/Tokyo", "America/New_York") ≈ +780 (+13h)
 *   bodyClockOffsetMinutes("America/Los_Angeles", "America/New_York") ≈ -180
 *   bodyClockOffsetMinutes("UTC", "UTC") === 0
 */
export function bodyClockOffsetMinutes(
  currentTz: string,
  homeTz: string,
  atUtc: Date = new Date(),
): number {
  return tzOffsetMinutes(atUtc, currentTz) - tzOffsetMinutes(atUtc, homeTz);
}

/**
 * Given a wall-clock minute-of-day in `currentTz`, return the minute-of-day
 * the user's body still thinks it is (in `homeTz`). Useful when phrasing
 * "your body thinks it's 3 AM" advice.
 */
export function bodyClockMinuteOfDay(
  localMinuteOfDay: number,
  currentTz: string,
  homeTz: string,
  atUtc: Date = new Date(),
): number {
  const delta = bodyClockOffsetMinutes(currentTz, homeTz, atUtc);
  // Body clock is BEHIND when traveling east → subtract the eastward delta.
  return ((localMinuteOfDay - delta) % 1440 + 1440) % 1440;
}

/** Scan the next `days` for a DST transition in `tz`. Returns the local-date
 * strings on which the offset changes. Cheap: 1 Intl call per day. */
export function dstChangesWithin(
  tz: string,
  fromUtc: Date,
  days: number,
): Array<{ atUtc: string; fromOffset: number; toOffset: number }> {
  const zone = normalizeTz(tz);
  const out: Array<{ atUtc: string; fromOffset: number; toOffset: number }> = [];
  let prevOffset = tzOffsetMinutes(fromUtc, zone);
  for (let i = 1; i <= days; i++) {
    const at = new Date(fromUtc.getTime() + i * 86_400_000);
    const off = tzOffsetMinutes(at, zone);
    if (off !== prevOffset) {
      out.push({ atUtc: at.toISOString(), fromOffset: prevOffset, toOffset: off });
      prevOffset = off;
    }
  }
  return out;
}

/** Short "GMT+5", "GMT-08:00", "UTC" label for a tz at a moment. */
export function formatOffsetLabel(tz: string, atUtc: Date = new Date()): string {
  const m = tzOffsetMinutes(atUtc, tz);
  if (m === 0) return "UTC";
  const sign = m > 0 ? "+" : "−";
  const abs = Math.abs(m);
  const h = Math.floor(abs / 60);
  const min = abs % 60;
  return min === 0 ? `GMT${sign}${h}` : `GMT${sign}${h}:${String(min).padStart(2, "0")}`;
}

/**
 * Compact, prompt-ready description that the AI orchestrator can drop into
 * its system block so every recommendation can disclose its tz basis. The
 * `COACH_VOICE` contract requires this when home and current diverge.
 */
export function describeTzBasis(
  currentTz: string,
  homeTz: string,
  atUtc: Date = new Date(),
): {
  isTraveling: boolean;
  offsetMin: number;
  offsetHours: number;
  label: string;
} {
  const offsetMin = bodyClockOffsetMinutes(currentTz, homeTz, atUtc);
  const isTraveling = offsetMin !== 0 || normalizeTz(currentTz) !== normalizeTz(homeTz);
  const hours = offsetMin / 60;
  const direction = offsetMin > 0 ? "ahead of" : offsetMin < 0 ? "behind" : "same as";
  const abs = Math.abs(hours);
  const pretty = Number.isInteger(abs) ? `${abs}h` : `${abs.toFixed(1)}h`;
  const label = isTraveling
    ? `Local clock ${normalizeTz(currentTz)} is ${pretty} ${direction} body clock ${normalizeTz(homeTz)}.`
    : `Local clock and body clock both ${normalizeTz(currentTz)}.`;
  return { isTraveling, offsetMin, offsetHours: hours, label };
}
