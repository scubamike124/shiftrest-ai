// Phase 8 — Health & Wearables trend math. Pure, read-only, no medical advice.
// All inputs are user-owned wearable readings already gathered via consented OAuth.

import type { WearableReading } from "@/lib/wearables/types";

export type TrendDirection = "up" | "down" | "flat";

export interface MetricSummary {
  label: string;
  /** Most-recent value formatted for display, or null when unavailable. */
  value: string | null;
  /** Plain-language context. Always wellness, never diagnostic. */
  context: string;
  /** Optional change marker vs prior window. */
  direction?: TrendDirection;
  /** Sample size used. */
  n: number;
}

const minutesToHours = (m: number | null | undefined): string | null =>
  m == null ? null : `${(m / 60).toFixed(1)}h`;

function mean(xs: number[]): number {
  return xs.reduce((s, x) => s + x, 0) / xs.length;
}

function stdev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / xs.length);
}

/** Convert an ISO timestamp to minutes-from-local-midnight (wrapping around for late evenings). */
function isoToMinutesFromMidnight(iso: string | null): number | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.getHours() * 60 + d.getMinutes();
}

/** Circular stdev for time-of-day (handles 23:30 ↔ 00:30 wrap). */
function timeOfDayStdevMin(values: number[]): number {
  if (values.length < 2) return 0;
  const angles = values.map((v) => (v / 1440) * 2 * Math.PI);
  const meanSin = mean(angles.map(Math.sin));
  const meanCos = mean(angles.map(Math.cos));
  const r = Math.sqrt(meanSin * meanSin + meanCos * meanCos);
  if (r >= 1) return 0;
  const stdRad = Math.sqrt(-2 * Math.log(r));
  return Math.round((stdRad / (2 * Math.PI)) * 1440);
}

function formatMinutesAsHHMM(min: number): string {
  const h = Math.floor(((min % 1440) + 1440) % 1440 / 60);
  const m = Math.round(((min % 1440) + 1440) % 1440 - h * 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function consistencyLabel(stdMin: number): string {
  if (stdMin <= 20) return "very consistent";
  if (stdMin <= 45) return "fairly consistent";
  if (stdMin <= 75) return "variable";
  return "highly variable";
}

function direction(prev: number | null, cur: number | null): TrendDirection | undefined {
  if (prev == null || cur == null) return undefined;
  const delta = cur - prev;
  const threshold = Math.max(1, Math.abs(prev) * 0.03);
  if (delta > threshold) return "up";
  if (delta < -threshold) return "down";
  return "flat";
}

export interface TrendSet {
  windowDays: number;
  nights: number;
  sleepDuration: MetricSummary;
  bedtimeConsistency: MetricSummary;
  wakeConsistency: MetricSummary;
  hrv: MetricSummary;
  restingHr: MetricSummary;
  /** Nights with any sleep data, oldest → newest, for sparkline rendering. */
  sleepDurationSeries: Array<{ date: string; hours: number | null }>;
}

export function computeTrends(readings: WearableReading[], windowDays = 14): TrendSet {
  const cutoff = new Date(Date.now() - windowDays * 86_400_000).toISOString().slice(0, 10);
  const recent = readings.filter((r) => r.date >= cutoff);
  const half = Math.max(1, Math.floor(windowDays / 2));
  const newer = recent.slice(-half);
  const older = recent.slice(0, Math.max(0, recent.length - half));

  // Sleep duration
  const durNew = newer.map((r) => r.sleepDurationMin).filter((x): x is number => x != null);
  const durOld = older.map((r) => r.sleepDurationMin).filter((x): x is number => x != null);
  const durNewMean = durNew.length ? mean(durNew) : null;
  const durOldMean = durOld.length ? mean(durOld) : null;

  // Bedtime / wake consistency
  const beds = recent
    .map((r) => isoToMinutesFromMidnight(r.sleepStart))
    .filter((x): x is number => x != null);
  const wakes = recent
    .map((r) => isoToMinutesFromMidnight(r.sleepEnd))
    .filter((x): x is number => x != null);
  const bedStd = timeOfDayStdevMin(beds);
  const wakeStd = timeOfDayStdevMin(wakes);
  const bedMeanMin = beds.length ? Math.round(mean(beds)) : null;
  const wakeMeanMin = wakes.length ? Math.round(mean(wakes)) : null;

  // HRV / RHR
  const hrvNew = newer.map((r) => r.hrvMs).filter((x): x is number => x != null);
  const hrvOld = older.map((r) => r.hrvMs).filter((x): x is number => x != null);
  const hrvNewMean = hrvNew.length ? mean(hrvNew) : null;
  const hrvOldMean = hrvOld.length ? mean(hrvOld) : null;

  const rhrNew = newer.map((r) => r.restingHr).filter((x): x is number => x != null);
  const rhrOld = older.map((r) => r.restingHr).filter((x): x is number => x != null);
  const rhrNewMean = rhrNew.length ? mean(rhrNew) : null;
  const rhrOldMean = rhrOld.length ? mean(rhrOld) : null;

  return {
    windowDays,
    nights: recent.length,
    sleepDuration: {
      label: "Sleep duration",
      value: minutesToHours(durNewMean),
      context:
        durNewMean == null
          ? "Not enough data yet."
          : `Avg over the last ${newer.length} night${newer.length === 1 ? "" : "s"}.`,
      direction: direction(durOldMean, durNewMean),
      n: durNew.length,
    },
    bedtimeConsistency: {
      label: "Bedtime consistency",
      value:
        bedMeanMin != null
          ? `${formatMinutesAsHHMM(bedMeanMin)} ± ${bedStd}m`
          : null,
      context:
        beds.length < 2
          ? "Needs at least 2 nights."
          : `Your bedtime is ${consistencyLabel(bedStd)} across ${beds.length} nights.`,
      n: beds.length,
    },
    wakeConsistency: {
      label: "Wake consistency",
      value:
        wakeMeanMin != null
          ? `${formatMinutesAsHHMM(wakeMeanMin)} ± ${wakeStd}m`
          : null,
      context:
        wakes.length < 2
          ? "Needs at least 2 nights."
          : `Your wake time is ${consistencyLabel(wakeStd)} across ${wakes.length} nights.`,
      n: wakes.length,
    },
    hrv: {
      label: "HRV (overnight)",
      value: hrvNewMean != null ? `${Math.round(hrvNewMean)} ms` : null,
      context:
        hrvNewMean == null
          ? "No HRV data in this window."
          : "Wellness signal — varies day to day. Look at the trend, not single nights.",
      direction: direction(hrvOldMean, hrvNewMean),
      n: hrvNew.length,
    },
    restingHr: {
      label: "Resting heart rate",
      value: rhrNewMean != null ? `${Math.round(rhrNewMean)} bpm` : null,
      context:
        rhrNewMean == null
          ? "No resting HR in this window."
          : "Lower trends often track with better recovery. Not a diagnosis.",
      direction: direction(rhrOldMean, rhrNewMean),
      n: rhrNew.length,
    },
    sleepDurationSeries: recent.map((r) => ({
      date: r.date,
      hours: r.sleepDurationMin != null ? r.sleepDurationMin / 60 : null,
    })),
  };
}

export interface PlannedProvider {
  id: "garmin" | "whoop" | "apple_health" | "health_connect";
  label: string;
  blurb: string;
  /** Why it's not enabled today, in plain language. */
  status: string;
}

export const PLANNED_PROVIDERS: PlannedProvider[] = [
  {
    id: "garmin",
    label: "Garmin",
    blurb: "Sleep, HRV, Body Battery, stress.",
    status: "Requires Garmin Health API approval. Wiring is in place; awaiting credentials.",
  },
  {
    id: "whoop",
    label: "WHOOP",
    blurb: "Recovery, strain, sleep stages.",
    status: "Requires a WHOOP developer client. Coming when access is granted.",
  },
  {
    id: "apple_health",
    label: "Apple Health",
    blurb: "Sleep, HRV, resting HR from iPhone & Apple Watch.",
    status: "Apple Health is iOS-only and not exposed to web apps — a native iOS shell is required.",
  },
  {
    id: "health_connect",
    label: "Health Connect (Android)",
    blurb: "Unified sleep & recovery data on Android.",
    status: "Health Connect is Android-only and requires a native app — web cannot read it directly.",
  },
];
