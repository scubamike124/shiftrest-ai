// Pure scheduling engine — given today's shifts + prefs + notification prefs
// (+ optional user_events for Bundle 2), returns the reminders that should
// fire inside the current cron window.
//
// Called from the /api/public/hooks/notify cron handler. No I/O, no Date.now()
// internal — `now` is injected so we can unit-test deterministically.

import type { Shift } from "@/lib/shifts";
import { buildReminders, buildSchedule, type PlannedReminderKind } from "@/lib/schedule-core";
import type { Prefs } from "@/lib/prefs";
import type { ReminderKind } from "./copy";

export type NotifPrefs = {
  enabled: boolean;
  wind_down: boolean;
  caffeine_cutoff: boolean;
  bright_light: boolean;
  shift_start: boolean;
  shift_end_recovery: boolean;
  smart_alarm: boolean;
  commute: boolean;
  calendar: boolean;
  quiet_start: string; // "HH:MM:SS"
  quiet_end: string;
  daily_cap: number;
  timezone: string;
};

/** A user_events row (raw DB shape) consumed by the scheduler. */
export type ScheduledEvent = {
  id: string;
  kind: "calendar" | "commute" | "personal";
  title: string;
  starts_at: string; // ISO
  reminder_min: number;
  travel_buffer_min: number;
};

export type DueReminder = {
  kind: ReminderKind;
  scheduledFor: Date;
  /** Optional event id for dedupe + click-through context. */
  eventId?: string;
  /** Optional event title for personalised copy. */
  title?: string;
  /** Reminders flagged critical bypass the daily cap (smart alarm). */
  critical?: boolean;
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

/** Convert "local time in tz on date Y-M-D" → UTC Date. Re-exported from
 *  the shared tz helpers so existing callers keep working. */
import { utcFromLocal, tzOffsetMinutes } from "@/lib/time/tz";
export { utcFromLocal, tzOffsetMinutes };

/**
 * For today's shift in the user's timezone + the next 24h of user_events,
 * compute every reminder whose scheduled-for time falls in the cron window
 * [now, now + CRON_WINDOW_MIN). Caller is responsible for quiet-hours, cap,
 * and dedupe filtering.
 */
export function computeDueReminders(args: {
  shifts: Shift[];
  prefs: Prefs;
  notif: NotifPrefs;
  events?: ScheduledEvent[];
  now: Date;
}): DueReminder[] {
  const { shifts, prefs, notif, events = [], now } = args;
  if (!notif.enabled) return [];

  const tz = notif.timezone || "UTC";
  const candidates: DueReminder[] = [];

  // ---------- shift-driven reminders ----------
  // Same computation as every screen and as one-tap overtime: the shared
  // schedule module. It covers every shift (not only the first of the day),
  // including one that starts just after midnight, whose bright-light
  // reminder falls on the previous evening.
  const schedule = buildSchedule({
    shifts,
    tz,
    from: now,
    days: 2,
    cycleAnchor: prefs.cycleAnchor,
    cycleWeeks: prefs.cycleWeeks,
  });
  const enabledByKind: Record<PlannedReminderKind, boolean> = {
    "bright-light": notif.bright_light,
    "shift-start": notif.shift_start,
    "caffeine-cutoff": notif.caffeine_cutoff,
    "shift-end-recovery": notif.shift_end_recovery,
    "wind-down": notif.wind_down,
  };
  for (const r of buildReminders(schedule, prefs, new Date(now.getTime() - 1))) {
    if (enabledByKind[r.kind]) candidates.push({ kind: r.kind, scheduledFor: r.at });
  }

  // ---------- event-driven reminders ----------
  for (const ev of events) {
    const startsAt = new Date(ev.starts_at);
    if (isNaN(startsAt.getTime())) continue;

    if (ev.kind === "calendar" && notif.calendar) {
      const at = new Date(startsAt.getTime() - ev.reminder_min * 60_000);
      candidates.push({ kind: "calendar-prep", scheduledFor: at, eventId: ev.id, title: ev.title });
    }
    if (ev.kind === "commute" && notif.commute) {
      const at = new Date(startsAt.getTime() - ev.travel_buffer_min * 60_000);
      candidates.push({ kind: "commute-leave", scheduledFor: at, eventId: ev.id, title: ev.title });
    }
    if (ev.kind === "personal") {
      // Personal events with title prefix "Alarm:" are smart alarms.
      const isAlarm = /^alarm:/i.test(ev.title);
      if (isAlarm && notif.smart_alarm) {
        candidates.push({
          kind: "smart-alarm",
          scheduledFor: startsAt,
          eventId: ev.id,
          title: ev.title.replace(/^alarm:\s*/i, "") || undefined,
          critical: true,
        });
      } else if (notif.calendar) {
        const at = new Date(startsAt.getTime() - ev.reminder_min * 60_000);
        candidates.push({ kind: "calendar-prep", scheduledFor: at, eventId: ev.id, title: ev.title });
      }
    }
  }

  const lo = now.getTime();
  const hi = lo + CRON_WINDOW_MIN * 60_000;
  return candidates.filter((c) => c.scheduledFor.getTime() >= lo && c.scheduledFor.getTime() < hi);
}
