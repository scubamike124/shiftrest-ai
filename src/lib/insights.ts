// Deterministic AI-adjacent analytics: fatigue (today + 3 days), recovery score,
// and contextual signals. No network calls — feeds both the dashboard cards
// and the AI coach as grounding context.

import { DAYS, type Shift, endAbsolute } from "./shifts";
import type { Employer } from "./employers";
import { circadianDebt, detectRotation } from "./sleep-engine";
import type { Prefs } from "./prefs";

export type FatiguePoint = {
  dayIndex: number; // 0=Mon
  label: string;
  /** 0-100, higher = more fatigued */
  score: number;
  band: "low" | "moderate" | "high" | "extreme";
  reason: string;
};

export type Insights = {
  fatigueToday: FatiguePoint;
  fatigueForecast: FatiguePoint[]; // next 3 days (incl today at index 0)
  recoveryScore: number; // 0-100, higher = better recovered
  recoveryBand: "depleted" | "rebuilding" | "steady" | "peak";
  signals: string[]; // bullet strings ("Short turnaround Tue→Wed", "3 nights this week", …)
  rotation: string;
  todayShift?: Shift;
  nextShift?: { shift: Shift; hoursAway: number };
  // Compact text the AI coach uses as grounding ("today is Wed; on shift 23:00-07:00; …")
  contextString: string;
};

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

/** Compute a per-day fatigue score using cumulative recent load + shift kind. */
function dayFatigue(shifts: Shift[], dayIdx: number, prefs: Prefs): FatiguePoint {
  const todayShift = shifts.find((s) => s.day === dayIdx);
  let score = 0;
  let reason = "Recovery day";

  // Carry-over from previous 2 days
  for (let back = 1; back <= 2; back++) {
    const idx = (dayIdx - back + 7) % 7;
    const prev = shifts.find((s) => s.day === idx);
    if (!prev) continue;
    const decay = back === 1 ? 0.6 : 0.3;
    const base =
      shiftType(prev) === "night" ? 35 : shiftType(prev) === "evening" ? 18 : 10;
    score += base * decay;
    const len = endAbsolute(prev) - prev.start;
    if (len > 10 * 60) score += 6 * decay;
  }

  if (todayShift) {
    const kind = shiftType(todayShift);
    const len = endAbsolute(todayShift) - todayShift.start;
    if (kind === "night") {
      score += 45;
      reason = `Working overnight (${Math.round(len / 60)}h)`;
    } else if (kind === "evening") {
      score += 22;
      reason = `Evening shift (${Math.round(len / 60)}h)`;
    } else {
      score += 12;
      reason = `Day shift (${Math.round(len / 60)}h)`;
    }
    if (len > 10 * 60) score += 8;

    // Short turnaround from previous shift
    const prev = shifts.find((s) => s.day === (dayIdx - 1 + 7) % 7);
    if (prev) {
      const gap = todayShift.start + 1440 - endAbsolute(prev);
      if (gap < 11 * 60) {
        score += 14;
        reason += " · short turnaround";
      }
    }
  } else {
    // Day off — bonus recovery if sandwiched between off days
    const prev = shifts.find((s) => s.day === (dayIdx - 1 + 7) % 7);
    const next = shifts.find((s) => s.day === (dayIdx + 1) % 7);
    if (!prev && !next) {
      score = Math.max(0, score - 12);
      reason = "Full rest day";
    } else {
      reason = "Off day — protect this sleep";
    }
  }

  // Light personalisation: under-target sleep amplifies
  if (prefs.sleepHours < 7) score += 4;

  score = Math.max(0, Math.min(100, Math.round(score)));
  return {
    dayIndex: dayIdx,
    label: DAYS[dayIdx],
    score,
    band: bandFor(score),
    reason,
  };
}

export function computeInsights(
  shifts: Shift[],
  prefs: Prefs,
  now: Date,
  employers: Employer[] = [],
): Insights {
  const weekday = (now.getDay() + 6) % 7;
  const fatigueToday = dayFatigue(shifts, weekday, prefs);
  const fatigueForecast: FatiguePoint[] = [0, 1, 2].map((offset) =>
    dayFatigue(shifts, (weekday + offset) % 7, prefs),
  );

  const employerById = new Map(employers.map((e) => [e.id, e]));
  const employerLabel = (s: Shift) =>
    s.employerId ? employerById.get(s.employerId)?.name : undefined;

  // Recovery = inverse of circadian debt, weighted by today's fatigue.
  const debt = circadianDebt(shifts);
  const recoveryScore = Math.max(
    0,
    Math.min(100, Math.round(100 - debt.score * 0.6 - fatigueToday.score * 0.4)),
  );
  const recoveryBand: Insights["recoveryBand"] =
    recoveryScore >= 80
      ? "peak"
      : recoveryScore >= 60
      ? "steady"
      : recoveryScore >= 35
      ? "rebuilding"
      : "depleted";

  const rotation = detectRotation(shifts).label;

  const signals: string[] = [];
  const nightCount = shifts.filter((s) => shiftType(s) === "night").length;
  if (nightCount >= 3) signals.push(`${nightCount} night shifts this week`);
  if (debt.reasons.length) signals.push(...debt.reasons.slice(0, 3));
  if (!shifts.find((s) => s.day === weekday)) signals.push("No shift today");

  // Multi-employer signals: e.g. "Working 2 employers this week" or
  // "Stacking St. Mary's overnight → Urgent Care evening on Wed".
  const employersThisWeek = new Set(
    shifts.map((s) => s.employerId).filter(Boolean) as string[],
  );
  if (employersThisWeek.size > 1) {
    const names = Array.from(employersThisWeek)
      .map((id) => employerById.get(id)?.name)
      .filter(Boolean);
    signals.push(`Working ${employersThisWeek.size} employers: ${names.join(", ")}`);
    // Same-day double-up (different employer back-to-back across 24h)
    for (let d = 0; d < 7; d++) {
      const a = shifts.find((s) => s.day === d);
      const b = shifts.find((s) => s.day === (d + 1) % 7);
      if (a && b && a.employerId && b.employerId && a.employerId !== b.employerId) {
        const gap = b.start + 1440 - endAbsolute(a);
        if (gap < 14 * 60) {
          signals.push(
            `${employerById.get(a.employerId)?.name ?? "Job A"} → ${employerById.get(b.employerId)?.name ?? "Job B"} on ${DAYS[(d + 1) % 7]} (short gap)`,
          );
          break;
        }
      }
    }
  }

  // Find next upcoming shift in next 72h
  let nextShift: Insights["nextShift"];
  for (let offset = 0; offset < 7; offset++) {
    const idx = (weekday + offset) % 7;
    const s = shifts.find((x) => x.day === idx);
    if (!s) continue;
    if (offset === 0 && now.getHours() * 60 + now.getMinutes() > s.start) continue;
    const hoursAway =
      offset * 24 + (s.start - (now.getHours() * 60 + now.getMinutes())) / 60;
    nextShift = { shift: s, hoursAway: Math.max(0, Math.round(hoursAway)) };
    break;
  }

  const todayShift = shifts.find((s) => s.day === weekday);
  const fmtHM = (m: number) =>
    `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

  const contextString = [
    `Today is ${DAYS[weekday]}.`,
    todayShift
      ? `On shift ${fmtHM(todayShift.start)}–${fmtHM(todayShift.end)} (${shiftType(todayShift)})${
          employerLabel(todayShift) ? ` at ${employerLabel(todayShift)}` : ""
        }${todayShift.title ? ` — ${todayShift.title}` : ""}.`
      : "No shift today.",
    nextShift
      ? `Next shift in ~${nextShift.hoursAway}h: ${DAYS[nextShift.shift.day]} ${fmtHM(nextShift.shift.start)}–${fmtHM(nextShift.shift.end)}${
          employerLabel(nextShift.shift) ? ` at ${employerLabel(nextShift.shift)}` : ""
        }.`
      : "",
    `Rotation pattern: ${rotation}.`,
    `Fatigue today ${fatigueToday.score}/100 (${fatigueToday.band}); next 2 days ${fatigueForecast[1].score}, ${fatigueForecast[2].score}.`,
    `Recovery score ${recoveryScore}/100 (${recoveryBand}).`,
    employers.length > 1
      ? `Employers (${employers.length}): ${employers.map((e) => e.name).join(", ")}.`
      : "",
    signals.length ? `Signals: ${signals.join("; ")}.` : "",
    `Sleep target ${prefs.sleepHours}h, wind-down ${prefs.windDownMin}min.`,
  ]
    .filter(Boolean)
    .join(" ");

  return {
    fatigueToday,
    fatigueForecast,
    recoveryScore,
    recoveryBand,
    signals,
    rotation,
    todayShift,
    nextShift,
    contextString,
  };
}
