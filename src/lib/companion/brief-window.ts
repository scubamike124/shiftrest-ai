// Slice 7 — Time-of-day window resolution for the Daily Brief.
// Pure functions; no side effects. Hours are local to the caller.

export type BriefPeriod = "morning" | "afternoon" | "evening";

/**
 * Window definition (local time):
 *  - morning   04:00 – 10:59
 *  - afternoon 11:00 – 16:59
 *  - evening   17:00 – 03:59 (wraps midnight)
 */
export function getBriefPeriod(hour: number): BriefPeriod {
  const h = ((hour % 24) + 24) % 24;
  if (h >= 4 && h < 11) return "morning";
  if (h >= 11 && h < 17) return "afternoon";
  return "evening";
}

export function currentBriefPeriod(now: Date = new Date()): BriefPeriod {
  return getBriefPeriod(now.getHours());
}

export const BRIEF_LAST_SEEN_PREFIX = "brief:lastSeenISO:";

export function lastSeenKey(period: BriefPeriod): string {
  return `${BRIEF_LAST_SEEN_PREFIX}${period}`;
}

/**
 * A given period's freshness "anchor":
 *  - morning   → today 04:00
 *  - afternoon → today 11:00
 *  - evening   → today 17:00
 * If `seen` is before the anchor, the briefing is considered fresh again.
 */
export function periodAnchor(period: BriefPeriod, now: Date = new Date()): Date {
  const d = new Date(now);
  if (period === "morning") d.setHours(4, 0, 0, 0);
  else if (period === "afternoon") d.setHours(11, 0, 0, 0);
  else d.setHours(17, 0, 0, 0);
  return d;
}
