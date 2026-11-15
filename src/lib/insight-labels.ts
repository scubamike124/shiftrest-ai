// Plain-language provenance lines for the schedule-based estimates
// (fatigue, recovery). Pure, so tests can check the wording for every data
// combination.
import type { Insights, LastNightSummary } from "@/lib/insights";

export const PROVIDER_NAME: Record<LastNightSummary["provider"], string> = {
  fitbit: "Fitbit",
  oura: "Oura",
  "apple-health": "Apple Health",
};

/** Source line for the fatigue/recovery estimates. */
export function estimateSourceLabel(insights: Pick<Insights, "dataSources">): string {
  const d = insights.dataSources;
  const base = d.schedule
    ? "Calculated from your shift schedule"
    : "No shifts entered yet, so these are defaults";
  if (d.wearableProviders.length && d.wearableNights > 0) {
    const n = d.wearableNights;
    const names = d.wearableProviders.map((p) => PROVIDER_NAME[p]).join(" and ");
    return `${base}, adjusted with ${n} night${n === 1 ? "" : "s"} of ${names} data.`;
  }
  if (d.wearableStale)
    return `${base}. Your newest wearable reading is more than 3 days old, so it isn't used.`;
  return `${base}. No wearable sleep data is used.`;
}

/**
 * The dashboard whisper's one observation. Sleep debt is an estimate against
 * the sleep target, so it says so and names the real number of nights.
 */
export function pickObservation(
  insights: Pick<Insights, "sleepDebtHours" | "hrvTrend" | "signals" | "dataSources"> | null,
): { id: string; text: string } | null {
  if (!insights) return null;
  // Highest-leverage signal first.
  if (Math.abs(insights.sleepDebtHours) >= 2) {
    const n = insights.dataSources.sleepNights;
    const nights = `${n} night${n === 1 ? "" : "s"} of wearable sleep`;
    const hours = Math.abs(insights.sleepDebtHours).toFixed(1);
    return {
      id: `debt-${Math.round(insights.sleepDebtHours)}`,
      text:
        insights.sleepDebtHours > 0
          ? `Estimated sleep debt: about ${hours}h, from ${nights}.`
          : `You're about ${hours}h ahead of your sleep target (an estimate from ${nights}).`,
    };
  }
  if (insights.hrvTrend != null && insights.hrvTrend <= -0.07) {
    return {
      id: `hrv-${Math.round(insights.hrvTrend * 100)}`,
      text: `Your HRV is trending ${Math.round(Math.abs(insights.hrvTrend) * 100)}% below your 7-day baseline — your body is asking for more recovery.`,
    };
  }
  const firstSignal = insights.signals[0];
  if (firstSignal) {
    return { id: `sig-${firstSignal.slice(0, 24)}`, text: firstSignal };
  }
  return null;
}
