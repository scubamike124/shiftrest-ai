// Native reminders for the RestPilot iPhone app: pure planning.
//
// Turns the user's shifts + sleep prefs into the local notifications the app
// should have pending for the next few days. Times come from
// buildMultiDayPlan() — the same plan the dashboard and /plan show — so a
// reminder never disagrees with the screen.
//
// No I/O and no Date.now(): `now` is injected so tests are deterministic.
// Times are device-local, which is what iOS local notifications use.

import type { Prefs } from "@/lib/prefs";
import type { Shift } from "@/lib/shifts";
import { buildMultiDayPlan, type DayPlan } from "@/lib/schedule";

export const NATIVE_REMINDER_KINDS = [
  "upcoming-shift",
  "bedtime",
  "wind-down",
  "shift-change",
  "recovery",
] as const;
export type NativeReminderKind = (typeof NATIVE_REMINDER_KINDS)[number];

export const NATIVE_REMINDER_LABEL: Record<NativeReminderKind, string> = {
  "upcoming-shift": "Upcoming shift",
  bedtime: "Bedtime",
  "wind-down": "Wind-down",
  "shift-change": "Shift pattern change",
  recovery: "Recovery",
};

export const NATIVE_REMINDER_DESC: Record<NativeReminderKind, string> = {
  "upcoming-shift": "Before each shift starts, so you are ready, not rushing.",
  bedtime: "When your planned sleep window opens.",
  "wind-down": "When your wind-down starts after a shift.",
  "shift-change": "The day before you switch between day, evening and night shifts.",
  recovery: "After your sleep window: hydrate, light, movement.",
};

export type NativeReminderSettings = {
  enabled: boolean;
  kinds: Record<NativeReminderKind, boolean>;
  /** Minutes before clock-in for the upcoming-shift reminder. */
  upcomingShiftLeadMin: number;
  quietHours: { enabled: boolean; start: string; end: string };
  /** Most reminders on one calendar day. */
  dailyCap: number;
};

export const DEFAULT_NATIVE_REMINDER_SETTINGS: NativeReminderSettings = {
  enabled: false,
  kinds: {
    "upcoming-shift": true,
    bedtime: true,
    "wind-down": true,
    "shift-change": true,
    recovery: false,
  },
  upcomingShiftLeadMin: 60,
  // Off by default: shift workers sleep at different hours every week, and
  // reminders never fire inside a planned sleep window (see avoidSleep).
  quietHours: { enabled: false, start: "23:00", end: "06:00" },
  dailyCap: 4,
};

export const LEAD_OPTIONS = [15, 30, 60, 90, 120] as const;
export const DAILY_CAP_RANGE = { min: 1, max: 8 } as const;
/** iOS keeps at most 64 pending local notifications per app; stay well under. */
export const MAX_PENDING = 48;
/** Days ahead to plan. Re-planned on every app open and every schedule change. */
export const HORIZON_DAYS = 7;
const DEDUPE_WINDOW_MS = 30 * 60_000;

export type PlannedReminder = {
  id: number;
  kind: NativeReminderKind;
  at: Date;
  title: string;
  body: string;
  /** In-app path opened when the notification is tapped. */
  path: string;
};

/** Accepts stored or partial settings and returns a complete, clamped object. */
export function normalizeSettings(raw: unknown): NativeReminderSettings {
  const d = DEFAULT_NATIVE_REMINDER_SETTINGS;
  const r = (raw && typeof raw === "object" ? raw : {}) as Partial<NativeReminderSettings>;
  const kinds = { ...d.kinds };
  for (const k of NATIVE_REMINDER_KINDS) {
    const v = (r.kinds as Record<string, unknown> | undefined)?.[k];
    if (typeof v === "boolean") kinds[k] = v;
  }
  const lead = Number(r.upcomingShiftLeadMin);
  const cap = Math.round(Number(r.dailyCap));
  const q = (r.quietHours ?? {}) as Partial<NativeReminderSettings["quietHours"]>;
  const hhmm = (v: unknown, fallback: string) =>
    typeof v === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(v) ? v : fallback;
  return {
    enabled: r.enabled === true,
    kinds,
    upcomingShiftLeadMin: (LEAD_OPTIONS as readonly number[]).includes(lead)
      ? lead
      : d.upcomingShiftLeadMin,
    quietHours: {
      enabled: q.enabled === true,
      start: hhmm(q.start, d.quietHours.start),
      end: hhmm(q.end, d.quietHours.end),
    },
    dailyCap: Number.isFinite(cap)
      ? Math.min(DAILY_CAP_RANGE.max, Math.max(DAILY_CAP_RANGE.min, cap))
      : d.dailyCap,
  };
}

function minutesOf(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

/** True when local time `at` falls inside [start, end), wrapping midnight. */
export function inQuietHours(at: Date, q: NativeReminderSettings["quietHours"]): boolean {
  if (!q.enabled) return false;
  const s = minutesOf(q.start);
  const e = minutesOf(q.end);
  if (s === e) return false;
  const m = at.getHours() * 60 + at.getMinutes();
  return s < e ? m >= s && m < e : m >= s || m < e;
}

/** Stable positive 31-bit id, so re-planning replaces instead of duplicating. */
export function reminderId(kind: NativeReminderKind, at: Date): number {
  const key = `${kind}|${Math.floor(at.getTime() / 60_000)}`;
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 1 || 1;
}

export type ShiftType = "day" | "evening" | "night";

export function shiftTypeOf(startMin: number): ShiftType {
  const m = ((startMin % 1440) + 1440) % 1440;
  if (m >= 22 * 60 || m < 4 * 60) return "night";
  if (m >= 14 * 60) return "evening";
  return "day";
}

function hhmm(d: Date): string {
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const PRIORITY: Record<NativeReminderKind, number> = {
  "upcoming-shift": 1,
  bedtime: 2,
  "wind-down": 3,
  "shift-change": 4,
  recovery: 5,
};

const SHIFT_CHANGE_COPY: Record<ShiftType, string> = {
  night:
    "Sleep in this morning, take a 90-minute nap this afternoon, and keep caffeine for the first half of the shift.",
  evening: "Push your bedtime a little later tonight and get bright light late morning.",
  day: "Aim for an earlier bedtime tonight and get bright light soon after you wake.",
};

function candidatesFor(days: DayPlan[], s: NativeReminderSettings): Candidate[] {
  const out: Candidate[] = [];
  let prevType: ShiftType | null = null;
  for (const day of days) {
    const shift = day.shift;
    if (!shift) continue;
    const start = day.longClock.find((e) => e.kind === "shift-start")?.at;
    const recovery = day.longClock.find((e) => e.kind === "recovery")?.at;
    const label = shift.title?.trim() ? ` (${shift.title.trim().slice(0, 40)})` : "";
    const type = shiftTypeOf(shift.start);

    if (s.kinds["upcoming-shift"] && start) {
      out.push({
        kind: "upcoming-shift",
        at: new Date(start.getTime() - s.upcomingShiftLeadMin * 60_000),
        title: `Shift at ${hhmm(start)}${label}`,
        body:
          s.upcomingShiftLeadMin >= 60
            ? `Starts in ${s.upcomingShiftLeadMin / 60 === 1 ? "1 hour" : `${s.upcomingShiftLeadMin / 60} hours`}. Eat something light and get some bright light.`
            : `Starts in ${s.upcomingShiftLeadMin} minutes. Water, caffeine if you need it, and go.`,
        path: "/dashboard",
        deadline: start,
      });
    }
    if (s.kinds["wind-down"] && day.windDownAt) {
      out.push({
        kind: "wind-down",
        at: day.windDownAt,
        title: "Time to wind down",
        body: "Dim the lights, put screens away and keep it calm. Your sleep window opens soon.",
        path: "/plan",
      });
    }
    if (s.kinds.bedtime && day.sleep) {
      out.push({
        kind: "bedtime",
        at: day.sleep.start,
        title: "Bedtime",
        body: `Your sleep window is open until ${hhmm(day.sleep.end)}. Dark, cool and quiet.`,
        path: "/plan",
      });
    }
    if (s.kinds.recovery && recovery) {
      out.push({
        kind: "recovery",
        at: recovery,
        title: "Recovery time",
        body: "Water, some daylight and light movement help you reset before the next shift.",
        path: "/plan",
      });
    }
    if (s.kinds["shift-change"] && prevType && prevType !== type) {
      const eve = new Date(day.date);
      eve.setDate(eve.getDate() - 1);
      eve.setHours(12, 0, 0, 0);
      out.push({
        kind: "shift-change",
        at: eve,
        title: `Tomorrow: ${type} shift at ${start ? hhmm(start) : ""}`.trim(),
        body: SHIFT_CHANGE_COPY[type],
        path: "/plan",
        deadline: start ?? day.date,
      });
    }
    prevType = type;
  }
  return out;
}

type Candidate = Omit<PlannedReminder, "id"> & { deadline?: Date };

/**
 * Never wake someone inside a planned sleep window. A reminder that lands
 * strictly inside one is moved to the moment the window ends when that is
 * still before its deadline (the shift it is about), otherwise dropped.
 * Bedtime sits at a window's start and recovery at its end, so they stay.
 */
export function avoidSleep(c: Candidate, sleeps: Array<{ start: Date; end: Date }>): Candidate[] {
  const t = c.at.getTime();
  const w = sleeps.find((x) => t > x.start.getTime() && t < x.end.getTime());
  if (!w) return [c];
  if (
    (c.kind === "upcoming-shift" || c.kind === "shift-change") &&
    c.deadline &&
    w.end < c.deadline
  ) {
    return [{ ...c, at: new Date(w.end.getTime()) }];
  }
  return [];
}

/**
 * Quiet hours: an upcoming-shift or shift-change reminder that falls inside
 * them moves to the end of quiet hours when that is still before its shift;
 * everything else inside quiet hours is dropped later in the pipeline.
 */
export function avoidQuietHours(
  c: Candidate,
  q: NativeReminderSettings["quietHours"],
): Candidate[] {
  if (!inQuietHours(c.at, q)) return [c];
  if ((c.kind === "upcoming-shift" || c.kind === "shift-change") && c.deadline) {
    const end = new Date(c.at);
    const [h, m] = q.end.split(":").map(Number);
    end.setHours(h ?? 0, m ?? 0, 0, 0);
    if (end <= c.at) end.setDate(end.getDate() + 1);
    if (end < c.deadline) return [{ ...c, at: end }];
  }
  return [];
}

/**
 * The reminders that should be pending right now. Applies, in order:
 * the per-kind switches, the future-only window, quiet hours, dedupe
 * (same kind within 30 minutes), the daily cap (highest priority kept),
 * and the overall pending limit.
 */
export function planNativeReminders(args: {
  shifts: Shift[];
  prefs: Prefs;
  settings: NativeReminderSettings;
  now: Date;
  days?: number;
}): PlannedReminder[] {
  const settings = normalizeSettings(args.settings);
  if (!settings.enabled || !args.shifts.length) return [];
  const days = args.days ?? HORIZON_DAYS;
  // Start one day back: yesterday's late shift sets today's wind-down and
  // bedtime, and its pattern is the baseline for a shift change.
  const from = new Date(args.now);
  from.setDate(from.getDate() - 1);
  const plan = buildMultiDayPlan(args.shifts, args.prefs, from, days + 2);

  const lo = args.now.getTime() + 60_000;
  const hi = args.now.getTime() + days * 86_400_000;
  const sleeps = plan.flatMap((d) => (d.sleep ? [d.sleep] : []));
  const inWindow = candidatesFor(plan, settings)
    .flatMap((c) => avoidQuietHours(c, settings.quietHours))
    .flatMap((c) => avoidSleep(c, sleeps))
    .filter((c) => !Number.isNaN(c.at.getTime()) && c.at.getTime() >= lo && c.at.getTime() < hi)
    .filter((c) => !inQuietHours(c.at, settings.quietHours))
    .sort((a, b) => a.at.getTime() - b.at.getTime() || PRIORITY[a.kind] - PRIORITY[b.kind]);

  const deduped: typeof inWindow = [];
  for (const c of inWindow) {
    const clash = deduped.some(
      (k) => k.kind === c.kind && Math.abs(k.at.getTime() - c.at.getTime()) < DEDUPE_WINDOW_MS,
    );
    if (!clash) deduped.push(c);
  }

  const byDay = new Map<string, typeof deduped>();
  for (const c of deduped) {
    const k = dayKey(c.at);
    byDay.set(k, [...(byDay.get(k) ?? []), c]);
  }
  const capped: typeof deduped = [];
  for (const list of byDay.values()) {
    const keep = [...list]
      .sort((a, b) => PRIORITY[a.kind] - PRIORITY[b.kind] || a.at.getTime() - b.at.getTime())
      .slice(0, settings.dailyCap);
    capped.push(...keep);
  }

  return capped
    .sort((a, b) => a.at.getTime() - b.at.getTime())
    .slice(0, MAX_PENDING)
    .map(({ deadline: _deadline, ...c }) => ({ ...c, id: reminderId(c.kind, c.at) }));
}
