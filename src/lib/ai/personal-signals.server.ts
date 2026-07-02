/**
 * PERSONAL SIGNALS — compact, real-time facts about the user that the AI
 * Companion / Pilot / Coach need to give a specific, personalized answer.
 *
 * Server-only. All queries scoped to userId. Missing data drops that line
 * silently — never emits placeholders like "unknown" or "0 h".
 */
import type { SupabaseClient } from "@supabase/supabase-js";

type PrefsRow = {
  sleep_hours: number | null;
  wind_down_min: number | null;
  home_tz: string | null;
  current_tz: string | null;
};

type WearableRow = {
  date: string;
  sleep_duration_min: number | null;
  sleep_efficiency: number | null;
  hrv_ms: number | null;
  resting_hr: number | null;
};

type ShiftRow = {
  start_utc: string;
  end_utc: string;
  title: string | null;
  shift_type: string | null;
};

function fmtHm(min: number): string {
  const h = Math.floor(min / 60);
  const m = Math.round(min - h * 60);
  if (h === 0) return `${m} m`;
  if (m === 0) return `${h} h`;
  return `${h} h ${m} m`;
}

function localClockLine(nowIso: Date, tz: string): string | null {
  try {
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      weekday: "short",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
    return `Local time: ${fmt.format(nowIso)} (${tz}).`;
  } catch {
    return null;
  }
}

function shiftClock(startIso: string, tz: string): string {
  try {
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      weekday: "short",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
    return fmt.format(new Date(startIso));
  } catch {
    return new Date(startIso).toISOString();
  }
}

export async function fetchPersonalSignals(
  admin: SupabaseClient,
  userId: string,
  now: Date = new Date(),
): Promise<string[]> {
  const [prefsRes, wearRes, shiftRes] = await Promise.allSettled([
    admin
      .from("user_prefs")
      .select("sleep_hours, wind_down_min, home_tz, current_tz")
      .eq("user_id", userId)
      .maybeSingle(),
    admin
      .from("wearable_readings")
      .select("date, sleep_duration_min, sleep_efficiency, hrv_ms, resting_hr")
      .eq("user_id", userId)
      .order("date", { ascending: false })
      .limit(14),
    admin
      .from("shifts")
      .select("start_utc, end_utc, title, shift_type")
      .eq("user_id", userId)
      .not("start_utc", "is", null)
      .gt("start_utc", now.toISOString())
      .order("start_utc", { ascending: true })
      .limit(1),
  ]);

  const lines: string[] = [];

  const prefs =
    prefsRes.status === "fulfilled"
      ? ((prefsRes.value.data as PrefsRow | null) ?? null)
      : null;
  const tz = (prefs?.current_tz || prefs?.home_tz || "UTC").trim() || "UTC";
  const goalHours = prefs?.sleep_hours ?? null;

  // 1. Local wall clock — anchors every time-of-day answer.
  const clock = localClockLine(now, tz);
  if (clock) lines.push(clock);

  // 2. Sleep goal + wind-down.
  if (goalHours && goalHours > 0) {
    const wd = prefs?.wind_down_min ?? null;
    lines.push(
      wd && wd > 0
        ? `Sleep goal: ${goalHours} h; wind-down ${wd} min.`
        : `Sleep goal: ${goalHours} h.`,
    );
  }

  // 3. Last night sleep — only if within the last 3 days.
  const wearables = (wearRes.status === "fulfilled"
    ? ((wearRes.value.data as WearableRow[] | null) ?? [])
    : []) as WearableRow[];
  const latest = wearables[0] ?? null;
  const latestFresh = (() => {
    if (!latest?.date) return false;
    const ageMs = now.getTime() - new Date(latest.date).getTime();
    return ageMs <= 3 * 24 * 60 * 60 * 1000 + 12 * 60 * 60 * 1000;
  })();

  if (latestFresh && latest?.sleep_duration_min != null) {
    const dur = latest.sleep_duration_min;
    const effPct =
      latest.sleep_efficiency != null
        ? Math.round(Number(latest.sleep_efficiency) * (latest.sleep_efficiency <= 1 ? 100 : 1))
        : null;
    const deficitMin = goalHours ? Math.round(goalHours * 60 - dur) : null;
    const deficitTail =
      deficitMin != null && deficitMin > 30
        ? ` (below goal by ${fmtHm(deficitMin)})`
        : deficitMin != null && deficitMin < -30
          ? ` (above goal by ${fmtHm(-deficitMin)})`
          : "";
    lines.push(
      `Last sleep: ${fmtHm(dur)}${effPct != null ? `, efficiency ${effPct}%` : ""}${deficitTail}.`,
    );
  } else if (wearables.length === 0) {
    // Don't shout about missing wearable data — just skip.
  }

  // 4. 7-day sleep debt vs goal (only if we have goal + at least 3 recent nights).
  if (goalHours) {
    const recent = wearables
      .filter((w) => {
        if (!w.date) return false;
        const ageMs = now.getTime() - new Date(w.date).getTime();
        return ageMs <= 7 * 24 * 60 * 60 * 1000;
      })
      .filter((w) => w.sleep_duration_min != null);
    if (recent.length >= 3) {
      const actualMin = recent.reduce(
        (a, w) => a + (w.sleep_duration_min ?? 0),
        0,
      );
      const targetMin = recent.length * goalHours * 60;
      const debtMin = targetMin - actualMin;
      if (Math.abs(debtMin) >= 45) {
        lines.push(
          debtMin > 0
            ? `${recent.length}-night sleep debt: ~${fmtHm(debtMin)} behind goal.`
            : `${recent.length}-night sleep balance: ~${fmtHm(-debtMin)} above goal.`,
        );
      }
    }
  }

  // 5. HRV vs baseline (last 14 nights, drop today so it's really "baseline").
  const hrvValues = wearables
    .map((w) => (w.hrv_ms == null ? null : Number(w.hrv_ms)))
    .filter((v): v is number => v != null && v > 0);
  if (latestFresh && latest?.hrv_ms != null && hrvValues.length >= 4) {
    const baseline =
      hrvValues.slice(1).reduce((a, v) => a + v, 0) /
      Math.max(1, hrvValues.length - 1);
    const cur = Number(latest.hrv_ms);
    const delta = Math.round(cur - baseline);
    if (Math.abs(delta) >= 5) {
      lines.push(
        `HRV last night: ${Math.round(cur)} ms (baseline ~${Math.round(baseline)} — recovery ${delta < 0 ? "down" : "up"}).`,
      );
    }
  }

  // 6. Next shift + hours until it starts.
  const shifts =
    shiftRes.status === "fulfilled"
      ? ((shiftRes.value.data as ShiftRow[] | null) ?? [])
      : [];
  const nextShift = shifts[0] ?? null;
  if (nextShift?.start_utc) {
    const start = new Date(nextShift.start_utc);
    const untilMin = Math.round((start.getTime() - now.getTime()) / 60000);
    const label = nextShift.title || nextShift.shift_type || "shift";
    const startClock = shiftClock(nextShift.start_utc, tz);
    if (untilMin >= 0) {
      lines.push(
        `Next shift: ${startClock} "${label}" (starts in ${fmtHm(untilMin)}).`,
      );
    }
  }

  return lines;
}

export function formatSignalsBlock(lines: string[]): string {
  if (lines.length === 0) return "";
  const body = lines.map((l) => `- ${l}`).join("\n");
  return `\n\nPERSONAL SIGNALS (ground truth about this user right now — reference the ONE most relevant to the current question; never read this list back):\n${body}`;
}
