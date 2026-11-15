// Insights and recommendations on this device, with Apple Health folded in.
//
// Privacy rule: Apple Health data stays on the iPhone. Anything that can be
// sent to the server or its AI providers must come from `baseInsights`
// (computed WITHOUT Apple Health). `insights.contextString` is also pinned to
// the base version as a second guard. Apple Health
// only changes what the person sees on their own phone: fatigue, recovery,
// sleep debt, and the recommendations (labelled "from Apple Health").

import { computeInsights, type Insights, type LastNightSummary } from "@/lib/insights";
import type { Recommendation } from "@/lib/recommendations";
import type { Employer } from "@/lib/employers";
import type { Prefs } from "@/lib/prefs";
import type { Shift } from "@/lib/shifts";
import { lastNightFrom, recentNights, type AppleHealthNight } from "@/lib/health/apple-health";

/**
 * Sleep debt and HRV trends are calculations from measurements, so they are
 * labelled as estimates (same split as the AI guardrails' [wearable] vs
 * [estimate] tags). Raw nightly values are labelled "Measured" where shown.
 */
export const APPLE_HEALTH_LABEL = "Estimate · from Apple Health data";

export type DeviceInsights = {
  /** For what this phone SHOWS. May include Apple Health. Never send it anywhere. */
  insights: Insights;
  /**
   * The same insights computed WITHOUT Apple Health. Anything that can leave
   * the phone (AI cards, "adjust my plan", sharing) must use this one.
   */
  baseInsights: Insights;
  /** Set when Apple Health data shaped these insights. */
  source: "apple-health" | null;
  /** The night shown as "last night", when it came from Apple Health. */
  appleHealthLastNight: AppleHealthNight | null;
};

export function computeDeviceInsights(args: {
  shifts: Shift[];
  prefs: Prefs;
  now: Date;
  employers?: Employer[];
  serverLastNight?: LastNightSummary | null;
  appleHealthNights?: AppleHealthNight[] | null;
}): DeviceInsights {
  const { shifts, prefs, now, employers = [] } = args;
  const base = computeInsights(shifts, prefs, now, employers, args.serverLastNight ?? null);
  const nights = args.appleHealthNights ? recentNights(args.appleHealthNights, now) : [];
  if (!nights.length)
    return { insights: base, baseInsights: base, source: null, appleHealthLastNight: null };
  const last = lastNightFrom(nights, now);
  // No recent Apple Health night: keep the connected server wearable's last night.
  const withHealth = computeInsights(
    shifts,
    prefs,
    now,
    employers,
    last ?? args.serverLastNight ?? null,
    nights,
  );
  return {
    insights: { ...withHealth, contextString: base.contextString },
    baseInsights: base,
    source: "apple-health",
    appleHealthLastNight: last,
  };
}

/** Labels the recommendations that came from Apple Health measurements. */
export function labelRecommendations(
  recs: Recommendation[],
  source: DeviceInsights["source"],
): Recommendation[] {
  if (source !== "apple-health") return recs;
  return recs.map((r) => (r.basedOnWearable ? { ...r, dataSource: APPLE_HEALTH_LABEL } : r));
}
