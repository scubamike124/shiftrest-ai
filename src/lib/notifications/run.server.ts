// Cron worker: scans all users with reminders enabled and at least one push
// subscription, computes due reminders, applies filters, sends + logs.
//
// Service-role only. Must be imported lazily from the route handler.

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { Prefs } from "@/lib/prefs";
import type { Shift } from "@/lib/shifts";
import {
  computeDueReminders,
  isQuiet,
  minuteOfDayInTz,
  type NotifPrefs,
} from "./schedule";
import { copyFor, type ReminderKind } from "./copy";
import { sendPushToUser } from "@/lib/push/web-push.server";

type PrefsRow = {
  user_id: string;
  wind_down_min: number;
  sleep_hours: number;
  notifications: boolean;
  low_light: boolean;
  lat: number;
  lon: number;
  location_label: string;
  partner_name: string;
  cycle_weeks: number | null;
  cycle_anchor: string | null;
};

function rowToPrefs(r: PrefsRow): Prefs {
  return {
    windDownMin: r.wind_down_min,
    sleepHours: Number(r.sleep_hours),
    notifications: r.notifications,
    lowLight: r.low_light,
    lat: r.lat,
    lon: r.lon,
    locationLabel: r.location_label,
    partnerName: r.partner_name,
    onboarded: true,
    cycleWeeks: Math.max(1, Math.min(6, r.cycle_weeks ?? 1)),
    cycleAnchor: r.cycle_anchor ?? null,
    assistantName: "RestPilot",
    assistantMode: "coach",
    memoryEnabled: false,
    memoryLearningPaused: false,
    predictiveEnabled: true,
    tomorrowPreviewEnabled: true,
    dailyReviewEnabled: true,
    feedbackLearningEnabled: true,
    homeTz: null,
    currentTz: null,
    tzAuto: true,
    offlineEnabled: true,
    travelModeEnabled: true,
    calendarTravelDetect: false,
    voiceId: "sage",
    voiceLanguage: "en-US",
    voiceAccent: null,
    voicePersonality: "calm",
    voiceSpeed: 1.0,
    voiceInstructions: null,
    briefLayout: {
      order: ["sleep", "alarm", "weather", "longclock", "departure", "tip", "motivation"],
      hidden: ["departure"],
    },
    homeAddress: null,
    workAddress: null,
    commuteMinutesBaseline: null,
  };
}

const DEDUPE_WINDOW_MS = 30 * 60_000;

export async function runNotificationTick(now: Date) {
  // Active candidates: users with notification_prefs.enabled = true.
  const { data: notifRows, error: notifErr } = await supabaseAdmin
    .from("notification_prefs")
    .select(
      "user_id, enabled, wind_down, caffeine_cutoff, bright_light, shift_start, shift_end_recovery, smart_alarm, commute, calendar, quiet_start, quiet_end, daily_cap, timezone",
    )
    .eq("enabled", true);

  if (notifErr) {
    console.error("notify: load notification_prefs failed", notifErr);
    return { error: notifErr.message };
  }
  const users = (notifRows ?? []) as Array<NotifPrefs & { user_id: string }>;
  if (users.length === 0) return { users: 0, sent: 0, suppressed: 0 };

  const userIds = users.map((u) => u.user_id);
  const horizon = new Date(now.getTime() + 24 * 60 * 60_000);

  const [prefsRes, shiftsRes, eventsRes] = await Promise.all([
    supabaseAdmin
      .from("user_prefs")
      .select(
        "user_id, wind_down_min, sleep_hours, notifications, low_light, lat, lon, location_label, partner_name, cycle_weeks, cycle_anchor",
      )
      .in("user_id", userIds),
    supabaseAdmin
      .from("shifts")
      .select("id, user_id, day, week_index, start_min, end_min, employer_id, title, notes")
      .in("user_id", userIds),
    supabaseAdmin
      .from("user_events")
      .select("id, user_id, kind, title, starts_at, reminder_min, travel_buffer_min")
      .in("user_id", userIds)
      .gte("starts_at", new Date(now.getTime() - 60 * 60_000).toISOString())
      .lte("starts_at", horizon.toISOString()),
  ]);

  const prefsByUser = new Map<string, Prefs>();
  for (const r of (prefsRes.data ?? []) as PrefsRow[]) {
    prefsByUser.set(r.user_id, rowToPrefs(r));
  }
  const shiftsByUser = new Map<string, Shift[]>();
  for (const r of (shiftsRes.data ?? []) as Array<{
    id: string;
    user_id: string;
    day: number;
    week_index: number | null;
    start_min: number;
    end_min: number;
    employer_id: string | null;
    title: string | null;
    notes: string | null;
  }>) {
    const arr = shiftsByUser.get(r.user_id) ?? [];
    arr.push({
      id: r.id,
      day: r.day,
      weekIndex: r.week_index ?? 0,
      start: r.start_min,
      end: r.end_min,
      employerId: r.employer_id,
      title: r.title,
      notes: r.notes,
    });
    shiftsByUser.set(r.user_id, arr);
  }
  const eventsByUser = new Map<string, Array<{
    id: string;
    kind: "calendar" | "commute" | "personal";
    title: string;
    starts_at: string;
    reminder_min: number;
    travel_buffer_min: number;
  }>>();
  for (const r of (eventsRes.data ?? []) as Array<{
    id: string;
    user_id: string;
    kind: "calendar" | "commute" | "personal";
    title: string;
    starts_at: string;
    reminder_min: number;
    travel_buffer_min: number;
  }>) {
    const arr = eventsByUser.get(r.user_id) ?? [];
    arr.push({
      id: r.id,
      kind: r.kind,
      title: r.title,
      starts_at: r.starts_at,
      reminder_min: r.reminder_min,
      travel_buffer_min: r.travel_buffer_min,
    });
    eventsByUser.set(r.user_id, arr);
  }

  let totalSent = 0;
  let totalSuppressed = 0;

  for (const notif of users) {
    const prefs = prefsByUser.get(notif.user_id);
    const shifts = shiftsByUser.get(notif.user_id) ?? [];
    const events = eventsByUser.get(notif.user_id) ?? [];
    if (!prefs) continue;
    if (shifts.length === 0 && events.length === 0) continue;

    const due = computeDueReminders({ shifts, prefs, notif, events, now });
    if (due.length === 0) continue;

    // Today-window log for cap + dedupe.
    const startOfDay = new Date(now.getTime() - 24 * 60 * 60_000);
    const { data: logRows } = await supabaseAdmin
      .from("notification_log")
      .select("kind, scheduled_for, sent_at")
      .eq("user_id", notif.user_id)
      .gte("scheduled_for", startOfDay.toISOString());

    const todayLog = (logRows ?? []) as Array<{
      kind: string;
      scheduled_for: string;
      sent_at: string | null;
    }>;
    const sentToday = todayLog.filter((r) => r.sent_at !== null).length;
    let sentSoFar = sentToday;

    for (const item of due) {
      const localMin = minuteOfDayInTz(item.scheduledFor, notif.timezone || "UTC");
      let suppressed: string | null = null;

      // Critical reminders (smart alarm) bypass quiet hours + daily cap by design.
      const critical = item.critical === true;

      if (!critical && isQuiet(localMin, notif.quiet_start, notif.quiet_end))
        suppressed = "quiet-hours";

      // 30-min dedupe — identical kind already logged within window
      if (!suppressed) {
        const dup = todayLog.find(
          (r) =>
            r.kind === item.kind &&
            Math.abs(new Date(r.scheduled_for).getTime() - item.scheduledFor.getTime()) <
              DEDUPE_WINDOW_MS,
        );
        if (dup) suppressed = "dedupe";
      }

      if (!critical && !suppressed && sentSoFar >= notif.daily_cap) suppressed = "cap";

      const baseLog = {
        user_id: notif.user_id,
        kind: item.kind,
        scheduled_for: item.scheduledFor.toISOString(),
      };

      if (suppressed) {
        await supabaseAdmin.from("notification_log").insert({
          ...baseLog,
          suppressed_reason: suppressed,
        });
        totalSuppressed += 1;
        continue;
      }

      const c = copyFor(item.kind as ReminderKind, { title: item.title });
      const url =
        item.kind === "calendar-prep" || item.kind === "commute-leave"
          ? "/events"
          : "/plan";
      const result = await sendPushToUser(notif.user_id, {
        title: c.title,
        body: c.body,
        tag: item.eventId ? `${item.kind}:${item.eventId}` : item.kind,
        kind: item.kind,
        url,
      });

      if (result.sent > 0) {
        await supabaseAdmin.from("notification_log").insert({
          ...baseLog,
          sent_at: new Date().toISOString(),
          title: c.title,
          body: c.body,
        });
        sentSoFar += 1;
        totalSent += 1;
      } else {
        await supabaseAdmin.from("notification_log").insert({
          ...baseLog,
          suppressed_reason: "no-subscription",
        });
        totalSuppressed += 1;
      }
    }
  }

  return { users: users.length, sent: totalSent, suppressed: totalSuppressed };
}
