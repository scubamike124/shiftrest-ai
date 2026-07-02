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
  sleep_start: string | null;
  sleep_end: string | null;
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

type AlarmRow = {
  starts_at: string;
  title: string | null;
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
  // Fetch a wider shift window: last 10 days + next 14 days so we can
  // detect in-progress shift, consecutive work-days, and next day off.
  const shiftFrom = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000).toISOString();
  const shiftTo = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000).toISOString();

  const [prefsRes, wearRes, shiftRes, alarmRes] = await Promise.allSettled([
    admin
      .from("user_prefs")
      .select("sleep_hours, wind_down_min, home_tz, current_tz")
      .eq("user_id", userId)
      .maybeSingle(),
    admin
      .from("wearable_readings")
      .select(
        "date, sleep_start, sleep_end, sleep_duration_min, sleep_efficiency, hrv_ms, resting_hr",
      )
      .eq("user_id", userId)
      .order("date", { ascending: false })
      .limit(14),
    admin
      .from("shifts")
      .select("start_utc, end_utc, title, shift_type")
      .eq("user_id", userId)
      .not("start_utc", "is", null)
      .gte("start_utc", shiftFrom)
      .lte("start_utc", shiftTo)
      .order("start_utc", { ascending: true }),
    admin
      .from("user_events")
      .select("starts_at, title")
      .eq("user_id", userId)
      .eq("kind", "smart-alarm")
      .gt("starts_at", now.toISOString())
      .order("starts_at", { ascending: true })
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

  // 6. Shift context — in-progress, next upcoming, consecutive work-days,
  // and next day off. Uses ±10/14-day window fetched above.
  const shifts =
    shiftRes.status === "fulfilled"
      ? ((shiftRes.value.data as ShiftRow[] | null) ?? [])
      : [];

  const inProgress = shifts.find((s) => {
    if (!s.start_utc || !s.end_utc) return false;
    const st = new Date(s.start_utc).getTime();
    const en = new Date(s.end_utc).getTime();
    return st <= now.getTime() && en >= now.getTime();
  });
  if (inProgress) {
    const remainMin = Math.max(
      0,
      Math.round((new Date(inProgress.end_utc).getTime() - now.getTime()) / 60000),
    );
    const label = inProgress.title || inProgress.shift_type || "shift";
    lines.push(`Currently on shift "${label}" — ${fmtHm(remainMin)} remaining.`);
  }

  const upcoming = shifts.filter((s) => new Date(s.start_utc).getTime() > now.getTime());
  const nextShift = upcoming[0] ?? null;
  if (nextShift?.start_utc && !inProgress) {
    const start = new Date(nextShift.start_utc);
    const untilMin = Math.round((start.getTime() - now.getTime()) / 60000);
    const label = nextShift.title || nextShift.shift_type || "shift";
    const startClock = shiftClock(nextShift.start_utc, tz);
    if (untilMin >= 0) {
      lines.push(`Next shift: ${startClock} "${label}" (starts in ${fmtHm(untilMin)}).`);
    }
  }

  // Consecutive work-days ending today (count distinct local dates with a shift).
  const localDay = (iso: string) => {
    try {
      return new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date(iso));
    } catch {
      return iso.slice(0, 10);
    }
  };
  const workedDays = new Set(shifts.map((s) => localDay(s.start_utc)));
  const todayLocal = localDay(now.toISOString());
  let streak = 0;
  for (let i = 0; i < 10; i++) {
    const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
    if (workedDays.has(localDay(d.toISOString()))) streak++;
    else break;
  }
  if (streak >= 3) {
    lines.push(`On day ${streak} of consecutive work-days.`);
  }

  // Next day off within the next 14 days (first local date with no shift).
  if (workedDays.size > 0) {
    for (let i = 1; i <= 14; i++) {
      const d = new Date(now.getTime() + i * 24 * 60 * 60 * 1000);
      const key = localDay(d.toISOString());
      if (!workedDays.has(key)) {
        if (i === 1) lines.push(`Tomorrow is a day off.`);
        else if (i <= 4) lines.push(`Next day off: in ${i} days.`);
        break;
      }
    }
  }

  // 7. Bedtime / wake trends — median local hour over last 7 nights + stdev.
  const withTimes = wearables
    .filter((w) => w.sleep_start && w.sleep_end)
    .slice(0, 7);
  if (withTimes.length >= 4) {
    const localHour = (iso: string): number => {
      try {
        const parts = new Intl.DateTimeFormat("en-US", {
          timeZone: tz,
          hour: "numeric",
          hour12: false,
          minute: "2-digit",
        }).formatToParts(new Date(iso));
        const h = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
        const m = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
        return h + m / 60;
      } catch {
        return 0;
      }
    };
    // Wrap bedtimes so 23:30 and 00:30 don't average to noon.
    const beds = withTimes.map((w) => {
      const h = localHour(w.sleep_start!);
      return h < 12 ? h + 24 : h;
    });
    const wakes = withTimes.map((w) => localHour(w.sleep_end!));
    const median = (xs: number[]) => {
      const s = [...xs].sort((a, b) => a - b);
      const mid = Math.floor(s.length / 2);
      return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
    };
    const stdev = (xs: number[]) => {
      const m = xs.reduce((a, v) => a + v, 0) / xs.length;
      return Math.sqrt(xs.reduce((a, v) => a + (v - m) ** 2, 0) / xs.length);
    };
    const fmtClock = (h: number) => {
      const hh = ((Math.floor(h) % 24) + 24) % 24;
      const mm = Math.round((h - Math.floor(h)) * 60);
      const period = hh >= 12 ? "PM" : "AM";
      const disp = hh % 12 === 0 ? 12 : hh % 12;
      return `${disp}:${String(mm).padStart(2, "0")} ${period}`;
    };
    const bedMed = median(beds);
    const wakeMed = median(wakes);
    const bedStd = stdev(beds);
    const consistency = bedStd < 0.5 ? "very consistent" : bedStd < 1.25 ? "fairly consistent" : "drifting";
    lines.push(
      `7-night trend: typical bedtime ~${fmtClock(bedMed)}, wake ~${fmtClock(wakeMed)} (${consistency}).`,
    );
  }

  // 8. Resting HR trend — current vs 7-night baseline (skip today).
  const rhrValues = wearables
    .map((w) => (w.resting_hr == null ? null : Number(w.resting_hr)))
    .filter((v): v is number => v != null && v > 0);
  if (latestFresh && latest?.resting_hr != null && rhrValues.length >= 4) {
    const baseline = rhrValues.slice(1).reduce((a, v) => a + v, 0) / (rhrValues.length - 1);
    const cur = Number(latest.resting_hr);
    const delta = Math.round(cur - baseline);
    if (Math.abs(delta) >= 4) {
      lines.push(
        `Resting HR last night: ${Math.round(cur)} bpm (baseline ~${Math.round(baseline)} — ${delta > 0 ? "elevated, often a load/illness signal" : "lower, usually a recovery sign"}).`,
      );
    }
  }

  // 9. Sleep-goal streak — nights ≥ goal in last 14.
  if (goalHours && wearables.length >= 3) {
    const targetMin = goalHours * 60;
    let hitStreak = 0;
    for (const w of wearables) {
      if (w.sleep_duration_min != null && w.sleep_duration_min >= targetMin - 15) {
        hitStreak++;
      } else break;
    }
    const hit14 = wearables.filter(
      (w) => w.sleep_duration_min != null && w.sleep_duration_min >= targetMin - 15,
    ).length;
    if (hitStreak >= 3) {
      lines.push(`Sleep-goal streak: ${hitStreak} nights in a row hitting goal.`);
    } else if (hit14 >= 8) {
      lines.push(`Hit sleep goal ${hit14} of the last ${wearables.length} nights.`);
    }
  }

  // 10. Next scheduled alarm (Smart Alarm engine).
  const alarms =
    alarmRes.status === "fulfilled"
      ? ((alarmRes.value.data as AlarmRow[] | null) ?? [])
      : [];
  const nextAlarm = alarms[0] ?? null;
  if (nextAlarm?.starts_at) {
    const untilMin = Math.round(
      (new Date(nextAlarm.starts_at).getTime() - now.getTime()) / 60000,
    );
    if (untilMin >= 0 && untilMin <= 24 * 60) {
      lines.push(
        `Next alarm: ${shiftClock(nextAlarm.starts_at, tz)} (in ${fmtHm(untilMin)}).`,
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
