/**
 * Canonical time-of-day helper. Every greeting surface in RestPilot
 * (Home, Companion, spoken briefs, notifications, hero) MUST derive its
 * label from this helper so they never drift.
 */

export type DayPart = "morning" | "afternoon" | "evening" | "night";

export const DAY_PART_LABEL: Record<DayPart, string> = {
  morning: "Good morning",
  afternoon: "Good afternoon",
  evening: "Good evening",
  night: "Winding down",
};

/**
 * Bucket a Date into a canonical day part.
 * 05:00–11:59 → morning
 * 12:00–16:59 → afternoon
 * 17:00–21:59 → evening
 * 22:00–04:59 → night
 */
export function getDayPart(date: Date = new Date(), tz?: string): DayPart {
  const hour = tz ? getHourInTz(date, tz) : date.getHours();
  if (hour >= 5 && hour < 12) return "morning";
  if (hour >= 12 && hour < 17) return "afternoon";
  if (hour >= 17 && hour < 22) return "evening";
  return "night";
}

export function greetingLabel(date: Date = new Date(), tz?: string): string {
  return DAY_PART_LABEL[getDayPart(date, tz)];
}

/**
 * Build a "Good morning, Mike" style salutation. If name is blank/unset,
 * returns just the label so we never say "Good morning, ."
 */
export function greetingWithName(
  name: string | null | undefined,
  date: Date = new Date(),
  tz?: string,
): string {
  const label = greetingLabel(date, tz);
  const clean = (name ?? "").trim();
  return clean ? `${label}, ${clean}` : label;
}

function getHourInTz(date: Date, tz: string): number {
  try {
    const fmt = new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      hour12: false,
      timeZone: tz,
    });
    const h = Number.parseInt(fmt.format(date), 10);
    return Number.isFinite(h) ? h : date.getHours();
  } catch {
    return date.getHours();
  }
}
