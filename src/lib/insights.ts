// Advanced circadian planning engine — Upgrade 1 of pre-launch roadmap.
//
// Forecast horizon: 14 days. Backward-compatible: `fatigueForecast` still
// exposes the first 3 days so existing dashboard widgets keep rendering.
// New `fatigueHorizon` is the full 14-day curve.
//
// Personalization signals folded in:
//   - 7-day rolling sleep debt vs `prefs.sleepHours`
//   - Recovery half-life between consecutive shifts (8h half-life)
//   - Backward-rotation penalty that scales with streak length
//   - Wearable grounding when present (sleep duration, efficiency, HRV trend)
//
// Pure functions only — no network. Feeds dashboard, /plan, AI brief, coach.

import { DAYS, type Shift, endAbsolute } from "./shifts";
import type { Employer } from "./employers";
import { circadianDebt, detectRotation } from "./sleep-engine";
import { shiftsForDate } from "./schedule";
import type { Prefs } from "./prefs";

export type FatiguePoint = {
  dayIndex: number; // 0=Mon (legacy: weekday of forecast point)
  /** Absolute offset from "today" in days (0=today, 1=tomorrow…). */
  dayOffset: number;
  label: string;
  /** 0-100, higher = more fatigued */
  score: number;
  band: "low" | "moderate" | "high" | "extreme";
  reason: string;
};

export type Insights = {
  fatigueToday: FatiguePoint;
  /** Legacy 3-day window (today + next 2). Kept for older widgets. */
  fatigueForecast: FatiguePoint[];
  /** New 14-day fatigue horizon (today + next 13). */
  fatigueHorizon: FatiguePoint[];
  recoveryScore: number; // 0-100, higher = better recovered
  recoveryBand: "depleted" | "rebuilding" | "steady" | "peak";
  /** Rolling 7-day sleep debt in hours (positive = under target). */
  sleepDebtHours: number;
  /** HRV trend vs 7-day baseline as a fraction, e.g. -0.08 = 8% below. Null when no wearable data. */
  hrvTrend: number | null;
  signals: string[];
  rotation: string;
  todayShift?: Shift;
  nextShift?: { shift: Shift; hoursAway: number };
  contextString: string;
};

export type LastNightSummary = {
  provider: "fitbit" | "oura";
  date: string;
  sleepDurationMin: number | null;
  sleepEfficiency: number | null;
  hrvMs: number | null;
  restingHr: number | null;
};

/** Up to 14 nights of wearable data, newest first or any order — engine sorts. */
export type WearableHistory = LastNightSummary[];

function bandFor(score: number): FatiguePoint["band"] {
  if (score >= 75) return "extreme";
  if (score >= 55) return "high";
  if (score >= 30) return "moderate";
  return "low";
}

function shiftType(s: Shift): "day" | "evening" | "night" {
  if (s.start >= 22 * 60 || s.start < 4 * 60) return "night";
  if (s.start < 12 * 60) return "day";
  return "evening";
}

function shiftLengthHours(s: Shift): number {
  return (endAbsolute(s) - s.start) / 60;
}

/** Detect a run of consecutive backward-rotating transitions ending at `date`. */
function backwardStreakEndingAt(
  shifts: Shift[],
  date: Date,
  anchor: string | null,
  cycleWeeks: number,
): number {
  const order = ["day", "evening", "night"];
  let streak = 0;
  for (let back = 0; back < 6; back++) {
    const a = shiftsForDate(shifts, addDays(date, -back - 1), anchor, cycleWeeks)[0];
    const b = shiftsForDate(shifts, addDays(date, -back), anchor, cycleWeeks)[0];
    if (!a || !b) break;
    if (order.indexOf(shiftType(b)) < order.indexOf(shiftType(a))) streak++;
    else break;
  }
  return streak;
}

function addDays(d: Date, n: number): Date {
  const out = new Date(d);
  out.setDate(out.getDate() + n);
  return out;
}

/**
 * Per-day fatigue score. Uses an absolute `date` so that multi-week rotations
 * (cycleWeeks > 1) resolve to the correct week's shift. Falls back to the
 * legacy weekly behavior when cycleWeeks === 1.
 */
function dayFatigue(
  shifts: Shift[],
  date: Date,
  dayOffset: number,
  prefs: Prefs,
  ctx: {
    sleepDebtHours: number;
    hrvTrend: number | null;
    lastNightDeficit: number | null; // hours under target last night
    lastEfficiency: number | null; // 0..1
  },
): FatiguePoint {
  const anchor = prefs.cycleAnchor;
  const cw = prefs.cycleWeeks ?? 1;
  const weekdayIdx = (date.getDay() + 6) % 7;
  const todayShift = shiftsForDate(shifts, date, anchor, cw)[0];
  let score = 0;
  let reason = "Recovery day";

  // ── Carry-over from previous 2 days with exponential decay
  for (let back = 1; back <= 2; back++) {
    const prev = shiftsForDate(shifts, addDays(date, -back), anchor, cw)[0];
    if (!prev) continue;
    const decay = back === 1 ? 0.6 : 0.3;
    const base =
      shiftType(prev) === "night" ? 35 : shiftType(prev) === "evening" ? 18 : 10;
    score += base * decay;
    if (shiftLengthHours(prev) > 10) score += 6 * decay;
  }

  if (todayShift) {
    const kind = shiftType(todayShift);
    const len = shiftLengthHours(todayShift);
    if (kind === "night") {
      score += 45;
      reason = `Working overnight (${Math.round(len)}h)`;
    } else if (kind === "evening") {
      score += 22;
      reason = `Evening shift (${Math.round(len)}h)`;
    } else {
      score += 12;
      reason = `Day shift (${Math.round(len)}h)`;
    }
    if (len > 10) score += 8;

    const prev = shiftsForDate(shifts, addDays(date, -1), anchor, cw)[0];
    if (prev) {
      const gap = todayShift.start + 1440 - endAbsolute(prev);
      if (gap < 11 * 60) {
        score += 14;
        reason += " · short turnaround";
      }
    }

    const streak = backwardStreakEndingAt(shifts, date, anchor, cw);
    if (streak > 0) {
      const penalty = Math.min(18, 6 * streak);
      score += penalty;
      reason += ` · backward rotation x${streak}`;
    }
  } else {
    const prev = shiftsForDate(shifts, addDays(date, -1), anchor, cw)[0];
    const next = shiftsForDate(shifts, addDays(date, 1), anchor, cw)[0];
    if (!prev && !next) {
      score = Math.max(0, score - 12);
      reason = "Full rest day";
    } else {
      reason = "Off day — protect this sleep";
    }
  }

  // ── Personalization layer
  if (prefs.sleepHours < 7) score += 4;

  if (ctx.sleepDebtHours > 1) {
    const add = Math.min(14, Math.round(ctx.sleepDebtHours * 2));
    score += add;
    if (add >= 6) reason += ` · sleep debt ${ctx.sleepDebtHours.toFixed(1)}h`;
  }

  if (dayOffset === 0) {
    if (ctx.lastNightDeficit != null && ctx.lastNightDeficit > 1) {
      score += Math.min(10, Math.round(ctx.lastNightDeficit * 3));
      reason += ` · short night (${ctx.lastNightDeficit.toFixed(1)}h under)`;
    }
    if (ctx.lastEfficiency != null && ctx.lastEfficiency < 0.8) {
      score += 6;
      reason += " · low sleep efficiency";
    }
    if (ctx.hrvTrend != null && ctx.hrvTrend < -0.07) {
      score += 6;
      reason += ` · HRV ${Math.round(ctx.hrvTrend * 100)}% vs baseline`;
    } else if (ctx.hrvTrend != null && ctx.hrvTrend > 0.07) {
      score = Math.max(0, score - 4);
    }
  }

  if (dayOffset >= 3) {
    const fade = Math.min(0.25, (dayOffset - 2) * 0.04);
    score = Math.round(score * (1 - fade));
  }

  score = Math.max(0, Math.min(100, Math.round(score)));
  return {
    dayIndex: weekdayIdx,
    dayOffset,
    label: DAYS[weekdayIdx],
    score,
    band: bandFor(score),
    reason,
  };
}

/** Compute 7-day rolling sleep debt in hours vs prefs.sleepHours. */
function computeSleepDebt(history: WearableHistory, target: number): number {
  if (!history.length) return 0;
  const sorted = [...history]
    .filter((r) => r.sleepDurationMin != null)
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 7);
  if (!sorted.length) return 0;
  const debt = sorted.reduce(
    (acc, r) => acc + Math.max(0, target - (r.sleepDurationMin ?? 0) / 60),
    0,
  );
  return Math.round(debt * 10) / 10;
}

/** HRV trend = (last 3 nights mean − prior 4 nights mean) / baseline. */
function computeHrvTrend(history: WearableHistory): number | null {
  const sorted = [...history]
    .filter((r) => r.hrvMs != null)
    .sort((a, b) => b.date.localeCompare(a.date));
  if (sorted.length < 4) return null;
  const recent = sorted.slice(0, 3).map((r) => r.hrvMs as number);
  const prior = sorted.slice(3, 7).map((r) => r.hrvMs as number);
  if (!prior.length) return null;
  const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length;
  const baseline = mean(prior);
  if (baseline <= 0) return null;
  return Math.round(((mean(recent) - baseline) / baseline) * 100) / 100;
}

export function computeInsights(
  shifts: Shift[],
  prefs: Prefs,
  now: Date,
  employers: Employer[] = [],
  lastNight: LastNightSummary | null = null,
  wearableHistory: WearableHistory = [],
): Insights {
  const weekdayToday = (now.getDay() + 6) % 7;

  // Aggregate personalization signals once
  const history: WearableHistory =
    wearableHistory.length || !lastNight ? wearableHistory : [lastNight];
  const sleepDebtHours = computeSleepDebt(history, prefs.sleepHours);
  const hrvTrend = computeHrvTrend(history);
  const lastNightDeficit =
    lastNight?.sleepDurationMin != null
      ? Math.max(0, prefs.sleepHours - lastNight.sleepDurationMin / 60)
      : null;
  const lastEfficiency = lastNight?.sleepEfficiency ?? null;
  const personalCtx = { sleepDebtHours, hrvTrend, lastNightDeficit, lastEfficiency };

  // ── 14-day horizon
  const fatigueHorizon: FatiguePoint[] = Array.from({ length: 14 }, (_, offset) =>
    dayFatigue(shifts, (weekdayToday + offset) % 7, offset, prefs, personalCtx),
  );
  const fatigueToday = fatigueHorizon[0];
  const fatigueForecast = fatigueHorizon.slice(0, 3);

  const employerById = new Map(employers.map((e) => [e.id, e]));
  const employerLabel = (s: Shift) =>
    s.employerId ? employerById.get(s.employerId)?.name : undefined;

  // ── Recovery score (weighted blend, 0-100)
  const debt = circadianDebt(shifts);
  let recovery = 100 - debt.score * 0.45 - fatigueToday.score * 0.35;
  recovery -= Math.min(15, sleepDebtHours * 2.5); // 1.5h debt ≈ -3.75 pts
  if (lastEfficiency != null) recovery += (lastEfficiency - 0.85) * 30;
  if (hrvTrend != null) recovery += hrvTrend * 40; // +/- 4 pts per 10% trend
  const recoveryScore = Math.max(0, Math.min(100, Math.round(recovery)));
  const recoveryBand: Insights["recoveryBand"] =
    recoveryScore >= 80
      ? "peak"
      : recoveryScore >= 60
        ? "steady"
        : recoveryScore >= 35
          ? "rebuilding"
          : "depleted";

  const rotation = detectRotation(shifts).label;

  // ── Signals (dashboard bullets + coach grounding)
  const signals: string[] = [];
  const nightCount = shifts.filter((s) => shiftType(s) === "night").length;
  if (nightCount >= 3) signals.push(`${nightCount} night shifts this week`);
  if (debt.reasons.length) signals.push(...debt.reasons.slice(0, 3));
  if (!shifts.find((s) => s.day === weekdayToday)) signals.push("No shift today");
  if (sleepDebtHours >= 3)
    signals.push(`Sleep debt ${sleepDebtHours.toFixed(1)}h over last 7 nights`);
  if (hrvTrend != null && Math.abs(hrvTrend) >= 0.07)
    signals.push(
      `HRV trend ${hrvTrend > 0 ? "+" : ""}${Math.round(hrvTrend * 100)}% vs baseline`,
    );

  // Heavy stretch detection in the 14-day curve
  const heavyStretch = fatigueHorizon.reduce<{ start: number; len: number } | null>(
    (acc, p, i, arr) => {
      if (p.score < 55) return acc;
      const len = (() => {
        let k = 0;
        while (i + k < arr.length && arr[i + k].score >= 55) k++;
        return k;
      })();
      if (!acc || len > acc.len) return { start: i, len };
      return acc;
    },
    null,
  );
  if (heavyStretch && heavyStretch.len >= 3) {
    signals.push(
      `Heavy stretch: ${heavyStretch.len} hard days starting ${
        heavyStretch.start === 0 ? "today" : `in ${heavyStretch.start}d`
      }`,
    );
  }

  // Multi-employer signals
  const employersThisWeek = new Set(
    shifts.map((s) => s.employerId).filter(Boolean) as string[],
  );
  if (employersThisWeek.size > 1) {
    const names = Array.from(employersThisWeek)
      .map((id) => employerById.get(id)?.name)
      .filter(Boolean);
    signals.push(`Working ${employersThisWeek.size} employers: ${names.join(", ")}`);
    for (let d = 0; d < 7; d++) {
      const a = shifts.find((s) => s.day === d);
      const b = shifts.find((s) => s.day === (d + 1) % 7);
      if (a && b && a.employerId && b.employerId && a.employerId !== b.employerId) {
        const gap = b.start + 1440 - endAbsolute(a);
        if (gap < 14 * 60) {
          signals.push(
            `${employerById.get(a.employerId)?.name ?? "Job A"} → ${
              employerById.get(b.employerId)?.name ?? "Job B"
            } on ${DAYS[(d + 1) % 7]} (short gap)`,
          );
          break;
        }
      }
    }
  }

  // Next upcoming shift within 7 days
  let nextShift: Insights["nextShift"];
  for (let offset = 0; offset < 7; offset++) {
    const idx = (weekdayToday + offset) % 7;
    const s = shifts.find((x) => x.day === idx);
    if (!s) continue;
    if (offset === 0 && now.getHours() * 60 + now.getMinutes() > s.start) continue;
    const hoursAway =
      offset * 24 + (s.start - (now.getHours() * 60 + now.getMinutes())) / 60;
    nextShift = { shift: s, hoursAway: Math.max(0, Math.round(hoursAway)) };
    break;
  }

  const todayShift = shifts.find((s) => s.day === weekdayToday);
  const fmtHM = (m: number) =>
    `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

  // ── Compact coach grounding (now quotes real personalization numbers)
  const horizonDigest = fatigueHorizon
    .slice(0, 7)
    .map((p) => p.score)
    .join("/");
  const contextString = [
    `Today is ${DAYS[weekdayToday]}.`,
    todayShift
      ? `On shift ${fmtHM(todayShift.start)}–${fmtHM(todayShift.end)} (${shiftType(
          todayShift,
        )})${employerLabel(todayShift) ? ` at ${employerLabel(todayShift)}` : ""}${
          todayShift.title ? ` — ${todayShift.title}` : ""
        }.`
      : "No shift today.",
    nextShift
      ? `Next shift in ~${nextShift.hoursAway}h: ${DAYS[nextShift.shift.day]} ${fmtHM(
          nextShift.shift.start,
        )}–${fmtHM(nextShift.shift.end)}${
          employerLabel(nextShift.shift) ? ` at ${employerLabel(nextShift.shift)}` : ""
        }.`
      : "",
    `Rotation pattern: ${rotation}.`,
    `Fatigue today ${fatigueToday.score}/100 (${fatigueToday.band}).`,
    `14-day fatigue curve (next 7): ${horizonDigest}.`,
    `Recovery score ${recoveryScore}/100 (${recoveryBand}).`,
    sleepDebtHours >= 1
      ? `Rolling 7-day sleep debt: ${sleepDebtHours.toFixed(1)}h.`
      : "",
    hrvTrend != null
      ? `HRV trend vs baseline: ${hrvTrend > 0 ? "+" : ""}${Math.round(hrvTrend * 100)}%.`
      : "",
    employers.length > 1
      ? `Employers (${employers.length}): ${employers.map((e) => e.name).join(", ")}.`
      : "",
    signals.length ? `Signals: ${signals.join("; ")}.` : "",
    `Sleep target ${prefs.sleepHours}h, wind-down ${prefs.windDownMin}min.`,
    lastNight && lastNight.sleepDurationMin
      ? `Last night (${lastNight.provider}, ${lastNight.date}): slept ${(
          lastNight.sleepDurationMin / 60
        ).toFixed(1)}h${
          lastNight.sleepEfficiency != null
            ? ` at ${Math.round(lastNight.sleepEfficiency * 100)}% efficiency`
            : ""
        }${lastNight.hrvMs != null ? `, HRV ${Math.round(lastNight.hrvMs)}ms` : ""}${
          lastNight.restingHr != null ? `, resting HR ${lastNight.restingHr}bpm` : ""
        }.`
      : "",
  ]
    .filter(Boolean)
    .join(" ");

  return {
    fatigueToday,
    fatigueForecast,
    fatigueHorizon,
    recoveryScore,
    recoveryBand,
    sleepDebtHours,
    hrvTrend,
    signals,
    rotation,
    todayShift,
    nextShift,
    contextString,
  };
}
