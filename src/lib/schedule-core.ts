// Shared schedule computation — the single source of truth for every sleep,
// wind-down, caffeine and light time RestPilot shows or reminds about.
//
// Before this module, the Plan screen, the dashboard Long Clock, the 7-day
// plan and the recommendation list each computed their own times, and they
// disagreed (caffeine cutoff 6h vs 8h before sleep, "bright light at sunrise"
// vs "amber glasses at sunrise" after a night shift, pre-shift meal at 75,
// 90 or 120 minutes before clock-in). Every screen now derives its times from
// `shiftAnchors()` and its explanations from `ANCHOR_WHY`.
//
// Two layers:
//   1. `shiftAnchors()` — minute offsets relative to the shift's local
//      midnight. Pure arithmetic; used by the existing minute-of-day widgets.
//   2. `buildSchedule()` / `applyShiftChange()` — concrete instants (Date) in
//      the user's IANA time zone. DST-safe: shift times are wall-clock times
//      in that zone; durations (sleep length, caffeine clearance, wake lead)
//      are real elapsed time. This layer is what reminders, the one-tap
//      "my shift was extended / changed" action and native notification
//      scheduling consume.
//
// No runtime imports except the dependency-free tz helpers, so the module
// runs unchanged in the browser, on the server and under `node --test`.

import { localPartsInTz, utcFromLocal } from "./time/tz.ts";

const MIN = 60_000;
const HOUR = 60 * MIN;

/** The rules every screen uses. Change a number here and every screen agrees. */
export const SCHEDULE_RULES = {
  /** Wake + bright light this long before clock-in. */
  wakeBeforeShiftMin: 90,
  /** Light pre-shift meal this long before clock-in (after waking). */
  mealBeforeShiftMin: 75,
  /** First caffeine dose this long before clock-in. */
  caffeineOnBeforeShiftMin: 30,
  /** Last caffeine this long before the sleep window opens. */
  caffeineCutoffBeforeSleepMin: 6 * 60,
  /** Pre-shift power nap (high-fatigue days) this long before clock-in. */
  napBeforeShiftMin: 180,
  /** Recovery block after waking. */
  recoveryAfterWakeMin: 90,
  /** Shift-start reminder lead time. */
  shiftReminderLeadMin: 15,
  /** The caffeine-cutoff reminder fires this long BEFORE the cutoff. */
  caffeineCutoffReminderLeadMin: 10,
  /** A shift that starts in [22:00, 04:00) is a night shift. */
  nightStartFromMin: 22 * 60,
  nightStartBeforeMin: 4 * 60,
} as const;

/** Plain-language "why this time" for every anchor a screen can show. */
export const ANCHOR_WHY = {
  wake:
    "Wake 90 minutes before your shift so you have time to wake up fully, get light and eat before clock-in.",
  brightLight:
    "Bright light soon after waking tells your body clock it is 'day', which raises alertness for the shift ahead.",
  meal:
    "A light meal about 75 minutes before clock-in fuels the shift without the slump a heavy meal causes.",
  caffeineOn:
    "Caffeine takes about 30 minutes to work, so a dose 30 minutes before clock-in peaks as your shift starts.",
  caffeineCutoff:
    "Caffeine's half-life is about 5 hours (3–7 for most people). Stopping 6 hours before your sleep window lets most of it clear, so it does not delay or lighten sleep.",
  windDown:
    "Your wind-down starts when your shift ends. Dim light and no screens let your body wind down before sleep.",
  sleep:
    "Your sleep window opens after your wind-down and lasts the sleep target in your preferences.",
  amberGlasses:
    "After a night shift, morning sunlight on the way home tells your body it is daytime and makes daytime sleep harder. Amber or blue-blocking glasses limit that.",
  recovery:
    "After waking: water, light movement and protein help you recover before the next shift.",
  shiftEnd:
    "Your shift has ended: water, a light snack and dim light start the wind-down toward sleep.",
  shortTurnaround:
    "Less time than your sleep target is available before your next shift, so the sleep window is cut short to leave time to wake up before it.",
  offDayLight:
    "On a day off, morning daylight helps keep your body clock steady.",
} as const;

export type ShiftTimes = {
  /** Minutes from local midnight, 0..1439. */
  start: number;
  /** Minutes from local midnight. `end <= start` means it ends the next day. */
  end: number;
};

export type SleepPrefs = { sleepHours: number; windDownMin: number };

export function isNightShift(start: number): boolean {
  return start >= SCHEDULE_RULES.nightStartFromMin || start < SCHEDULE_RULES.nightStartBeforeMin;
}

/** Shift end in minutes from the shift day's midnight (adds 1440 when overnight). */
export function shiftEndMinute(shift: ShiftTimes): number {
  return shift.end <= shift.start ? shift.end + 1440 : shift.end;
}

/** Normalize a minute offset to 0..1439 (for minute-of-day widgets). */
export function minuteOfDay(minute: number): number {
  return ((Math.round(minute) % 1440) + 1440) % 1440;
}

export type ShiftAnchors = {
  isNight: boolean;
  wake: number;
  meal: number;
  caffeineOn: number;
  shiftStart: number;
  shiftEnd: number;
  windDownStart: number;
  sleepStart: number;
  sleepEnd: number;
  caffeineCutoff: number;
  recoveryEnd: number;
  nap: number;
};

/**
 * Every anchor for one shift, in minutes from the shift day's local midnight.
 * Values can be negative (the evening before) or above 1440 (the next day).
 * Use `minuteOfDay()` for a clock face; use `buildSchedule()` for instants.
 */
export function shiftAnchors(shift: ShiftTimes, prefs: SleepPrefs): ShiftAnchors {
  const R = SCHEDULE_RULES;
  const shiftEnd = shiftEndMinute(shift);
  const sleepStart = shiftEnd + prefs.windDownMin;
  const sleepEnd = sleepStart + prefs.sleepHours * 60;
  return {
    isNight: isNightShift(shift.start),
    wake: shift.start - R.wakeBeforeShiftMin,
    meal: shift.start - R.mealBeforeShiftMin,
    caffeineOn: shift.start - R.caffeineOnBeforeShiftMin,
    shiftStart: shift.start,
    shiftEnd,
    windDownStart: shiftEnd,
    sleepStart,
    sleepEnd,
    caffeineCutoff: sleepStart - R.caffeineCutoffBeforeSleepMin,
    recoveryEnd: sleepEnd + R.recoveryAfterWakeMin,
    nap: shift.start - R.napBeforeShiftMin,
  };
}

/** Days since 1970-01-01 for a civil (calendar) date. No time zone involved. */
export function civilDay(y: number, m: number, d: number): number {
  return Math.floor(Date.UTC(y, m - 1, d) / 86_400_000);
}

export type CivilDate = { y: number; m: number; d: number };

/** The calendar date of a JS Date in the runtime's local zone. */
export function localCivilDate(date: Date): CivilDate {
  return { y: date.getFullYear(), m: date.getMonth() + 1, d: date.getDate() };
}

export type AnchorInstants = { [K in Exclude<keyof ShiftAnchors, "isNight">]: Date } & { isNight: boolean };

/**
 * THE canonical instants for one shift occurrence. Clock-in and clock-out
 * are wall-clock times; everything else is elapsed time from them, so a
 * sleep window that crosses a DST change is still `sleepHours` long.
 * Every screen and every reminder derives its times from this function.
 */
export function instantsForWindow(
  startsAt: Date,
  endsAt: Date,
  prefs: SleepPrefs,
  isNight = false,
): AnchorInstants {
  const R = SCHEDULE_RULES;
  const at = (base: Date, minutes: number) => new Date(base.getTime() + minutes * MIN);
  const sleepStart = at(endsAt, prefs.windDownMin);
  const sleepEnd = at(sleepStart, prefs.sleepHours * 60);
  return {
    isNight,
    wake: at(startsAt, -R.wakeBeforeShiftMin),
    meal: at(startsAt, -R.mealBeforeShiftMin),
    caffeineOn: at(startsAt, -R.caffeineOnBeforeShiftMin),
    shiftStart: startsAt,
    shiftEnd: endsAt,
    windDownStart: endsAt,
    sleepStart,
    sleepEnd,
    caffeineCutoff: at(sleepStart, -R.caffeineCutoffBeforeSleepMin),
    recoveryEnd: at(sleepEnd, R.recoveryAfterWakeMin),
    nap: at(startsAt, -R.napBeforeShiftMin),
  };
}

/** Instants for a weekly-template shift worked on calendar date `on` in `tz`. */
export function anchorInstants(shift: ShiftTimes, prefs: SleepPrefs, on: CivilDate, tz: string): AnchorInstants {
  const startsAt = utcFromLocal(on.y, on.m, on.d, shift.start, tz);
  const endsAt = utcFromLocal(on.y, on.m, on.d, shiftEndMinute(shift), tz);
  return instantsForWindow(startsAt, endsAt, prefs, isNightShift(shift.start));
}

/**
 * Same as `shiftAnchors`, but resolved on a real date in a real zone: each
 * value is the WALL-CLOCK minute (relative to `on`'s midnight) of the
 * canonical instant. Identical to `shiftAnchors` except across a DST
 * change, where it matches the 7-day plan and the reminders exactly.
 * Minute-of-day screens (Plan, dashboard Long Clock, recommendations) use it.
 */
export function shiftAnchorsOn(shift: ShiftTimes, prefs: SleepPrefs, on: CivilDate, tz: string): ShiftAnchors {
  const inst = anchorInstants(shift, prefs, on, tz);
  const base = civilDay(on.y, on.m, on.d);
  const wall = (t: Date) => {
    const p = localPartsInTz(t, tz);
    return (civilDay(p.year, p.month, p.day) - base) * 1440 + p.minuteOfDay;
  };
  const out = { isNight: inst.isNight } as ShiftAnchors;
  for (const k of Object.keys(inst) as (keyof AnchorInstants)[]) {
    if (k !== "isNight") (out as Record<string, number | boolean>)[k] = wall(inst[k]);
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────
// Concrete schedule in a time zone
// ─────────────────────────────────────────────────────────────────────────

/** One concrete shift occurrence. */
export type ScheduledShift = {
  /** Stable id. For weekly-template shifts: `${templateId}@${YYYY-MM-DD}`. */
  id: string;
  startsAt: Date;
  endsAt: Date;
  /** Weekly-template row this occurrence came from, when there is one. */
  templateId?: string;
  title?: string | null;
};

export type Schedule = {
  /** IANA time zone the wall-clock shift times are in. */
  tz: string;
  /** Sorted by start time. */
  shifts: ScheduledShift[];
};

/** Weekly template row, matching `Shift` in shifts.ts (0 = Monday). */
export type TemplateShift = ShiftTimes & {
  id: string;
  day: number;
  weekIndex?: number;
  title?: string | null;
};

const ymdKey = (y: number, m: number, d: number) =>
  `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

function civilFromDay(day: number): { y: number; m: number; d: number } {
  const dt = new Date(day * 86_400_000);
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() };
}

/** Today's civil day number in the runtime's local time zone. */
function todayCivilDay(): number {
  const n = new Date();
  return civilDay(n.getFullYear(), n.getMonth() + 1, n.getDate());
}

/**
 * Rotation week (0-based) for a civil day, given a YYYY-MM-DD anchor.
 *
 * With no anchor saved, Week A is the week containing `today`. (The old
 * fallback used the Monday of `day` itself, so every day was 0 weeks from its
 * own anchor and a 2-6 week rotation never advanced.) The dashboard saves an
 * anchor the first time it sees a rotation without one.
 */
export function rotationWeekIndex(
  day: number,
  anchor: string | null | undefined,
  cycleWeeks: number,
  today: number = todayCivilDay(),
): number {
  const cw = Math.max(1, Math.min(6, Math.round(cycleWeeks || 1)));
  if (cw === 1) return 0;
  const mondayOf = (n: number) => n - ((((n + 3) % 7) + 7) % 7); // 1970-01-05 was a Monday
  const m = anchor ? /^(\d{4})-(\d{2})-(\d{2})/.exec(anchor) : null;
  const anchorMonday = m
    ? mondayOf(civilDay(Number(m[1]), Number(m[2]), Number(m[3])))
    : mondayOf(today);
  const weeks = Math.round((mondayOf(day) - anchorMonday) / 7);
  return ((weeks % cw) + cw) % cw;
}

/**
 * Expand the weekly (optionally multi-week rotating) template into concrete
 * shift occurrences in `tz`: every shift that ended no more than
 * `lookbackMin` before `from` (so it includes the overnight shift that is
 * still running and the one that just ended) through `days` days ahead.
 */
export function buildSchedule(args: {
  shifts: TemplateShift[];
  tz: string;
  from: Date;
  days?: number;
  cycleAnchor?: string | null;
  cycleWeeks?: number;
  /**
   * Keep shifts that ended up to this long before `from` (default 24h), so a
   * shift that just ended can still be extended ("I'm still here") and its
   * sleep window is still planned.
   */
  lookbackMin?: number;
}): Schedule {
  const { shifts, tz, from, days = 7, cycleAnchor = null, cycleWeeks = 1, lookbackMin = 24 * 60 } = args;
  const keepAfter = from.getTime() - lookbackMin * MIN;
  const p = localPartsInTz(from, tz);
  const today = civilDay(p.year, p.month, p.day);
  const out: ScheduledShift[] = [];
  for (let offset = -2; offset < days; offset++) {
    const day = today + offset;
    const { y, m, d } = civilFromDay(day);
    const weekday = (((day + 3) % 7) + 7) % 7; // 0 = Monday
    const wi = rotationWeekIndex(day, cycleAnchor, cycleWeeks);
    for (const s of shifts) {
      if (s.day !== weekday || (s.weekIndex ?? 0) !== wi) continue;
      const startsAt = utcFromLocal(y, m, d, s.start, tz);
      const endsAt = utcFromLocal(y, m, d, shiftEndMinute(s), tz);
      if (endsAt.getTime() <= keepAfter) continue;
      out.push({ id: `${s.id}@${ymdKey(y, m, d)}`, templateId: s.id, startsAt, endsAt, title: s.title ?? null });
    }
  }
  return { tz, shifts: sortShifts(out) };
}

function sortShifts(shifts: ScheduledShift[]): ScheduledShift[] {
  return [...shifts].sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
}

// ─────────────────────────────────────────────────────────────────────────
// Sleep plan and reminders from a concrete schedule
// ─────────────────────────────────────────────────────────────────────────

export type SleepOpportunity = {
  /** The shift this sleep follows. */
  afterShiftId: string;
  windDownStart: Date;
  sleepStart: Date;
  sleepEnd: Date;
  caffeineCutoff: Date;
  /** Sleep available in this window, in minutes (elapsed time). */
  sleepMinutes: number;
  /** True when the next shift leaves less than the sleep target. */
  shortTurnaround: boolean;
  why: string[];
};

/** Kinds match `ReminderKind` in notifications/copy.ts. */
export type PlannedReminderKind =
  | "bright-light"
  | "caffeine-cutoff"
  | "shift-start"
  | "shift-end-recovery"
  | "wind-down";

export type PlannedReminder = {
  /** Stable across recomputes: `${kind}:${shiftId}`. Use it as the notification id. */
  id: string;
  kind: PlannedReminderKind;
  at: Date;
  shiftId: string;
  why: string;
};

/**
 * Sleep windows after each shift that has not ended more than a sleep target
 * ago. Wall-clock shift times, elapsed-time durations, so a sleep window over
 * a DST change is still `sleepHours` long. When the next shift starts before
 * the full target plus wake lead, the window is shortened and flagged.
 */
export function buildSleepPlan(schedule: Schedule, prefs: SleepPrefs, now: Date): SleepOpportunity[] {
  const R = SCHEDULE_RULES;
  const shifts = sortShifts(schedule.shifts);
  const plan: SleepOpportunity[] = [];
  shifts.forEach((shift, i) => {
    const inst = instantsForWindow(shift.startsAt, shift.endsAt, prefs);
    const windDownStart = inst.windDownStart;
    const sleepStart = inst.sleepStart;
    let sleepEnd = inst.sleepEnd;
    const next = shifts[i + 1];
    let shortTurnaround = false;
    const why: string[] = [ANCHOR_WHY.windDown, ANCHOR_WHY.sleep, ANCHOR_WHY.caffeineCutoff];
    if (next) {
      const latestWake = next.startsAt.getTime() - R.wakeBeforeShiftMin * MIN;
      if (latestWake < sleepEnd.getTime()) {
        shortTurnaround = true;
        sleepEnd = new Date(Math.max(sleepStart.getTime(), latestWake));
        why.push(ANCHOR_WHY.shortTurnaround);
      }
    }
    // Filter AFTER trimming: a trimmed window that already ended is past.
    if (sleepEnd.getTime() <= now.getTime()) return;
    plan.push({
      afterShiftId: shift.id,
      windDownStart,
      sleepStart,
      sleepEnd,
      caffeineCutoff: inst.caffeineCutoff,
      sleepMinutes: Math.round((sleepEnd.getTime() - sleepStart.getTime()) / MIN),
      shortTurnaround,
      why,
    });
  });
  return plan;
}

/** Every future reminder for the schedule, sorted by time. */
export function buildReminders(schedule: Schedule, prefs: SleepPrefs, now: Date): PlannedReminder[] {
  const R = SCHEDULE_RULES;
  const out: PlannedReminder[] = [];
  const sleepByShift = new Map(buildSleepPlan(schedule, prefs, new Date(0)).map((s) => [s.afterShiftId, s]));
  for (const shift of schedule.shifts) {
    const add = (kind: PlannedReminderKind, at: Date, why: string) => {
      if (at.getTime() > now.getTime()) out.push({ id: `${kind}:${shift.id}`, kind, at, shiftId: shift.id, why });
    };
    const inst = instantsForWindow(shift.startsAt, shift.endsAt, prefs);
    add("bright-light", inst.wake, ANCHOR_WHY.brightLight);
    add(
      "shift-start",
      new Date(shift.startsAt.getTime() - R.shiftReminderLeadMin * MIN),
      `Your shift starts in ${R.shiftReminderLeadMin} minutes.`,
    );
    const sleep = sleepByShift.get(shift.id);
    if (sleep) {
      add(
        "caffeine-cutoff",
        new Date(sleep.caffeineCutoff.getTime() - R.caffeineCutoffReminderLeadMin * MIN),
        `Last caffeine in ${R.caffeineCutoffReminderLeadMin} minutes. ${ANCHOR_WHY.caffeineCutoff}`,
      );
    }
    add("shift-end-recovery", inst.shiftEnd, ANCHOR_WHY.shiftEnd);
    add("wind-down", inst.windDownStart, ANCHOR_WHY.windDown);
  }
  return out.sort((a, b) => a.at.getTime() - b.at.getTime() || a.id.localeCompare(b.id));
}

// ─────────────────────────────────────────────────────────────────────────
// One-tap overtime / shift change
// ─────────────────────────────────────────────────────────────────────────

export type ShiftChange =
  /** "My shift was extended": new end time, or minutes added to the end. */
  | { kind: "extend"; shiftId: string; endsAt?: Date; extraMinutes?: number }
  /** "My shift changed": new start and/or end for one occurrence. */
  | { kind: "reschedule"; shiftId: string; startsAt?: Date; endsAt?: Date }
  /** Shift cancelled / called off. */
  | { kind: "cancel"; shiftId: string }
  /** Swapped: give up `shiftId`, take `take` (another person's shift) instead. */
  | { kind: "swap"; shiftId: string; take: { id?: string; startsAt: Date; endsAt: Date; title?: string | null } }
  /** Extra shift picked up. */
  | { kind: "add"; shift: { id?: string; startsAt: Date; endsAt: Date; title?: string | null } };

export type ShiftChangeResult = {
  schedule: Schedule;
  sleepPlan: SleepOpportunity[];
  /** Full future reminder set. Replace previously scheduled reminders with this list. */
  reminders: PlannedReminder[];
  /** Reminder ids that existed before the change and no longer exist: cancel these. */
  cancelledReminderIds: string[];
  /** One-line plain-language summary of what changed, for a toast. */
  summary: string;
};

export class ShiftChangeError extends Error {}

const MAX_SHIFT_MS = 24 * HOUR;

function validWindow(startsAt: Date, endsAt: Date): void {
  const s = startsAt.getTime();
  const e = endsAt.getTime();
  if (!Number.isFinite(s) || !Number.isFinite(e)) throw new ShiftChangeError("Shift times are invalid.");
  if (e <= s) throw new ShiftChangeError("A shift must end after it starts.");
  if (e - s > MAX_SHIFT_MS) throw new ShiftChangeError("A shift cannot be longer than 24 hours.");
}

/**
 * Apply a one-off change to ONE occurrence and recompute the remaining sleep
 * plan and reminders. Pure: the input schedule is not modified, and the
 * weekly template is not changed (that is a separate, deliberate edit).
 */
export function applyShiftChange(
  schedule: Schedule,
  change: ShiftChange,
  opts: { prefs: SleepPrefs; now: Date },
): ShiftChangeResult {
  const { prefs, now } = opts;
  const before = new Set(buildReminders(schedule, prefs, now).map((r) => r.id));
  let shifts = schedule.shifts.map((s) => ({ ...s }));
  const find = (id: string) => {
    const idx = shifts.findIndex((s) => s.id === id);
    if (idx < 0) throw new ShiftChangeError("That shift is not in your schedule.");
    return idx;
  };
  let summary: string;
  let changedId: string | null = null;
  switch (change.kind) {
    case "extend": {
      const i = find(change.shiftId);
      const cur = shifts[i];
      const endsAt =
        change.endsAt ??
        (change.extraMinutes !== undefined && change.extraMinutes > 0
          ? new Date(cur.endsAt.getTime() + change.extraMinutes * MIN)
          : undefined);
      if (!endsAt) throw new ShiftChangeError("Give the new end time or the extra minutes.");
      if (endsAt.getTime() <= cur.endsAt.getTime()) throw new ShiftChangeError("An extension must end later than the shift did.");
      validWindow(cur.startsAt, endsAt);
      shifts[i] = { ...cur, endsAt };
      changedId = cur.id;
      summary = `Shift extended by ${Math.round((endsAt.getTime() - cur.endsAt.getTime()) / MIN)} min. Sleep and reminders moved to match.`;
      break;
    }
    case "reschedule": {
      const i = find(change.shiftId);
      const cur = shifts[i];
      const startsAt = change.startsAt ?? cur.startsAt;
      const endsAt = change.endsAt ?? cur.endsAt;
      validWindow(startsAt, endsAt);
      shifts[i] = { ...cur, startsAt, endsAt };
      changedId = cur.id;
      summary = "Shift times updated. Sleep and reminders moved to match.";
      break;
    }
    case "cancel": {
      find(change.shiftId);
      shifts = shifts.filter((s) => s.id !== change.shiftId);
      summary = "Shift cancelled. Its reminders were removed.";
      break;
    }
    case "swap": {
      find(change.shiftId);
      validWindow(change.take.startsAt, change.take.endsAt);
      shifts = shifts.filter((s) => s.id !== change.shiftId);
      changedId = change.take.id ?? `swap:${change.shiftId}`;
      if (shifts.some((x) => x.id === changedId)) throw new ShiftChangeError("That shift is already in your schedule.");
      shifts.push({
        id: changedId,
        startsAt: change.take.startsAt,
        endsAt: change.take.endsAt,
        title: change.take.title ?? null,
      });
      summary = "Shift swapped. Sleep and reminders follow the new shift.";
      break;
    }
    case "add": {
      validWindow(change.shift.startsAt, change.shift.endsAt);
      const id = change.shift.id ?? `extra:${change.shift.startsAt.toISOString()}`;
      if (shifts.some((s) => s.id === id)) throw new ShiftChangeError("That shift is already in your schedule.");
      changedId = id;
      shifts.push({ id, startsAt: change.shift.startsAt, endsAt: change.shift.endsAt, title: change.shift.title ?? null });
      summary = "Extra shift added. Sleep and reminders updated.";
      break;
    }
  }
  const sorted = sortShifts(shifts);
  // Only the changed or added shift is checked: an overlap that already
  // existed in the template must not block an unrelated change or a cancel.
  if (changedId !== null) {
    const changed = sorted.find((x) => x.id === changedId);
    if (changed && sorted.some((x) => x.id !== changedId
      && x.startsAt.getTime() < changed.endsAt.getTime()
      && changed.startsAt.getTime() < x.endsAt.getTime())) {
      throw new ShiftChangeError("That change would overlap another shift.");
    }
  }
  const next: Schedule = { tz: schedule.tz, shifts: sorted };
  const reminders = buildReminders(next, prefs, now);
  const after = new Set(reminders.map((r) => r.id));
  return {
    schedule: next,
    sleepPlan: buildSleepPlan(next, prefs, now),
    reminders,
    cancelledReminderIds: [...before].filter((id) => !after.has(id)),
    summary,
  };
}
