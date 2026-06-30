// Slice 7 — Evening Brief server function.
// Parallel sub-fetches; failures hide their card. The AI summary is gated:
// it only runs when we have enough context (tomorrow event OR weather).

import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { fetchTomorrowWeather } from "@/lib/weather.server";
import type { EveningBriefDTO } from "./types";

function greetingName(preferredName: string | null): string {
  const raw = (preferredName ?? "").trim();
  if (!raw) return "there";
  return raw.split(/\s+/)[0].replace(/^./, (c) => c.toUpperCase());
}

function clothingFor(
  morningTempC: number | null,
  high: number,
  pop: number,
): EveningBriefDTO["clothing"] {
  if (pop >= 60) return { tone: "rain", hint: "Bring a rain layer." };
  const t = morningTempC ?? (high - 4);
  if (t <= 2) return { tone: "cold", hint: "Heavy coat in the morning." };
  if (t <= 10) return { tone: "cool", hint: "A warm jacket should do." };
  if (t <= 20) return { tone: "mild", hint: "A light layer works." };
  return { tone: "warm", hint: "Light clothing is fine." };
}

export const getEveningBrief = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<EveningBriefDTO> => {
    const { supabase, userId } = context;
    const now = new Date();

    const { data: prefsRow } = await supabase
      .from("user_prefs")
      .select(
        "lat, lon, partner_name, preferred_name, brief_layout, sleep_hours, wind_down_min",
      )
      .eq("user_id", userId)
      .maybeSingle();

    const lat = Number(prefsRow?.lat ?? 40.7128);
    const lon = Number(prefsRow?.lon ?? -74.006);
    const preferredName = (prefsRow?.preferred_name as string | null) ?? null;
    const sleepHours = Number(prefsRow?.sleep_hours ?? 8);
    const windDownMin = Number(prefsRow?.wind_down_min ?? 120);
    type Layout = { hidden?: string[] };
    const rawLayout = (prefsRow?.brief_layout as
      | { evening?: Layout }
      | Layout
      | null) ?? null;
    const eveningHidden = new Set<string>(
      (rawLayout && "evening" in (rawLayout as object)
        ? (rawLayout as { evening?: Layout }).evening?.hidden
        : undefined) ?? [],
    );


    // Tomorrow window in local time.
    const tomorrowStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    const tomorrowEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 2);

    const [eventsRes, weatherRes, tripRes] = await Promise.allSettled([
      eveningHidden.has("tomorrowFirst") && eveningHidden.has("prep") && eveningHidden.has("smartAlarm")
        ? Promise.resolve(null)
        : supabase
            .from("user_events")
            .select("id, title, starts_at, kind, location")
            .eq("user_id", userId)
            .gte("starts_at", tomorrowStart.toISOString())
            .lt("starts_at", tomorrowEnd.toISOString())
            .order("starts_at", { ascending: true })
            .limit(6),
      eveningHidden.has("tomorrowWeather") && eveningHidden.has("clothing")
        ? Promise.resolve(null)
        : fetchTomorrowWeather(lat, lon),
      eveningHidden.has("travel")
        ? Promise.resolve(null)
        : supabase
            .from("trips")
            .select("dest_label, depart_utc, status")
            .eq("user_id", userId)
            .eq("status", "planned")
            .gte("depart_utc", now.toISOString())
            .lt("depart_utc", tomorrowEnd.toISOString())
            .order("depart_utc", { ascending: true })
            .limit(1)
            .maybeSingle(),
    ]);

    type EventRow = { id: string; title: string; starts_at: string; kind: string; location: string | null };
    const events: EventRow[] =
      eventsRes.status === "fulfilled" && eventsRes.value && "data" in eventsRes.value
        ? ((eventsRes.value.data as EventRow[] | null) ?? [])
        : [];

    const tomorrowFirst = events[0] && !eveningHidden.has("tomorrowFirst")
      ? { title: events[0].title, atISO: events[0].starts_at, kind: events[0].kind }
      : null;

    const prep = events.length > 0 && !eveningHidden.has("prep")
      ? { count: events.length, firstTitle: events[0].title }
      : null;

    const tomorrowWeather =
      weatherRes.status === "fulfilled" && weatherRes.value
        ? weatherRes.value
        : null;

    const clothing =
      tomorrowWeather && !eveningHidden.has("clothing")
        ? clothingFor(
            tomorrowWeather.morningTempC,
            tomorrowWeather.high,
            tomorrowWeather.precipProbabilityMax,
          )
        : null;

    // Smart Alarm: derive from first event, or default to a 7:00 wake.
    let smartAlarm: EveningBriefDTO["smartAlarm"] = null;
    if (!eveningHidden.has("smartAlarm")) {
      let wakeISO: string;
      if (tomorrowFirst) {
        const wake = new Date(new Date(tomorrowFirst.atISO).getTime() - 60 * 60_000); // 1h before
        wakeISO = wake.toISOString();
      } else {
        const def = new Date(tomorrowStart);
        def.setHours(7, 0, 0, 0);
        wakeISO = def.toISOString();
      }
      const bedtime = new Date(new Date(wakeISO).getTime() - sleepHours * 3_600_000);
      smartAlarm = {
        suggestedWakeISO: wakeISO,
        suggestedBedtimeISO: bedtime.toISOString(),
        targetHours: sleepHours,
      };
    }

    let travel: EveningBriefDTO["travel"] = null;
    if (tripRes.status === "fulfilled" && tripRes.value && "data" in tripRes.value) {
      const t = tripRes.value.data as { dest_label: string | null; depart_utc: string } | null;
      if (t) travel = { destLabel: t.dest_label, departISO: t.depart_utc };
    }

    // Short, deterministic evening summary — no LLM call required.
    let summary: string | null = null;
    if (!eveningHidden.has("summary") && (tomorrowFirst || tomorrowWeather)) {
      const parts: string[] = [];
      if (tomorrowFirst) {
        const at = new Date(tomorrowFirst.atISO).toLocaleTimeString([], {
          hour: "numeric",
          minute: "2-digit",
        });
        parts.push(`Tomorrow starts with ${tomorrowFirst.title} at ${at}.`);
      }
      if (tomorrowWeather) {
        parts.push(
          `Expect ${tomorrowWeather.condition.toLowerCase()} with a high of ${Math.round(tomorrowWeather.high)}°.`,
        );
      }
      if (smartAlarm) {
        const bed = new Date(smartAlarm.suggestedBedtimeISO).toLocaleTimeString([], {
          hour: "numeric",
          minute: "2-digit",
        });
        parts.push(`Aim for lights out around ${bed}.`);
      }
      summary = parts.join(" ");
    }

    return {
      generatedAtISO: now.toISOString(),
      greetingName: firstName(email, partnerName),
      tomorrowFirst,
      tomorrowWeather: tomorrowWeather
        ? {
            high: tomorrowWeather.high,
            low: tomorrowWeather.low,
            morningTempC: tomorrowWeather.morningTempC,
            precipProbabilityMax: tomorrowWeather.precipProbabilityMax,
            condition: tomorrowWeather.condition,
            icon: tomorrowWeather.icon,
          }
        : null,
      clothing,
      smartAlarm,
      prep,
      travel,
      summary,
      windDownMin,
    };
  });
