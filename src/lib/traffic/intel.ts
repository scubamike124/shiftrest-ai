// Slice 12 — Step 3 (Traffic Intelligence). Pure module.
// Turns raw routing results + a learned baseline into semantic alerts with
// practical suggestions. No IO. Safe to unit-test and import anywhere.

export type TrafficSeverity = "info" | "warn" | "critical";

export type TrafficAlertId =
  | "leave_earlier"
  | "heavy_congestion"
  | "unusual_delay"
  | "alternative_route"
  | "clear_run"
  | "long_drive"
  | "evening_return";

export interface TrafficAlert {
  id: TrafficAlertId;
  severity: TrafficSeverity;
  /** Headline (≤ 60 chars). */
  title: string;
  /** One-sentence practical suggestion. */
  suggestion: string;
  icon: "Car" | "AlertTriangle" | "Route" | "Clock" | "TrendingUp" | "CheckCircle2";
  periods: ReadonlyArray<"morning" | "afternoon" | "evening">;
}

export interface RouteSnapshot {
  /** Routing duration in minutes (no-traffic estimate from OSRM). */
  primaryMin: number;
  /** Best alternative duration if shorter than primary. */
  alternativeMin: number | null;
  /** Distance in km (informational). */
  distanceKm: number;
}

export interface TrafficIntelInput {
  destinationKind: "home" | "work" | "custom";
  destinationLabel: string;
  /** User's previously learned baseline (minutes). Null when first run. */
  baselineMin: number | null;
  /** Fresh routing snapshot. */
  current: RouteSnapshot;
}

const DELAY_ABS_MIN = 5; // ignore noise below 5 minutes
const DELAY_PCT_WARN = 0.2; // 20% over baseline = unusual delay
const DELAY_PCT_CRIT = 0.5; // 50% over baseline = heavy congestion
const ALT_SAVINGS_MIN = 4; // alternative must save ≥4 min to surface
const LONG_DRIVE_MIN = 45;

/**
 * Derive a deduped, severity-sorted list of traffic alerts. Returns an empty
 * array when there's nothing actionable — callers should hide the card on
 * empty.
 */
export function deriveTrafficAlerts(input: TrafficIntelInput): TrafficAlert[] {
  const { baselineMin, current, destinationKind } = input;
  const out: TrafficAlert[] = [];

  const cur = Math.round(current.primaryMin);
  const base = baselineMin != null ? Math.max(1, Math.round(baselineMin)) : null;

  const periodsForKind: ReadonlyArray<"morning" | "afternoon" | "evening"> =
    destinationKind === "work"
      ? ["morning", "afternoon"]
      : destinationKind === "home"
        ? ["afternoon", "evening"]
        : ["morning", "afternoon", "evening"];

  if (base != null) {
    const delta = cur - base;
    const pct = delta / base;
    if (delta >= DELAY_ABS_MIN && pct >= DELAY_PCT_CRIT) {
      out.push({
        id: "heavy_congestion",
        severity: "critical",
        title: "Heavy congestion detected",
        suggestion: `Drive is about ${cur} min — ~${delta} min over your normal ${base} min. Leave earlier or expect to be late.`,
        icon: "AlertTriangle",
        periods: periodsForKind,
      });
    } else if (delta >= DELAY_ABS_MIN && pct >= DELAY_PCT_WARN) {
      out.push({
        id: "unusual_delay",
        severity: "warn",
        title: `Unusual delay (~${delta} min over normal)`,
        suggestion: `Allow ~${cur} min today instead of ${base}. Plan to leave a few minutes earlier.`,
        icon: "TrendingUp",
        periods: periodsForKind,
      });
      out.push({
        id: "leave_earlier",
        severity: "info",
        title: `Leave ${Math.max(5, delta)} minutes earlier today`,
        suggestion: "Build in extra buffer so the delay doesn't push appointments.",
        icon: "Clock",
        periods: periodsForKind,
      });
    } else if (delta <= -DELAY_ABS_MIN) {
      out.push({
        id: "clear_run",
        severity: "info",
        title: "Lighter traffic than usual",
        suggestion: `About ${cur} min right now — ${Math.abs(delta)} min faster than your baseline.`,
        icon: "CheckCircle2",
        periods: periodsForKind,
      });
    }
  }

  // Alternative route when materially shorter than the primary.
  if (current.alternativeMin != null) {
    const savings = Math.round(current.primaryMin - current.alternativeMin);
    if (savings >= ALT_SAVINGS_MIN) {
      out.push({
        id: "alternative_route",
        severity: "info",
        title: `Alternative route saves ~${savings} min`,
        suggestion: "A shorter option exists. Check your maps app before leaving.",
        icon: "Route",
        periods: periodsForKind,
      });
    }
  }

  // Long-drive heads-up regardless of baseline.
  if (cur >= LONG_DRIVE_MIN && !out.some((a) => a.severity !== "info")) {
    out.push({
      id: "long_drive",
      severity: "info",
      title: `Long drive (~${cur} min)`,
      suggestion: "Top up fuel/charge and grab water before you head out.",
      icon: "Car",
      periods: periodsForKind,
    });
  }

  // Evening "head home" framing for the work destination.
  if (destinationKind === "work" && cur >= 25 && !out.some((a) => a.id === "heavy_congestion")) {
    out.push({
      id: "evening_return",
      severity: "info",
      title: `Drive home: ~${cur} min`,
      suggestion: "Consider leaving on time to avoid the peak.",
      icon: "Clock",
      periods: ["evening"],
    });
  }

  const rank: Record<TrafficSeverity, number> = { critical: 0, warn: 1, info: 2 };
  const seen = new Set<TrafficAlertId>();
  return out
    .filter((a) => (seen.has(a.id) ? false : (seen.add(a.id), true)))
    .sort((a, b) => rank[a.severity] - rank[b.severity]);
}

export function alertsForPeriod(
  alerts: ReadonlyArray<TrafficAlert>,
  period: "morning" | "afternoon" | "evening",
): TrafficAlert[] {
  return alerts.filter((a) => a.periods.includes(period));
}
