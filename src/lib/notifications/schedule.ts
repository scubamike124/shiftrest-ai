// Pure scheduling engine — given today's shifts + prefs + notification prefs,
// returns the reminders that should fire inside the current cron window.
//
// Called from the /api/public/hooks/notify cron handler. No I/O, no Date.now()
// internal — `now` is injected so we can unit-test deterministically.

import { type Shift, endAbsolute } from "@/lib/shifts";
import { shiftsForDate } from "@/lib/schedule";
import type { Prefs } from "@/lib/prefs";
import type { ReminderKind } from "./copy";

export type NotifPrefs = {
  enabled: boolean;
  wind_down: boolean;
  caffeine_cutoff: boolean;
  bright_light: boolean;
  shift_start: boolean;
  shift_end_recovery: boolean;
  quiet_start: string; // "HH:MM:SS"
  quiet_end: string;
  daily_cap: number;
  timezone: string;
};

export type DueReminder = {
  kind: ReminderKind;
  scheduledFor: Date;
};

const CRON_WINDOW_MIN = 5; // matches pg_cron `*/5 * * * *`

/** Returns true if `hhmm` (minutes from local midnight) sits inside quiet window. */
export function isQuiet(minuteOfDay: number, quietStart: string, quietEnd: string): boolean {
  const s = parseHHMM(quietStart);
  const e = parseHHMM(quietEnd);
  if (s === e) return false;
  if (s < e) return minuteOfDay >= s && minuteOfDay < e;
  // wraps midnight (e.g. 22:00 → 07:00)
  return minuteOfDay >= s || minuteOfDay < e;
}

function parseHHMM(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

/** Minute-of-day for `date` in IANA `tz`. Falls back to UTC offset. */
export function minuteOfDayInTz(date: Date, tz: string): number {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(date);
    const h = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
    const m = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
    return (h % 24) * 60 + m;
  } catch {
    return date.getUTCHours() * 60 + date.getUTCMinutes();
  }
}

/** Local-date "YYYY-MM-DD" for `date` in tz — used to build absolute reminder timestamps. */
export function ymdInTz(date: Date, tz: string): { y: number; m: number; d: number } {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(date);
    return {
      y: Number(parts.find((p) => p.type === "year")?.value ?? 1970),
      m: Number(parts.find((p) => p.type === "month")?.value ?? 1),
      d: Number(parts.find((p) => p.type === "day")?.value ?? 1),
    };
  } catch {
    return { y: date.getUTCFullYear(), m: date.getUTCMonth() + 1, d: date.getUTCDate() };
  }
}

/** Convert "local time in tz on date Y-M-D" → UTC Date. Uses Intl offset lookup. */
export function utcFromLocal(
  y: number,
  m: number,
  d: number,
  minuteOfDay: number,
  tz: string,
): Date {
  // Iteratively correct: start with naive UTC, measure offset of that wall time in tz, subtract.
  const naive = Date.UTC(y, m - 1, d, Math.floor(minuteOfDay / 60), minuteOfDay % 60);
  const offsetMin = tzOffsetMinutes(new Date(naive), tz);
  return new Date(naive - offsetMin * 60_000);
}

function tzOffsetMinutes(date: Date, tz: string): number {
  try {
    const dtf = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
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
    const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
    return Math.round((asUtc - date.getTime()) / 60_000);
  } catch {
    return 0;
  }
}

/**
 * For today's shift in the user's timezone, compute every reminder whose
 * scheduled-for time falls in the cron window [now, now + CRON_WINDOW_MIN).
 * Caller is responsible for quiet-hours/cap/dedupe filtering.
 */
export function computeDueReminders(args: {
  shifts: Shift[];
  prefs: Prefs;
  notif: NotifPrefs;
  now: Date;
}): DueReminder[] {
  const { shifts, prefs, notif, now } = args;
  if (!notif.enabled) return [];

  const tz = notif.timezone || "UTC";
  const candidates: DueReminder[] = [];

  // Look at today and yesterday (yesterday's overnight shift may end today).
  for (const dayOffset of [-1, 0]) {
    const probe = new Date(now.getTime() + dayOffset * 86_400_000);
    const ymd = ymdInTz(probe, tz);
    const probeLocalMid = utcFromLocal(ymd.y, ymd.m, ymd.d, 0, tz);
    const dayShifts = shiftsForDate(shifts, probeLocalMid, prefs.cycleAnchor, prefs.cycleWeeks);
    if (dayShifts.length === 0) continue;
    const shift = dayShifts[0];
    const endMin = endAbsolute(shift);
    const wakeMin = shift.start - 90;
    const shiftStartReminderMin = shift.start - 15;
    const windDownStartMin = endMin; // wind-down begins at clock-out
    const sleepStartMin = endMin + prefs.windDownMin;
    const caffeineCutoffPingMin = sleepStartMin - 6 * 60 - 10;

    const add = (kind: ReminderKind, enabled: boolean, minuteOfDay: number) => {
      if (!enabled) return;
      const at = utcFromLocal(ymd.y, ymd.m, ymd.d, minuteOfDay, tz);
      candidates.push({ kind, scheduledFor: at });
    };

    add("bright-light", notif.bright_light, wakeMin);
    add("shift-start", notif.shift_start, shiftStartReminderMin);
    add("caffeine-cutoff", notif.caffeine_cutoff, caffeineCutoffPingMin);
    add("shift-end-recovery", notif.shift_end_recovery, endMin);
    add("wind-down", notif.wind_down, windDownStartMin);
  }

  const lo = now.getTime();
  const hi = lo + CRON_WINDOW_MIN * 60_000;
  return candidates.filter((c) => c.scheduledFor.getTime() >= lo && c.scheduledFor.getTime() < hi);
}
