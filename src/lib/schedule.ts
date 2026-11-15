// Multi-week rotation + multi-day planning helpers — Upgrade 2.
//
// All helpers are pure. When the user keeps `cycleWeeks === 1` (the default
// for every existing account), `shiftsForDate` collapses to the legacy
// "find by weekday" behavior so dashboards, playbooks, swap, and brief code
// keep working unchanged.

import { type Shift } from "./shifts";
import type { Prefs } from "./prefs";
import { sunTimes, sunriseAfter } from "./sleep-engine";
import { ANCHOR_WHY, anchorInstants, localCivilDate, rotationWeekIndex, civilDay } from "./schedule-core";
import { detectDeviceTz } from "./tz";

/** Mon=0 … Sun=6 for a JS Date in the browser timezone. */
export function weekdayOf(date: Date): number {
  return (date.getDay() + 6) % 7;
}

function startOfDay(d: Date): Date {
  const out = new Date(d);
  out.setHours(0, 0, 0, 0);
  return out;
}

/** Which week of the rotation does `date` belong to? 0..cycleWeeks-1. */
export function weekIndexFor(
  date: Date,
  anchor: string | null | undefined,
  cycleWeeks: number,
): number {
  // One rotation rule for every caller: the shared module's, on the
  // calendar date (DST cannot shift a week boundary).
  const c = localCivilDate(date);
  return rotationWeekIndex(civilDay(c.y, c.m, c.d), anchor, cycleWeeks);
}

/**
 * Shifts whose day-of-week + week_index match `date` in the rotation.
 *
 * Backward compatibility note: when a user has `cycleWeeks === 1`, every
 * stored shift is week 0, so this reduces to the legacy
 * `shifts.filter(s => s.day === weekday)`.
 */
export function shiftsForDate(
  shifts: Shift[],
  date: Date,
  anchor: string | null | undefined,
  cycleWeeks: number,
): Shift[] {
  const wd = weekdayOf(date);
  const wi = weekIndexFor(date, anchor, cycleWeeks);
  return shifts.filter((s) => s.day === wd && (s.weekIndex ?? 0) === wi);
}

/** Convenience: first shift on the given date, or undefined. */
export function shiftForDate(
  shifts: Shift[],
  date: Date,
  anchor: string | null | undefined,
  cycleWeeks: number,
): Shift | undefined {
  return shiftsForDate(shifts, date, anchor, cycleWeeks)[0];
}

// ─────────────────────────────────────────────────────────────────────────
// Long Clock — absolute-time events for a single shift on a given date.
// ─────────────────────────────────────────────────────────────────────────

export type LongClockKind =
  | "wake"
  | "bright-light"
  | "meal"
  | "caffeine-on"
  | "shift-start"
  | "caffeine-cutoff"
  | "shift-end"
  | "wind-down"
  | "blackout"
  | "amber-light"
  | "nap"
  | "recovery";

export type LongClockEvent = {
  at: Date;
  /** Minutes from midnight (local). Convenient for legacy widgets. */
  minute: number;
  kind: LongClockKind;
  title: string;
  detail: string;
  /** Plain-language reason for this time ("why this time"). */
  why?: string;
};

/** `date`'s local midnight plus `minutes`, by wall clock (DST-aware). */
function atOn(date: Date, minutes: number): Date {
  const out = startOfDay(date);
  out.setMinutes(minutes);
  return out;
}

function fmtTime(d: Date): string {
  const h = d.getHours();
  const m = d.getMinutes();
  const period = h >= 12 ? "PM" : "AM";
  const h12 = ((h + 11) % 12) + 1;
  return `${h12}:${m.toString().padStart(2, "0")} ${period}`;
}

/**
 * Long Clock: every meaningful moment in the 24h around a shift.
 * Returns events sorted by absolute time, suitable for a multi-day plan.
 */
export function buildLongClock(
  shift: Shift,
  date: Date,
  prefs: Prefs,
  sun?: { sunrise: number | null; sunset: number | null },
): LongClockEvent[] {
  // Shared anchors: the same numbers the Plan screen, recommendations and
  // reminders use. Clock-in/out are wall-clock times; sleep length, caffeine
  // clearance and recovery are elapsed time, so a DST night stays correct.
  const a = anchorInstants(shift, prefs, localCivilDate(date), detectDeviceTz() ?? "UTC");
  const sleepStartAt = a.sleepStart;
  const sleepEndAt = a.sleepEnd;
  const cutoffAt = a.caffeineCutoff;

  const events: LongClockEvent[] = [];
  const pushAt = (at: Date, kind: LongClockKind, title: string, detail: string, why?: string) => {
    events.push({ at, minute: at.getHours() * 60 + at.getMinutes(), kind, title, detail, why });
  };
  const push = (minute: number, kind: LongClockKind, title: string, detail: string, why?: string) =>
    pushAt(atOn(date, minute), kind, title, detail, why);

  pushAt(
    a.wake,
    "wake",
    "Wake + bright light",
    "10–20 min outside or under a 10,000 lux lamp within 15 min of waking.",
    `${ANCHOR_WHY.wake} ${ANCHOR_WHY.brightLight}`,
  );
  pushAt(
    a.meal,
    "meal",
    "Light pre-shift meal",
    "Protein + complex carbs. Skip heavy/greasy food — it sabotages alertness.",
    ANCHOR_WHY.meal,
  );
  pushAt(
    a.caffeineOn,
    "caffeine-on",
    "Caffeine on",
    "100–200 mg about 30 min before clock-in. Top up midway if the shift is long.",
    ANCHOR_WHY.caffeineOn,
  );
  pushAt(
    a.shiftStart,
    "shift-start",
    "Shift starts",
    `Clocked in at ${fmtTime(a.shiftStart)}.`,
  );
  pushAt(
    cutoffAt,
    "caffeine-cutoff",
    "Caffeine cutoff",
    `Last coffee by ${fmtTime(cutoffAt)} so it clears before sleep.`,
    ANCHOR_WHY.caffeineCutoff,
  );
  pushAt(
    a.shiftEnd,
    "shift-end",
    "Shift ends",
    `Clock out at ${fmtTime(a.shiftEnd)}.`,
  );
  pushAt(
    a.windDownStart,
    "wind-down",
    `Wind-down begins (${prefs.windDownMin} min)`,
    "Dim lights, screens off, warm shower, slow stretch.",
    ANCHOR_WHY.windDown,
  );

  if (a.isNight && sun?.sunrise != null) {
    // The first sunrise after clock-in: the next morning for a 22:00–23:59
    // start, the same morning for a 00:00–03:59 start.
    push(
      sunriseAfter(sun.sunrise, shift.start),
      "amber-light",
      "Amber glasses on",
      "Sunrise — switch to amber/blue-blocking glasses on the commute home.",
      ANCHOR_WHY.amberGlasses,
    );
  }

  pushAt(
    sleepStartAt,
    "blackout",
    "Blackout — sleep window",
    `Cave-dark room, 65–68°F (18–20°C). Sleep until ${fmtTime(sleepEndAt)}.`,
    ANCHOR_WHY.sleep,
  );
  pushAt(
    sleepEndAt,
    "recovery",
    "Recovery window",
    "Hydrate, light movement, protein. Restore circadian anchor before the next shift.",
    ANCHOR_WHY.recovery,
  );

  return events.sort((a, b) => a.at.getTime() - b.at.getTime());
}

// ─────────────────────────────────────────────────────────────────────────
// Multi-day plan — used by the new "Next 7 days" UI strip.
// ─────────────────────────────────────────────────────────────────────────

export type DayPlan = {
  date: Date;
  weekday: number;
  weekIndex: number;
  shifts: Shift[];
  /** Primary shift (first of the day) — convenience for cards. */
  shift?: Shift;
  /** Sleep window for the primary shift, mapped to absolute Dates. */
  sleep?: { start: Date; end: Date };
  /** Wind-down window start time (Date) for the primary shift. */
  windDownAt?: Date;
  /** Caffeine on / caffeine cutoff anchors for the primary shift. */
  caffeineOnAt?: Date;
  caffeineCutoffAt?: Date;
  /** Off day if no shifts scheduled. */
  isOff: boolean;
  /** Long-clock events for the primary shift. Empty on rest days. */
  longClock: LongClockEvent[];
};

export function buildMultiDayPlan(
  shifts: Shift[],
  prefs: Prefs,
  now: Date,
  days = 7,
  location?: { lat: number | null; lon: number | null },
): DayPlan[] {
  const start = startOfDay(now);
  const out: DayPlan[] = [];
  for (let i = 0; i < days; i++) {
    const date = new Date(start);
    date.setDate(start.getDate() + i);
    const dayShifts = shiftsForDate(shifts, date, prefs.cycleAnchor, prefs.cycleWeeks);
    const primary = dayShifts[0];
    // Device zone: the clock every anchor is computed in (see schedule-core).
    const planTz = detectDeviceTz() ?? undefined;
    const sun = location
      ? sunTimes(date, location.lat ?? null, location.lon ?? null, planTz)
      : { sunrise: null, sunset: null };
    let longClock: LongClockEvent[] = [];
    let sleep: { start: Date; end: Date } | undefined;
    let windDownAt: Date | undefined;
    let caffeineOnAt: Date | undefined;
    let caffeineCutoffAt: Date | undefined;
    if (primary) {
      longClock = buildLongClock(primary, date, prefs, sun);
      const at = (kind: LongClockKind) => longClock.find((e) => e.kind === kind)?.at;
      windDownAt = at("wind-down");
      const sleepStart = at("blackout");
      const sleepEnd = at("recovery");
      if (sleepStart && sleepEnd) sleep = { start: sleepStart, end: sleepEnd };
      caffeineOnAt = at("caffeine-on");
      caffeineCutoffAt = at("caffeine-cutoff");
    }
    out.push({
      date,
      weekday: weekdayOf(date),
      weekIndex: weekIndexFor(date, prefs.cycleAnchor, prefs.cycleWeeks),
      shifts: dayShifts,
      shift: primary,
      sleep,
      windDownAt,
      caffeineOnAt,
      caffeineCutoffAt,
      isOff: dayShifts.length === 0,
      longClock,
    });
  }
  return out;
}

/** Week labels: A, B, C, D, E, F. */
export function weekLabel(weekIndex: number): string {
  return String.fromCharCode("A".charCodeAt(0) + (weekIndex % 6));
}
