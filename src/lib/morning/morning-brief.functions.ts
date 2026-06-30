// Slice 6 — Smart Morning Intelligence
// Single auth-gated server function that composes the Morning Brief payload.
// Each sub-fetch is wrapped in Promise.allSettled — a failure hides only that
// card; the rest of the brief still renders.

import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { MorningBriefDTO } from "./types";

const ALLOWED_MEMORY_CATEGORIES = new Set([
  "sleep_habits",
  "alarm_prefs",
  "daily_routine",
  "favorite_sounds",
]);

function hourBucket(h: number): "early" | "morning" | "midday" {
  if (h < 7) return "early";
  if (h < 10) return "morning";
  return "midday";
}

function greetingName(preferredName: string | null): string {
  const raw = (preferredName ?? "").trim();
  if (!raw) return "there";
  return raw.split(/\s+/)[0].replace(/^./, (c) => c.toUpperCase());
}

function scoreSleep(durationMin: number, efficiency: number | null, targetHours: number): number {
  const targetMin = targetHours * 60;
  const durRatio = Math.min(1, durationMin / targetMin); // 0..1
  const eff = efficiency == null ? 0.88 : Math.min(1, Math.max(0, efficiency));
  return Math.round((durRatio * 0.7 + eff * 0.3) * 100);
}

function pickRecommendation(
  sleepDurationMin: number | null,
  targetHours: number,
): string | null {
  if (sleepDurationMin != null) {
    const deficit = targetHours - sleepDurationMin / 60;
    if (deficit >= 1.5) return "You slept less than usual. Consider an earlier bedtime tonight.";
    if (deficit <= -0.5) return "Solid rest last night — great foundation for today.";
  }
  return null;
}

export const getMorningBrief = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<MorningBriefDTO> => {
    const { supabase, userId } = context;
    const now = new Date();

    // 1. Prefs (sequential — every card needs them).
    const { data: prefsRow } = await supabase
      .from("user_prefs")
      .select(
        "sleep_hours, lat, lon, partner_name, preferred_name, memory_enabled, memory_learning_paused, brief_layout, commute_minutes_baseline",
      )
      .eq("user_id", userId)
      .maybeSingle();

    const sleepHours = Number(prefsRow?.sleep_hours ?? 8);
    const lat = Number(prefsRow?.lat ?? 40.7128);
    const lon = Number(prefsRow?.lon ?? -74.006);
    const preferredName = (prefsRow?.preferred_name as string | null) ?? null;
    const layout = (prefsRow?.brief_layout as { hidden?: string[] } | null) ?? null;
    const hidden = new Set(layout?.hidden ?? ["departure"]);
    const baselineMin = (prefsRow?.commute_minutes_baseline as number | null) ?? null;
    const memoryOn = Boolean(
      prefsRow?.memory_enabled && !prefsRow?.memory_learning_paused,
    );




    // 3. Parallel sub-fetches — Promise.allSettled so one failure ≠ whole brief.
    const [wearableRes, eventsRes, weatherRes, memoryRes] = await Promise.allSettled([
      hidden.has("sleep")
        ? Promise.resolve(null)
        : supabase
            .from("wearable_readings")
            .select("provider, sleep_duration_min, sleep_efficiency, date")
            .eq("user_id", userId)
            .order("date", { ascending: false })
            .order("fetched_at", { ascending: false })
            .limit(1)
            .maybeSingle(),
      hidden.has("longclock") && hidden.has("departure")
        ? Promise.resolve(null)
        : (() => {
            const startIso = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
            const endIso = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).toISOString();
            return supabase
              .from("user_events")
              .select("id, title, starts_at, kind")
              .eq("user_id", userId)
              .gte("starts_at", startIso)
              .lt("starts_at", endIso)
              .order("starts_at", { ascending: true })
              .limit(6);
          })(),
      hidden.has("weather")
        ? Promise.resolve(null)
        : (async () => {
            const { fetchCurrentWeather } = await import("@/lib/weather.server");
            return fetchCurrentWeather(lat, lon);
          })(),
      memoryOn
        ? supabase
            .from("ai_memory")
            .select("content, category, confidence, importance, pinned")
            .eq("user_id", userId)
            .is("superseded_by", null)
            .gte("confidence", 0.7)
            .order("pinned", { ascending: false })
            .order("importance", { ascending: false })
            .limit(8)
        : Promise.resolve(null),
    ]);

    // Sleep
    let sleep: MorningBriefDTO["sleep"] = null;
    if (wearableRes.status === "fulfilled" && wearableRes.value && !("error" in wearableRes.value && wearableRes.value.error)) {
      const row = (wearableRes.value as { data?: { sleep_duration_min: number | null; sleep_efficiency: number | string | null } | null }).data ?? null;
      const durationMin = row?.sleep_duration_min ?? null;
      if (durationMin && durationMin > 60) {
        const eff = row?.sleep_efficiency != null ? Number(row.sleep_efficiency) : null;
        sleep = {
          durationMin,
          score: scoreSleep(durationMin, eff, sleepHours),
          source: "wearable",
        };
      }
    }

    // Events / Long Clock / Departure
    type EventRow = { id: string; title: string; starts_at: string; kind: string };
    const events: EventRow[] =
      eventsRes.status === "fulfilled" && eventsRes.value && "data" in eventsRes.value
        ? ((eventsRes.value.data as EventRow[] | null) ?? [])
        : [];

    const longclock = events.length > 0 && !hidden.has("longclock")
      ? {
          items: events.slice(0, 4).map((e) => ({
            id: e.id,
            title: e.title,
            atISO: e.starts_at,
            kind: e.kind,
          })),
        }
      : null;

    let departure: MorningBriefDTO["departure"] = null;
    if (!hidden.has("departure") && baselineMin && baselineMin > 0) {
      const firstCommuteOrCalendar = events.find(
        (e) => e.kind === "commute" || e.kind === "calendar",
      );
      if (firstCommuteOrCalendar) {
        const eventTime = new Date(firstCommuteOrCalendar.starts_at).getTime();
        const leaveBy = new Date(eventTime - baselineMin * 60_000);
        if (leaveBy.getTime() > now.getTime() - 10 * 60_000) {
          departure = {
            leaveByISO: leaveBy.toISOString(),
            firstEventISO: firstCommuteOrCalendar.starts_at,
            firstEventTitle: firstCommuteOrCalendar.title,
            baselineMin,
          };
        }
      }
    }

    // Weather
    let weather: MorningBriefDTO["weather"] = null;
    if (weatherRes.status === "fulfilled" && weatherRes.value) {
      const w = weatherRes.value as { tempC: number; high: number; low: number; condition: string; icon: string };
      weather = {
        tempC: w.tempC,
        high: w.high,
        low: w.low,
        condition: w.condition,
        icon: w.icon,
      };
    }

    // Memory line — at most one, plain sentence already stored in `content`.
    let memoryLine: string | null = null;
    if (memoryOn && memoryRes.status === "fulfilled" && memoryRes.value && "data" in memoryRes.value) {
      type MemRow = { content: string; category: string; confidence: number; importance: number; pinned: boolean };
      const rows = (memoryRes.value.data as MemRow[] | null) ?? [];
      const filtered = rows.filter((r) => ALLOWED_MEMORY_CATEGORIES.has(r.category));
      if (filtered.length > 0) {
        memoryLine = filtered[0].content.trim().slice(0, 160);
      }
    }

    return {
      generatedAtISO: now.toISOString(),
      greeting: {
        name: greetingName(preferredName),
        hourBucket: hourBucket(now.getHours()),
        recommendation: pickRecommendation(sleep?.durationMin ?? null, sleepHours),
      },
      sleep,
      weather,
      longclock,
      departure,
      memoryLine,
    };
  });
