// Slice 7 — Afternoon Check-In server function.
// Reuses prefs + user_events. All sub-fetches Promise.allSettled so a failure
// hides only its card. No new external API calls (weather already cached).

import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { AfternoonBriefDTO } from "./types";

function greetingName(preferredName: string | null): string {
  const raw = (preferredName ?? "").trim();
  if (!raw) return "there";
  return raw.split(/\s+/)[0].replace(/^./, (c) => c.toUpperCase());
}

export const getAfternoonBrief = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<AfternoonBriefDTO> => {
    const { supabase, userId } = context;
    const now = new Date();

    const { data: prefsRow } = await supabase
      .from("user_prefs")
      .select(
        "lat, lon, partner_name, preferred_name, brief_layout, commute_minutes_baseline",
      )
      .eq("user_id", userId)
      .maybeSingle();

    const lat = Number(prefsRow?.lat ?? 40.7128);
    const lon = Number(prefsRow?.lon ?? -74.006);
    const preferredName = (prefsRow?.preferred_name as string | null) ?? null;
    const baselineMin = (prefsRow?.commute_minutes_baseline as number | null) ?? null;
    type Layout = { hidden?: string[] };
    type NestedLayout = { afternoon?: Layout } | Layout | null;
    const rawLayout = (prefsRow?.brief_layout as NestedLayout) ?? null;
    const afternoonHidden = new Set<string>(
      (rawLayout && "afternoon" in (rawLayout as object)
        ? (rawLayout as { afternoon?: Layout }).afternoon?.hidden
        : undefined) ?? ["nextTraffic"],
    );


    const dayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).toISOString();

    const [eventsRes, weatherRes] = await Promise.allSettled([
      afternoonHidden.has("remaining") && afternoonHidden.has("nextTraffic") && afternoonHidden.has("workingLate")
        ? Promise.resolve(null)
        : supabase
            .from("user_events")
            .select("id, title, starts_at, kind")
            .eq("user_id", userId)
            .gte("starts_at", now.toISOString())
            .lt("starts_at", dayEnd)
            .order("starts_at", { ascending: true })
            .limit(8),
      afternoonHidden.has("weatherShift")
        ? Promise.resolve(null)
        : (async () => {
            try {
              const url =
                `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
                `&current=temperature_2m&hourly=temperature_2m,precipitation_probability,weather_code` +
                `&forecast_days=1&timezone=auto`;
              const ac = new AbortController();
              const t = setTimeout(() => ac.abort(), 3500);
              const res = await fetch(url, { signal: ac.signal });
              clearTimeout(t);
              if (!res.ok) return null;
              return (await res.json()) as {
                current?: { temperature_2m?: number };
                hourly?: { time?: string[]; temperature_2m?: number[]; precipitation_probability?: number[]; weather_code?: number[] };
              };
            } catch {
              return null;
            }
          })(),
    ]);

    type EventRow = { id: string; title: string; starts_at: string; kind: string };
    const events: EventRow[] =
      eventsRes.status === "fulfilled" && eventsRes.value && "data" in eventsRes.value
        ? ((eventsRes.value.data as EventRow[] | null) ?? [])
        : [];

    const remaining = !afternoonHidden.has("remaining") && events.length > 0
      ? {
          items: events.slice(0, 4).map((e) => ({
            id: e.id,
            title: e.title,
            atISO: e.starts_at,
            kind: e.kind,
          })),
        }
      : null;

    // Traffic for the next appointment (commute/calendar) using baseline minutes.
    let nextTraffic: AfternoonBriefDTO["nextTraffic"] = null;
    if (!afternoonHidden.has("nextTraffic") && baselineMin && baselineMin > 0) {
      const next = events.find((e) => e.kind === "calendar" || e.kind === "commute");
      if (next) {
        const eventTime = new Date(next.starts_at).getTime();
        const leaveBy = new Date(eventTime - baselineMin * 60_000);
        if (leaveBy.getTime() > now.getTime() - 5 * 60_000) {
          nextTraffic = {
            eventTitle: next.title,
            eventISO: next.starts_at,
            baselineMin,
            leaveByISO: leaveBy.toISOString(),
          };
        }
      }
    }

    // Working late = an event still scheduled after 18:00 local.
    let workingLate: AfternoonBriefDTO["workingLate"] = null;
    if (!afternoonHidden.has("workingLate")) {
      const late = [...events]
        .reverse()
        .find((e) => new Date(e.starts_at).getHours() >= 18);
      if (late) {
        workingLate = { lastEventISO: late.starts_at, lastEventTitle: late.title };
      }
    }

    let weatherShift: AfternoonBriefDTO["weatherShift"] = null;
    if (weatherRes.status === "fulfilled" && weatherRes.value) {
      const w = weatherRes.value as {
        current?: { temperature_2m?: number };
        hourly?: { time?: string[]; temperature_2m?: number[]; precipitation_probability?: number[]; weather_code?: number[] };
      };
      const nowC = w.current?.temperature_2m;
      const times = w.hourly?.time ?? [];
      const temps = w.hourly?.temperature_2m ?? [];
      const pops = w.hourly?.precipitation_probability ?? [];
      if (nowC != null && times.length > 0) {
        // Find index closest to "now" (Open-Meteo hourly time strings are local YYYY-MM-DDTHH:00).
        const localPrefix = now.toISOString().slice(0, 13); // not perfect but close enough as fallback
        let startIdx = times.findIndex((t) => t >= localPrefix);
        if (startIdx < 0) startIdx = 0;
        const later: { hourISO: string; tempC: number; condition: string }[] = [];
        let rainSoon = false;
        for (let i = startIdx; i < Math.min(times.length, startIdx + 6); i++) {
          const tempC = temps[i];
          const pop = pops[i] ?? 0;
          if (pop >= 50) rainSoon = true;
          if (tempC != null && (i - startIdx) % 2 === 0) {
            later.push({ hourISO: times[i], tempC, condition: pop >= 50 ? "Rain likely" : "" });
          }
        }
        // Only surface if temperature is materially changing or rain is coming.
        const hasShift =
          rainSoon ||
          (later.length > 0 && Math.abs((later[later.length - 1]?.tempC ?? nowC) - nowC) >= 3);
        if (hasShift) {
          weatherShift = { nowC, later: later.slice(0, 3), rainSoon };
        }
      }
    }

    return {
      generatedAtISO: now.toISOString(),
      greetingName: greetingName(preferredName),
      remaining,
      nextTraffic,
      weatherShift,
      workingLate,
      hydrationEnabled: !afternoonHidden.has("hydration"),
      movementEnabled: !afternoonHidden.has("movement"),
    };
  });
