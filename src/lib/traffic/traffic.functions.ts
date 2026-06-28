// Slice 12 — Step 3 (Traffic Intelligence). Server functions.
//
// Auth-gated via requireSupabaseAuth. RLS scopes every read/write to the
// signed-in user. No service-role usage on this surface.
//
// Surfaces:
//  - listTrafficDestinations     → returns saved Home / Work / custom places
//  - upsertTrafficDestination    → save or update a destination
//  - deleteTrafficDestination    → remove a destination
//  - geocodeTrafficQuery         → resolve a city/address/ZIP for manual entry
//  - getTrafficIntel             → returns the live alerts for the relevant
//                                   destination, comparing against baseline

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  deriveTrafficAlerts,
  type TrafficAlert,
} from "@/lib/traffic/intel";

const TRAFFIC_SKILL = "travel";

export type DestinationKind = "home" | "work" | "custom";

export interface TrafficDestinationDTO {
  id: string;
  kind: DestinationKind;
  label: string;
  address: string | null;
  lat: number;
  lon: number;
  baselineMin: number | null;
}

export type TrafficIntelDTO =
  | {
      ok: true;
      generatedAtISO: string;
      destination: TrafficDestinationDTO;
      origin: { lat: number; lon: number; label: string | null };
      currentMin: number;
      baselineMin: number | null;
      alternativeMin: number | null;
      distanceKm: number;
      alerts: TrafficAlert[];
    }
  | {
      ok: false;
      reason:
        | "skill_disabled"
        | "no_origin"
        | "no_destination"
        | "route_failed"
        | "no_alerts";
    };

async function isTravelEnabled(
  supabase: {
    from: (t: string) => {
      select: (s: string) => {
        eq: (c: string, v: string) => {
          eq: (c2: string, v2: string) => {
            maybeSingle: () => Promise<{ data: { status: string } | null }>;
          };
        };
      };
    };
  },
  userId: string,
): Promise<boolean> {
  const { data } = await supabase
    .from("companion_skills")
    .select("status")
    .eq("user_id", userId)
    .eq("skill", TRAFFIC_SKILL)
    .maybeSingle();
  if (!data) return true; // built-in default
  return data.status !== "disabled" && data.status !== "disconnected";
}

// ─── List ────────────────────────────────────────────────────────────────────
export const listTrafficDestinations = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<TrafficDestinationDTO[]> => {
    const { supabase, userId } = context;
    const { data, error } = await supabase
      .from("traffic_destinations")
      .select("id, kind, label, address, lat, lon, baseline_min")
      .eq("user_id", userId)
      .order("kind", { ascending: true });
    if (error) throw error;
    return (data ?? []).map((r) => {
      const row = r as {
        id: string;
        kind: string;
        label: string;
        address: string | null;
        lat: number;
        lon: number;
        baseline_min: number | null;
      };
      const kind: DestinationKind =
        row.kind === "home" || row.kind === "work" ? row.kind : "custom";
      return {
        id: row.id,
        kind,
        label: row.label,
        address: row.address,
        lat: Number(row.lat),
        lon: Number(row.lon),
        baselineMin: row.baseline_min,
      };
    });
  });

// ─── Upsert ──────────────────────────────────────────────────────────────────
const upsertSchema = z.object({
  id: z.string().uuid().optional(),
  kind: z.enum(["home", "work", "custom"]),
  label: z.string().trim().min(1).max(60),
  address: z.string().trim().max(200).optional(),
  lat: z.number().gte(-90).lte(90),
  lon: z.number().gte(-180).lte(180),
});
export const upsertTrafficDestination = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (data: {
      id?: string;
      kind: DestinationKind;
      label: string;
      address?: string;
      lat: number;
      lon: number;
    }) => upsertSchema.parse(data),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const lat = Math.round(data.lat * 1e4) / 1e4;
    const lon = Math.round(data.lon * 1e4) / 1e4;

    const row = {
      user_id: userId,
      kind: data.kind,
      label: data.label,
      address: data.address ?? null,
      lat,
      lon,
    } satisfies Record<string, unknown>;

    if (data.id) {
      const { error } = await supabase
        .from("traffic_destinations")
        .update(row)
        .eq("id", data.id)
        .eq("user_id", userId);
      if (error) throw error;
    } else {
      const { error } = await supabase
        .from("traffic_destinations")
        .insert(row);
      if (error) throw error;
    }

    // Mark the travel skill connected on first save so the master list reflects it.
    await supabase
      .from("companion_skills")
      .upsert(
        {
          user_id: userId,
          skill: TRAFFIC_SKILL,
          status: "connected",
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id,skill" },
      );
    return { ok: true as const };
  });

// ─── Delete ──────────────────────────────────────────────────────────────────
const deleteSchema = z.object({ id: z.string().uuid() });
export const deleteTrafficDestination = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { id: string }) => deleteSchema.parse(data))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { error } = await supabase
      .from("traffic_destinations")
      .delete()
      .eq("id", data.id)
      .eq("user_id", userId);
    if (error) throw error;
    return { ok: true as const };
  });

// ─── Geocode (manual entry) ──────────────────────────────────────────────────
const geocodeSchema = z.object({ query: z.string().trim().min(2).max(120) });
export const geocodeTrafficQuery = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { query: string }) => geocodeSchema.parse(data))
  .handler(async ({ data }) => {
    const { geocodeLocation } = await import("@/lib/weather.server");
    const hit = await geocodeLocation(data.query);
    if (!hit) return { ok: false as const };
    return { ok: true as const, ...hit };
  });

// ─── Get intel for the relevant destination ──────────────────────────────────
function destinationForPeriod(
  dests: ReadonlyArray<TrafficDestinationDTO>,
  period: "morning" | "afternoon" | "evening",
): TrafficDestinationDTO | null {
  if (dests.length === 0) return null;
  // Morning → Work first. Evening → Home first. Afternoon → whichever exists.
  const priority: DestinationKind[] =
    period === "morning"
      ? ["work", "custom", "home"]
      : period === "evening"
        ? ["home", "custom", "work"]
        : ["work", "home", "custom"];
  for (const kind of priority) {
    const hit = dests.find((d) => d.kind === kind);
    if (hit) return hit;
  }
  return dests[0];
}

const intelSchema = z.object({
  period: z.enum(["morning", "afternoon", "evening"]),
});
export const getTrafficIntel = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { period: "morning" | "afternoon" | "evening" }) =>
    intelSchema.parse(data),
  )
  .handler(async ({ data, context }): Promise<TrafficIntelDTO> => {
    const { supabase, userId } = context;
    const enabled = await isTravelEnabled(
      supabase as unknown as Parameters<typeof isTravelEnabled>[0],
      userId,
    );
    if (!enabled) return { ok: false, reason: "skill_disabled" };

    // Origin = user_prefs lat/lon (shared with Weather Intel; no extra prompt).
    const { data: prefsRow } = await supabase
      .from("user_prefs")
      .select("lat, lon, location_label")
      .eq("user_id", userId)
      .maybeSingle();
    const oLat = prefsRow?.lat != null ? Number(prefsRow.lat) : null;
    const oLon = prefsRow?.lon != null ? Number(prefsRow.lon) : null;
    if (oLat == null || oLon == null || (oLat === 0 && oLon === 0)) {
      return { ok: false, reason: "no_origin" };
    }

    const { data: dRows, error: dErr } = await supabase
      .from("traffic_destinations")
      .select("id, kind, label, address, lat, lon, baseline_min")
      .eq("user_id", userId);
    if (dErr) throw dErr;
    const dests: TrafficDestinationDTO[] = (dRows ?? []).map((r) => {
      const row = r as {
        id: string;
        kind: string;
        label: string;
        address: string | null;
        lat: number;
        lon: number;
        baseline_min: number | null;
      };
      const kind: DestinationKind =
        row.kind === "home" || row.kind === "work" ? row.kind : "custom";
      return {
        id: row.id,
        kind,
        label: row.label,
        address: row.address,
        lat: Number(row.lat),
        lon: Number(row.lon),
        baselineMin: row.baseline_min,
      };
    });
    if (dests.length === 0) return { ok: false, reason: "no_destination" };

    const dest = destinationForPeriod(dests, data.period);
    if (!dest) return { ok: false, reason: "no_destination" };

    const { fetchRouteSnapshot } = await import("@/lib/traffic.server");
    const snap = await fetchRouteSnapshot(oLat, oLon, dest.lat, dest.lon);
    if (!snap) return { ok: false, reason: "route_failed" };

    // Learn the baseline on first successful snapshot.
    let baseline = dest.baselineMin;
    if (baseline == null) {
      baseline = Math.max(1, Math.round(snap.primaryMin));
      await supabase
        .from("traffic_destinations")
        .update({ baseline_min: baseline })
        .eq("id", dest.id)
        .eq("user_id", userId);
    }

    const alerts = deriveTrafficAlerts({
      destinationKind: dest.kind,
      destinationLabel: dest.label,
      baselineMin: baseline,
      current: snap,
    });
    if (alerts.length === 0) return { ok: false, reason: "no_alerts" };

    return {
      ok: true,
      generatedAtISO: new Date().toISOString(),
      destination: { ...dest, baselineMin: baseline },
      origin: {
        lat: oLat,
        lon: oLon,
        label: (prefsRow?.location_label as string | null) ?? null,
      },
      currentMin: Math.round(snap.primaryMin),
      baselineMin: baseline,
      alternativeMin: snap.alternativeMin != null ? Math.round(snap.alternativeMin) : null,
      distanceKm: Math.round(snap.distanceKm * 10) / 10,
      alerts,
    };
  });
