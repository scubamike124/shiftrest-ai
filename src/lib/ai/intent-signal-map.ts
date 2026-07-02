/**
 * Static ranking table: which PERSONAL SIGNAL categories matter most for
 * each intent tag. Consumed by formatSignalsBlock() to prepend a ranked
 * header so the model reasons across the right 1–2 signals instead of
 * grabbing whichever line comes first.
 *
 * Categories are inferred from the line prefixes produced by
 * fetchPersonalSignals(). Kept intentionally small — this is a nudge for
 * the model, not a hard filter. Every raw signal line is still passed
 * through so the model has full context.
 */
import type { IntentHint } from "./intent-hint.server";

export type SignalCategory =
  | "clock"          // "Local time: ..."
  | "goal"           // "Sleep goal: ... h; wind-down ..."
  | "last_night"     // "Last sleep: ..."
  | "debt"           // "N-night sleep debt: ..." or "sleep balance"
  | "hrv"            // "HRV last night: ..."
  | "rhr"            // "Resting HR last night: ..."
  | "current_shift"  // "Currently on shift ..."
  | "next_shift"     // "Next shift: ..."
  | "work_streak"    // "On day N of consecutive work-days."
  | "day_off"        // "Tomorrow is a day off." / "Next day off: ..."
  | "trend"          // "7-night trend: ..."
  | "goal_streak"    // "Sleep-goal streak: ..." / "Hit sleep goal ..."
  | "alarm";         // "Next alarm: ..."

/** Human labels used only inside the ranked header. */
export const CATEGORY_LABELS: Record<SignalCategory, string> = {
  clock: "current local time",
  goal: "target bedtime / wind-down",
  last_night: "last night's sleep",
  debt: "sleep debt",
  hrv: "HRV trend",
  rhr: "resting HR trend",
  current_shift: "current shift",
  next_shift: "next shift",
  work_streak: "consecutive work-days",
  day_off: "next day off",
  trend: "7-night bedtime trend",
  goal_streak: "sleep-goal streak",
  alarm: "next alarm",
};

type Ranking = {
  primary: SignalCategory[];
  secondary: SignalCategory[];
};

/**
 * Which signals are PRIMARY vs SECONDARY for each intent. Anything the
 * signals block emits that isn't listed here is still passed to the model
 * as raw context — just not called out in the ranked header.
 */
export const INTENT_SIGNAL_MAP: Record<Exclude<IntentHint, "general">, Ranking> = {
  caffeine: {
    primary: ["clock", "goal"],
    secondary: ["next_shift", "hrv", "debt"],
  },
  sleep: {
    primary: ["goal", "last_night"],
    secondary: ["debt", "next_shift", "hrv"],
  },
  recovery: {
    primary: ["hrv", "rhr"],
    secondary: ["work_streak", "day_off", "goal_streak", "last_night"],
  },
  shift: {
    primary: ["current_shift", "next_shift"],
    secondary: ["work_streak", "day_off", "goal", "alarm"],
  },
  wind_down: {
    primary: ["goal", "clock"],
    secondary: ["next_shift", "last_night", "alarm"],
  },
  nap: {
    primary: ["clock", "next_shift"],
    secondary: ["debt", "last_night"],
  },
};

/**
 * Bucket a raw signal line (as emitted by fetchPersonalSignals) into one
 * of the SignalCategory enums. Returns null when the line doesn't match
 * any known category — future signals just fall through gracefully.
 */
export function categorizeSignal(line: string): SignalCategory | null {
  const l = line.trim();
  if (l.startsWith("Local time:")) return "clock";
  if (l.startsWith("Sleep goal:")) return "goal";
  if (l.startsWith("Last sleep:")) return "last_night";
  if (l.includes("sleep debt:") || l.includes("sleep balance:")) return "debt";
  if (l.startsWith("HRV last night:")) return "hrv";
  if (l.startsWith("Resting HR last night:")) return "rhr";
  if (l.startsWith("Currently on shift")) return "current_shift";
  if (l.startsWith("Next shift:")) return "next_shift";
  if (l.startsWith("On day ") && l.includes("consecutive work-days")) return "work_streak";
  if (l.startsWith("Tomorrow is a day off") || l.startsWith("Next day off:")) return "day_off";
  if (l.startsWith("7-night trend:")) return "trend";
  if (l.startsWith("Sleep-goal streak:") || l.startsWith("Hit sleep goal ")) return "goal_streak";
  if (l.startsWith("Next alarm:")) return "alarm";
  return null;
}
