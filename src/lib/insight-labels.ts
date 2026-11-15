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
