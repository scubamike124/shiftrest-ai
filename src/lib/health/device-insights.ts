// Insights and recommendations on this device, with Apple Health folded in.
//
// Privacy rule: Apple Health data stays on the iPhone. The dashboard's AI
// cards send `insights.contextString` to the server's AI providers, so that
// string is ALWAYS the one computed WITHOUT Apple Health data. Apple Health
// only changes what the person sees on their own phone: fatigue, recovery,
// sleep debt, and the recommendations (labelled "from Apple Health").

import { computeInsights, type Insights, type LastNightSummary } from "@/lib/insights";
import type { Recommendation } from "@/lib/recommendations";
import type { Employer } from "@/lib/employers";
import type { Prefs } from "@/lib/prefs";
import type { Shift } from "@/lib/shifts";
import { lastNightFrom, recentNights, type AppleHealthNight } from "@/lib/health/apple-health";

export const APPLE_HEALTH_LABEL = "Measured · from Apple Health";

export type DeviceInsights = {
  insights: Insights;
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
  if (!nights.length) return { insights: base, source: null, appleHealthLastNight: null };
  const last = lastNightFrom(nights, now);
  const withHealth = computeInsights(shifts, prefs, now, employers, last, nights);
  return {
    insights: { ...withHealth, contextString: base.contextString },
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
