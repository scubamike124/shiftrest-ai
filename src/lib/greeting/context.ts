/**
 * Contextual greeting engine — pure, no I/O.
 * Produces one short human sub-line under the "Good evening, Joe" salutation.
 * Rule priority: shift-soon > poor recovery > sleep debt > bedtime nudge > neutral.
 * Deliberately never more than one clause. See Batch B plan.
 */
import { getDayPart } from "@/lib/time/day-part";

export type GreetingContext = {
  now: Date;
  /** Start of the very next shift (any day). Optional. */
  nextShiftStart?: Date | null;
  /** Circadian debt score 0..100 (higher = worse). */
  debtScore?: number | null;
  /** Recovery/stability score 0..100 (higher = better). */
  recoveryScore?: number | null;
  /** Target bedtime tonight (Date). */
  recommendedBedtime?: Date | null;
};

function hoursUntil(a: Date, b: Date): number {
  return (b.getTime() - a.getTime()) / 3_600_000;
}

function fmtTime(d: Date): string {
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

/**
 * One-sentence contextual sub-line. Empty string when nothing meaningful
 * to add — caller should render a neutral fallback in that case.
 */
export function buildGreetingLine(ctx: GreetingContext): string {
  const { now, nextShiftStart, debtScore, recoveryScore, recommendedBedtime } = ctx;
  const part = getDayPart(now);

  // 1. Imminent shift (< 12h)
  if (nextShiftStart) {
    const h = hoursUntil(now, nextShiftStart);
    if (h > 0 && h <= 12) {
      const isEarly = nextShiftStart.getHours() < 8;
      if (h <= 2) return `Shift starts at ${fmtTime(nextShiftStart)} — let's get you ready.`;
      if (part === "evening" || part === "night") {
        return isEarly
          ? `Early shift tomorrow at ${fmtTime(nextShiftStart)} — I'd like to get you to bed a little earlier.`
          : `Shift tomorrow at ${fmtTime(nextShiftStart)} — plan a solid wind-down tonight.`;
      }
      return `Next shift ${fmtTime(nextShiftStart)} — a short reset would help.`;
    }
  }

  // 2. Poor recovery
  if (typeof recoveryScore === "number" && recoveryScore < 45) {
    return "Recovery looks low today — go gentle and protect your sleep window.";
  }

  // 3. Sleep debt
  if (typeof debtScore === "number" && debtScore >= 55) {
    return "You're carrying some sleep debt — one solid night makes a real dent.";
  }

  // 4. Bedtime nudge in evening/night
  if ((part === "evening" || part === "night") && recommendedBedtime) {
    return `Aiming for lights out around ${fmtTime(recommendedBedtime)} tonight.`;
  }

  // 5. Positive affirmations
  if (typeof recoveryScore === "number" && recoveryScore >= 75) {
    return "You've recovered well — good day to build a healthy habit.";
  }

  // 6. Neutral by day-part
  if (part === "morning") return "Let's set up an energised day.";
  if (part === "afternoon") return "A short break now pays off tonight.";
  if (part === "evening") return "Your sleep coach is one tap away.";
  return "I'll keep the lights low. Ready when you are.";
}
