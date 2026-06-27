/**
 * Pattern Detection Engine (Step 3).
 *
 * Pure detectors over the last 14–28 days of shifts, wearable_readings,
 * user_events and ai_feedback. Each detector returns zero or more
 * `{ pattern_key, severity, signals }` candidates that the caller upserts
 * into `ai_patterns`.
 *
 * Detectors are deliberately conservative — they only fire when the signal
 * is reasonably clean, so the user never sees "AI making things up".
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export type PatternKey =
  | "sleep_debt_3d"
  | "rotation_change"
  | "frequent_overtime"
  | "timezone_jump"
  | "missed_recovery"
  | "caffeine_late"
  | "missed_alarms"
  | "commute_fatigue"
  | "hrv_decline"
  | "sleep_inconsistency";

export type PatternCandidate = {
  pattern_key: PatternKey;
  severity: number; // 1..5
  signals: Record<string, unknown>;
};

type WearableRow = {
  date: string;
  sleep_minutes: number | null;
  hrv: number | null;
  readiness: number | null;
};

type ShiftRow = {
  day: number | null;
  start_min: number | null;
  end_min: number | null;
  starts_at: string | null;
};

function avg(xs: number[]): number {
  if (xs.length === 0) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function stdev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = avg(xs);
  return Math.sqrt(avg(xs.map((x) => (x - m) ** 2)));
}

function slope(xs: number[]): number {
  // simple least-squares slope over index 0..n-1
  if (xs.length < 3) return 0;
  const n = xs.length;
  const mx = (n - 1) / 2;
  const my = avg(xs);
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (i - mx) * (xs[i] - my);
    den += (i - mx) ** 2;
  }
  return den === 0 ? 0 : num / den;
}

/** Sleep debt = (target × 60 − sleep_minutes) summed over last 7 days. */
function detectSleepDebt(
  wear: WearableRow[],
  targetHours: number,
): PatternCandidate | null {
  const last7 = wear.slice(0, 7).filter((w) => w.sleep_minutes != null);
  if (last7.length < 4) return null;
  const target = targetHours * 60;
  const debt = last7.reduce(
    (a, w) => a + Math.max(0, target - (w.sleep_minutes ?? target)),
    0,
  );
  const debtHours = debt / 60;
  if (debtHours < 2) return null;
  const severity = debtHours >= 8 ? 5 : debtHours >= 5 ? 4 : debtHours >= 3 ? 3 : 2;
  return {
    pattern_key: "sleep_debt_3d",
    severity,
    signals: {
      debt_hours: Number(debtHours.toFixed(1)),
      nights_evaluated: last7.length,
      target_hours: targetHours,
    },
  };
}

/** Rotation change = day vs night flip in the last 3 shifts. */
function detectRotationChange(shifts: ShiftRow[]): PatternCandidate | null {
  const last3 = shifts.slice(0, 3).filter((s) => s.start_min != null);
  if (last3.length < 3) return null;
  const isNight = (s: ShiftRow) =>
    (s.start_min ?? 0) >= 18 * 60 || (s.start_min ?? 0) < 6 * 60;
  const kinds = last3.map(isNight);
  const flipped = kinds.some((k) => k !== kinds[0]);
  if (!flipped) return null;
  return {
    pattern_key: "rotation_change",
    severity: 4,
    signals: { last3_kinds: kinds.map((n) => (n ? "night" : "day")) },
  };
}

/** HRV decline = negative slope over last 7 readings with >5% drop. */
function detectHrvDecline(wear: WearableRow[]): PatternCandidate | null {
  const hrvs = wear
    .slice(0, 7)
    .map((w) => w.hrv)
    .filter((v): v is number => typeof v === "number" && v > 0)
    .reverse(); // oldest → newest for slope
  if (hrvs.length < 5) return null;
  const s = slope(hrvs);
  const baseline = avg(hrvs);
  const slopePct = baseline > 0 ? s / baseline : 0;
  if (slopePct >= -0.01) return null;
  const drop = Math.abs(slopePct);
  const severity = drop > 0.04 ? 4 : drop > 0.02 ? 3 : 2;
  return {
    pattern_key: "hrv_decline",
    severity,
    signals: {
      slope_per_day_pct: Number((slopePct * 100).toFixed(2)),
      baseline_hrv: Math.round(baseline),
    },
  };
}

/** Sleep inconsistency = stdev of nightly sleep minutes > 90 over 7d. */
function detectSleepInconsistency(wear: WearableRow[]): PatternCandidate | null {
  const mins = wear
    .slice(0, 7)
    .map((w) => w.sleep_minutes)
    .filter((v): v is number => typeof v === "number");
  if (mins.length < 5) return null;
  const sd = stdev(mins);
  if (sd < 75) return null;
  const severity = sd > 120 ? 4 : 3;
  return {
    pattern_key: "sleep_inconsistency",
    severity,
    signals: { stdev_minutes: Math.round(sd), nights: mins.length },
  };
}

/**
 * Run all detectors and upsert active patterns. Patterns missing this run
 * are NOT auto-deactivated here — they stay active until the user mutes or
 * deletes them, or until a future sweep marks them stale.
 */
export async function runPatternDetection(
  admin: SupabaseClient,
  userId: string,
  targetSleepHours: number,
): Promise<PatternCandidate[]> {
  const since = new Date(Date.now() - 28 * 86_400_000).toISOString().slice(0, 10);

  const [{ data: wearRaw }, { data: shiftRaw }] = await Promise.all([
    admin
      .from("wearable_readings")
      .select("date, sleep_minutes, hrv, readiness")
      .eq("user_id", userId)
      .gte("date", since)
      .order("date", { ascending: false })
      .limit(28),
    admin
      .from("shifts")
      .select("day, start_min, end_min, starts_at")
      .eq("user_id", userId)
      .order("starts_at", { ascending: false })
      .limit(20),
  ]);

  const wear = (wearRaw as WearableRow[] | null) ?? [];
  const shifts = (shiftRaw as ShiftRow[] | null) ?? [];

  const candidates: PatternCandidate[] = [];
  const push = (c: PatternCandidate | null) => { if (c) candidates.push(c); };

  push(detectSleepDebt(wear, targetSleepHours));
  push(detectHrvDecline(wear));
  push(detectSleepInconsistency(wear));
  push(detectRotationChange(shifts));
  push(await detectTimezoneJump(admin, userId));

  if (candidates.length === 0) return [];

  // Upsert each by (user_id, pattern_key). Bump occurrences + last_seen_at.
  const now = new Date().toISOString();
  for (const c of candidates) {
    const { data: existing } = await admin
      .from("ai_patterns")
      .select("id, occurrences, muted_until")
      .eq("user_id", userId)
      .eq("pattern_key", c.pattern_key)
      .maybeSingle();
    if (existing) {
      const mutedUntil = (existing as { muted_until: string | null }).muted_until;
      if (mutedUntil && new Date(mutedUntil).getTime() > Date.now()) continue;
      await admin
        .from("ai_patterns")
        .update({
          severity: c.severity,
          signals_json: c.signals,
          occurrences: ((existing as { occurrences: number }).occurrences ?? 0) + 1,
          last_seen_at: now,
          active: true,
        } as never)
        .eq("id", (existing as { id: string }).id);
    } else {
      await admin.from("ai_patterns").insert({
        user_id: userId,
        pattern_key: c.pattern_key,
        severity: c.severity,
        signals_json: c.signals,
      } as never);
    }
  }
  return candidates;
}

export async function fetchActivePatterns(
  admin: SupabaseClient,
  userId: string,
  limit = 5,
) {
  const { data } = await admin
    .from("ai_patterns")
    .select("id, pattern_key, severity, signals_json, last_seen_at, occurrences")
    .eq("user_id", userId)
    .eq("active", true)
    .or(`muted_until.is.null,muted_until.lt.${new Date().toISOString()}`)
    .order("severity", { ascending: false })
    .order("last_seen_at", { ascending: false })
    .limit(limit);
  return (data ?? []) as Array<{
    id: string;
    pattern_key: PatternKey;
    severity: number;
    signals_json: Record<string, unknown>;
    last_seen_at: string;
    occurrences: number;
  }>;
}
