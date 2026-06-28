// Slice 12 — Step 2 (Weather Intelligence). Server functions.
//
// - `getWeatherIntel` returns the current alerts list when the Weather
//   Intelligence skill is enabled AND the user has a stored location.
// - `setWeatherLocation` writes lat/lon (+ label) onto user_prefs and
//   marks the weather skill connected.
// - `geocodeWeatherQuery` resolves a manual city/ZIP entry.
//
// All three are user-scoped via `requireSupabaseAuth`. RLS scopes every
// read/write to the signed-in user. No service-role usage on this surface.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { deriveWeatherAlerts, type WeatherAlert } from "@/lib/weather/intel";

const WEATHER_SKILL = "weather_alerts";

export type WeatherIntelDTO = {
  ok: true;
  generatedAtISO: string;
  locationLabel: string | null;
  lat: number;
  lon: number;
  nowTempC: number;
  feelsLikeC: number | null;
  alerts: WeatherAlert[];
} | {
  ok: false;
  reason:
    | "skill_disabled"
    | "no_location"
    | "fetch_failed"
    | "no_alerts";
};

async function isWeatherSkillEnabled(
  supabase: { from: (t: string) => { select: (s: string) => { eq: (c: string, v: string) => { eq: (c2: string, v2: string) => { maybeSingle: () => Promise<{ data: { status: string } | null }> } } } } },
  userId: string,
): Promise<boolean> {
  // weather_alerts is built-in. Treat as enabled UNLESS explicitly "disabled".
  const { data } = await supabase
    .from("companion_skills")
    .select("status")
    .eq("user_id", userId)
    .eq("skill", WEATHER_SKILL)
    .maybeSingle();
  if (!data) return true; // no row → built-in default
  return data.status !== "disabled" && data.status !== "disconnected";
}

export const getWeatherIntel = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<WeatherIntelDTO> => {
    const { supabase, userId } = context;

    const enabled = await isWeatherSkillEnabled(
      supabase as unknown as Parameters<typeof isWeatherSkillEnabled>[0],
      userId,
    );
    if (!enabled) return { ok: false, reason: "skill_disabled" };

    const { data: prefsRow } = await supabase
      .from("user_prefs")
      .select("lat, lon, location_label")
      .eq("user_id", userId)
      .maybeSingle();

    const lat = prefsRow?.lat != null ? Number(prefsRow.lat) : null;
    const lon = prefsRow?.lon != null ? Number(prefsRow.lon) : null;
    const label = (prefsRow?.location_label as string | null) ?? null;
    if (lat == null || lon == null || (lat === 0 && lon === 0)) {
      return { ok: false, reason: "no_location" };
    }

    const { fetchWeatherIntel } = await import("@/lib/weather.server");
    const intel = await fetchWeatherIntel(lat, lon);
    if (!intel) return { ok: false, reason: "fetch_failed" };

    const alerts = deriveWeatherAlerts(intel);
    if (alerts.length === 0) {
      return { ok: false, reason: "no_alerts" };
    }

    return {
      ok: true,
      generatedAtISO: intel.generatedAtISO,
      locationLabel: label,
      lat,
      lon,
      nowTempC: intel.nowTempC,
      feelsLikeC: intel.feelsLikeC,
      alerts,
    };
  });

const setLocationSchema = z.object({
  lat: z.number().gte(-90).lte(90),
  lon: z.number().gte(-180).lte(180),
  label: z.string().trim().max(120).optional(),
});

export const setWeatherLocation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { lat: number; lon: number; label?: string }) =>
    setLocationSchema.parse(data),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    // Round to ~100m to limit precision stored.
    const lat = Math.round(data.lat * 1e4) / 1e4;
    const lon = Math.round(data.lon * 1e4) / 1e4;
    const label = (data.label ?? "").slice(0, 120);

    const patch: Record<string, unknown> = { user_id: userId, lat, lon };
    if (label) patch.location_label = label;
    const { error: prefsErr } = await supabase
      .from("user_prefs")
      .upsert(patch, { onConflict: "user_id" });
    if (prefsErr) throw prefsErr;

    // Mark the weather skill connected so the master list reflects it.
    await supabase
      .from("companion_skills")
      .upsert(
        {
          user_id: userId,
          skill: WEATHER_SKILL,
          status: "connected",
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id,skill" },
      );
    return { ok: true as const, lat, lon, label };
  });

const geocodeSchema = z.object({ query: z.string().trim().min(2).max(80) });
export const geocodeWeatherQuery = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { query: string }) => geocodeSchema.parse(data))
  .handler(async ({ data }) => {
    const { geocodeLocation } = await import("@/lib/weather.server");
    const hit = await geocodeLocation(data.query);
    if (!hit) return { ok: false as const };
    return { ok: true as const, ...hit };
  });
