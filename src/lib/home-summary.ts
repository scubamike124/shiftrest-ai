// Home screen "Today" summary: the four answers a tired shift worker needs
// at a glance. All times come from the shared schedule engine
// (schedule-core.ts); this file only picks which shift, sleep window and
// reminder are "next", and keeps one-off "my shift ran late" changes.
//
// Dependency-free apart from schedule-core, so it runs under `node --test`.

import {
  applyShiftChange,
  buildReminders,
  buildSchedule,
  buildSleepPlan,
  ShiftChangeError,
  type PlannedReminderKind,
  type Schedule,
  type ScheduledShift,
  type ShiftChange,
  type SleepOpportunity,
  type SleepPrefs,
  type TemplateShift,
} from "./schedule-core.ts";

export type HomeSummaryInput = {
  shifts: TemplateShift[];
  prefs: SleepPrefs & { cycleAnchor?: string | null; cycleWeeks?: number };
  now: Date;
  tz: string;
  /** One-off changes saved from "My shift changed", oldest first. */
  overrides?: StoredOverride[];
};

export type HomeSummary = {
  /** Shift in progress right now, if any. */
  onShift: ScheduledShift | null;
  /** Next shift that has not started yet. */
  nextShift: ScheduledShift | null;
  /** Next sleep window that has not ended yet. */
  sleep: SleepOpportunity | null;
  /** Next reminder on the plan. */
  reminder: { kind: PlannedReminderKind; at: Date; label: string } | null;
  /**
   * Shifts "My shift changed" can apply to, most likely first: the shift in
   * progress; otherwise the next shift and a shift that just ended (ordered by
   * which is closer in time), so a back-to-back rotation never silently
   * targets yesterday's finished shift.
   */
  changeCandidates: ScheduledShift[];
  /** Kept for callers: the first change candidate. */
  changeTarget: ScheduledShift | null;
  /** Ids of shifts changed by a saved one-off override. */
  changedShiftIds: string[];
  /** Every applied one-off change, with the shift as originally scheduled (for Undo). */
  appliedChanges: { override: StoredOverride; original: ScheduledShift }[];
};

export const REMINDER_SHORT: Record<PlannedReminderKind, string> = {
  "wind-down": "Start winding down",
  "caffeine-cutoff": "Last caffeine",
  "bright-light": "Wake and get bright light",
  "shift-start": "Shift starts soon",
  "shift-end-recovery": "Shift ends: recovery",
};

/** A saved one-off change (dates as ISO strings so it can live in storage). */
export type StoredOverride =
  | { kind: "extend"; shiftId: string; endsAt: string; savedAt: string }
  | { kind: "cancel"; shiftId: string; savedAt: string };

const HOUR = 3_600_000;
/** "My shift changed" still targets a shift that ended this recently (late finish logged after clock-out). */
export const RECENT_END_MS = 12 * HOUR;

export function scheduleWithOverrides(input: HomeSummaryInput): {
  schedule: Schedule;
  changed: string[];
  applied: { override: StoredOverride; original: ScheduledShift }[];
} {
  let schedule = buildSchedule({
    shifts: input.shifts,
    tz: input.tz,
    from: input.now,
    days: 8,
    cycleAnchor: input.prefs.cycleAnchor ?? null,
    cycleWeeks: input.prefs.cycleWeeks ?? 1,
  });
  const changed: string[] = [];
  const applied: { override: StoredOverride; original: ScheduledShift }[] = [];
  for (const o of input.overrides ?? []) {
    const original = schedule.shifts.find((x) => x.id === o.shiftId);
    const change: ShiftChange =
      o.kind === "extend"
        ? { kind: "extend", shiftId: o.shiftId, endsAt: new Date(o.endsAt) }
        : { kind: "cancel", shiftId: o.shiftId };
    try {
      schedule = applyShiftChange(schedule, change, {
        prefs: input.prefs,
        now: input.now,
      }).schedule;
      changed.push(o.shiftId);
      if (original) applied.push({ override: o, original });
    } catch (e) {
      // A stale override (shift no longer in range, or already later) is ignored.
      if (!(e instanceof ShiftChangeError)) throw e;
    }
  }
  return { schedule, changed, applied };
}

export function computeHomeSummary(input: HomeSummaryInput): HomeSummary {
  const now = input.now.getTime();
  const { schedule, changed, applied } = scheduleWithOverrides(input);
  const shifts = schedule.shifts;
  const onShift =
    shifts.find((s) => s.startsAt.getTime() <= now && s.endsAt.getTime() > now) ?? null;
  const nextShift = shifts.find((s) => s.startsAt.getTime() > now) ?? null;
  const justEnded =
    [...shifts]
      .reverse()
      .find((s) => s.endsAt.getTime() <= now && now - s.endsAt.getTime() <= RECENT_END_MS) ?? null;
  const sleep =
    buildSleepPlan(schedule, input.prefs, input.now).find((p) => p.sleepEnd.getTime() > now) ??
    null;
  const r = buildReminders(schedule, input.prefs, input.now)[0];
  let changeCandidates: ScheduledShift[];
  if (onShift) changeCandidates = [onShift];
  else if (nextShift && justEnded) {
    const sinceEnd = now - justEnded.endsAt.getTime();
    const untilStart = nextShift.startsAt.getTime() - now;
    changeCandidates = untilStart <= sinceEnd ? [nextShift, justEnded] : [justEnded, nextShift];
  } else changeCandidates = [justEnded ?? nextShift].filter((x): x is ScheduledShift => !!x);
  return {
    onShift,
    nextShift,
    sleep,
    reminder: r ? { kind: r.kind, at: r.at, label: REMINDER_SHORT[r.kind] } : null,
    changeCandidates,
    changeTarget: changeCandidates[0] ?? null,
    changedShiftIds: changed,
    appliedChanges: applied,
  };
}

/** Validate and prune stored overrides: malformed entries dropped, old ones expire after 2 days. */
export function parseOverrides(raw: string | null | undefined, now: Date): StoredOverride[] {
  if (!raw) return [];
  let list: unknown;
  try {
    list = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(list)) return [];
  const out: StoredOverride[] = [];
  for (const v of list.slice(-20)) {
    if (!v || typeof v !== "object") continue;
    const o = v as Record<string, unknown>;
    const savedAt = typeof o.savedAt === "string" ? Date.parse(o.savedAt) : NaN;
    if (!Number.isFinite(savedAt) || now.getTime() - savedAt > 48 * HOUR) continue;
    if (typeof o.shiftId !== "string" || o.shiftId.length > 200) continue;
    if (
      o.kind === "extend" &&
      typeof o.endsAt === "string" &&
      Number.isFinite(Date.parse(o.endsAt))
    ) {
      out.push({
        kind: "extend",
        shiftId: o.shiftId,
        endsAt: o.endsAt,
        savedAt: o.savedAt as string,
      });
    } else if (o.kind === "cancel") {
      out.push({ kind: "cancel", shiftId: o.shiftId, savedAt: o.savedAt as string });
    }
  }
  return out;
}

export const OVERRIDES_KEY = "restpilot.shift-overrides.v1";
export const OVERRIDES_EVENT = "restpilot:shift-overrides";

export function overridesKey(userId: string | null | undefined): string {
  return userId ? `${OVERRIDES_KEY}:${userId}` : OVERRIDES_KEY;
}

export function readOverrides(
  userId: string | null | undefined,
  now = new Date(),
): StoredOverride[] {
  if (typeof window === "undefined") return [];
  try {
    return parseOverrides(window.localStorage.getItem(overridesKey(userId)), now);
  } catch {
    return [];
  }
}

/** Save a one-off change (replacing any earlier one for the same shift) and notify listeners. */
export function saveOverride(userId: string | null | undefined, o: StoredOverride): void {
  if (typeof window === "undefined") return;
  const next = [...readOverrides(userId).filter((x) => x.shiftId !== o.shiftId), o];
  try {
    window.localStorage.setItem(overridesKey(userId), JSON.stringify(next));
  } catch {
    /* storage unavailable: the change lasts for this visit */
  }
  window.dispatchEvent(new CustomEvent(OVERRIDES_EVENT, { detail: next }));
}

export function clearOverride(userId: string | null | undefined, shiftId: string): void {
  if (typeof window === "undefined") return;
  const next = readOverrides(userId).filter((x) => x.shiftId !== shiftId);
  try {
    window.localStorage.setItem(overridesKey(userId), JSON.stringify(next));
  } catch {
    /* noop */
  }
  window.dispatchEvent(new CustomEvent(OVERRIDES_EVENT, { detail: next }));
}

/** The user's IANA time zone (falls back to UTC). */
export function deviceTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}
