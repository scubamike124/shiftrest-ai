// Multi-week rotation + multi-day planning helpers — Upgrade 2.
//
// All helpers are pure. When the user keeps `cycleWeeks === 1` (the default
// for every existing account), `shiftsForDate` collapses to the legacy
// "find by weekday" behavior so dashboards, playbooks, swap, and brief code
// keep working unchanged.

import { type Shift, endAbsolute } from "./shifts";
import type { Prefs } from "./prefs";
import { sunTimes } from "./sleep-engine";

const MS_PER_DAY = 86_400_000;

/** Mon=0 … Sun=6 for a JS Date in the browser timezone. */
export function weekdayOf(date: Date): number {
  return (date.getDay() + 6) % 7;
}

function startOfDay(d: Date): Date {
  const out = new Date(d);
  out.setHours(0, 0, 0, 0);
  return out;
}

/** Date for the Monday of the week that contains `date`. */
function mondayOf(date: Date): Date {
  const d = startOfDay(date);
  d.setDate(d.getDate() - weekdayOf(d));
  return d;
}

/** Parse a YYYY-MM-DD anchor into a local Date (Monday). Falls back to this week's Monday. */
function resolveAnchorMonday(anchor: string | null | undefined, now: Date): Date {
  if (anchor) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(anchor);
    if (m) {
      const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
      if (!Number.isNaN(d.getTime())) return mondayOf(d);
    }
  }
  return mondayOf(now);
}

/** Which week of the rotation does `date` belong to? 0..cycleWeeks-1. */
export function weekIndexFor(
  date: Date,
  anchor: string | null | undefined,
  cycleWeeks: number,
): number {
  const cw = Math.max(1, Math.min(6, Math.round(cycleWeeks || 1)));
  if (cw === 1) return 0;
  const anchorMon = resolveAnchorMonday(anchor, date);
  const targetMon = mondayOf(date);
  const weeks = Math.round((targetMon.getTime() - anchorMon.getTime()) / (7 * MS_PER_DAY));
  return ((weeks % cw) + cw) % cw;
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
};

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
  const isNight = shift.start >= 22 * 60 || shift.start < 4 * 60;
  const shiftEndMin = endAbsolute(shift);
  const wakeMin = shift.start - 90;
  const mealMin = shift.start - 75;
  const caffeineOnMin = shift.start - 30;
  const windDownMin = shiftEndMin;
  const sleepStartMin = shiftEndMin + prefs.windDownMin;
  const sleepEndMin = sleepStartMin + prefs.sleepHours * 60;
  const caffeineCutoffMin = sleepStartMin - 6 * 60;
  const recoveryStartMin = sleepEndMin;
  const recoveryEndMin = recoveryStartMin + 90;

  const events: LongClockEvent[] = [];
  const push = (minute: number, kind: LongClockKind, title: string, detail: string) => {
    const at = atOn(date, minute);
    events.push({ at, minute: ((minute % 1440) + 1440) % 1440, kind, title, detail });
  };

  push(
    wakeMin,
    "wake",
    "Wake + bright light",
    "10–20 min outside or under a 10,000 lux lamp within 15 min of waking.",
  );
  push(
    mealMin,
    "meal",
    "Light pre-shift meal",
    "Protein + complex carbs. Skip heavy/greasy food — it sabotages alertness.",
  );
  push(
    caffeineOnMin,
    "caffeine-on",
    "Caffeine on",
    "100–200 mg about 30 min before clock-in. Top up midway if the shift is long.",
  );
  push(
    shift.start,
    "shift-start",
    "Shift starts",
    `Clocked in at ${fmtTime(atOn(date, shift.start))}.`,
  );
  push(
    caffeineCutoffMin,
    "caffeine-cutoff",
    "Caffeine cutoff",
    `Last coffee by ${fmtTime(atOn(date, caffeineCutoffMin))} so it clears before sleep.`,
  );
  push(
    shiftEndMin,
    "shift-end",
    "Shift ends",
    `Clock out at ${fmtTime(atOn(date, shiftEndMin))}.`,
  );
  push(
    windDownMin,
    "wind-down",
    `Wind-down begins (${prefs.windDownMin} min)`,
    "Dim lights, screens off, warm shower, slow stretch.",
  );

  if (isNight && sun?.sunrise != null) {
    // Sunrise after a night shift lands on the same date (commute home).
    push(
      sun.sunrise,
      "amber-light",
      "Amber glasses on",
      "Sunrise — switch to amber/blue-blocking glasses on the commute home.",
    );
  }

  push(
    sleepStartMin,
    "blackout",
    "Blackout — sleep window",
    `Cave-dark room, 65–68°F (18–20°C). Sleep until ${fmtTime(atOn(date, sleepEndMin))}.`,
  );
  push(
    recoveryStartMin,
    "recovery",
    "Recovery window",
    "Hydrate, light movement, protein. Restore circadian anchor before the next shift.",
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
    const sun = location
      ? sunTimes(date, location.lat ?? null, location.lon ?? null)
      : { sunrise: null, sunset: null };
    let longClock: LongClockEvent[] = [];
    let sleep: { start: Date; end: Date } | undefined;
    let windDownAt: Date | undefined;
    let caffeineOnAt: Date | undefined;
    let caffeineCutoffAt: Date | undefined;
    if (primary) {
      longClock = buildLongClock(primary, date, prefs, sun);
      const endMin = endAbsolute(primary);
      windDownAt = atOn(date, endMin);
      sleep = {
        start: atOn(date, endMin + prefs.windDownMin),
        end: atOn(date, endMin + prefs.windDownMin + prefs.sleepHours * 60),
      };
      caffeineOnAt = atOn(date, primary.start - 30);
      caffeineCutoffAt = atOn(date, endMin + prefs.windDownMin - 6 * 60);
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
