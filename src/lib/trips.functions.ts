/**
 * Trips & tz-events — server functions, RLS-scoped to the signed-in user.
 *
 * Privacy contract
 * ────────────────
 * - Every write requires an authenticated session via `requireSupabaseAuth`.
 * - The middleware's `supabase` client carries the user's JWT, so RLS scopes
 *   reads and writes to `auth.uid()`. No service-role access is needed for
 *   ordinary CRUD.
 * - `recordTzEvent` only writes when the device tz actually changed since the
 *   last logged event. Callers are also responsible for not calling this when
 *   the user has `tz_auto_detect` disabled (Dashboard checks `prefs.tzAuto`).
 *
 * Trip status lifecycle
 * ─────────────────────
 *   planned  → user has scheduled a future leg
 *   active   → arrive_utc ≤ now < depart of next leg (we don't auto-promote;
 *              the UI sets this when the user confirms they're on the trip)
 *   complete → user marked the leg as done, or arrive_utc + 7d has passed
 *   canceled → user dropped it
 *
 * We never auto-promote `planned` → `active` server-side because that would
 * trigger jet-lag advice based on a future flight the user may have moved.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type TripStatus = "planned" | "active" | "complete" | "canceled";
export type TripSource = "manual" | "calendar" | "device_tz";

export type Trip = {
  id: string;
  label: string | null;
  originTz: string;
  destTz: string;
  destLabel: string | null;
  destLat: number | null;
  destLon: number | null;
  departUtc: string;
  arriveUtc: string;
  status: TripStatus;
  source: TripSource;
  createdAt: string;
  updatedAt: string;
};

type TripRow = {
  id: string;
  label: string | null;
  origin_tz: string;
  dest_tz: string;
  dest_label: string | null;
  dest_lat: number | null;
  dest_lon: number | null;
  depart_utc: string;
  arrive_utc: string;
  status: string;
  source: string;
  created_at: string;
  updated_at: string;
};

function rowToTrip(r: TripRow): Trip {
  return {
    id: r.id,
    label: r.label,
    originTz: r.origin_tz,
    destTz: r.dest_tz,
    destLabel: r.dest_label,
    destLat: r.dest_lat,
    destLon: r.dest_lon,
    departUtc: r.depart_utc,
    arriveUtc: r.arrive_utc,
    status: (r.status as TripStatus) ?? "planned",
    source: (r.source as TripSource) ?? "manual",
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

type TripInput = {
  id?: string;
  label?: string | null;
  originTz: string;
  destTz: string;
  destLabel?: string | null;
  destLat?: number | null;
  destLon?: number | null;
  departUtc: string;
  arriveUtc: string;
  status?: TripStatus;
  source?: TripSource;
};

function validateTrip(t: TripInput): string | null {
  if (!t.originTz || !t.destTz) return "originTz and destTz are required";
  const dep = Date.parse(t.departUtc);
  const arr = Date.parse(t.arriveUtc);
  if (Number.isNaN(dep) || Number.isNaN(arr)) return "Invalid depart/arrive timestamp";
  if (arr < dep) return "Arrival must be on or after departure";
  // Sanity guard — > 30 day legs are almost certainly a typo, not a flight.
  if (arr - dep > 30 * 86_400_000) return "Trip leg longer than 30 days — split it into multiple trips";
  return null;
}

// ─────────────────────────── Trips CRUD ───────────────────────────

export const listTrips = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("trips")
      .select(
        "id, label, origin_tz, dest_tz, dest_label, dest_lat, dest_lon, depart_utc, arrive_utc, status, source, created_at, updated_at",
      )
      .eq("user_id", context.userId)
      .order("arrive_utc", { ascending: true });
    if (error) throw new Error(error.message);
    return ((data ?? []) as TripRow[]).map(rowToTrip);
  });

export const upsertTrip = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: TripInput) => data)
  .handler(async ({ data, context }) => {
    const err = validateTrip(data);
    if (err) throw new Error(err);
    const row = {
      user_id: context.userId,
      label: data.label ?? null,
      origin_tz: data.originTz,
      dest_tz: data.destTz,
      dest_label: data.destLabel ?? null,
      dest_lat: data.destLat ?? null,
      dest_lon: data.destLon ?? null,
      depart_utc: data.departUtc,
      arrive_utc: data.arriveUtc,
      status: data.status ?? "planned",
      source: data.source ?? "manual",
    };
    if (data.id) {
      const { data: updated, error } = await context.supabase
        .from("trips")
        .update(row)
        .eq("id", data.id)
        .eq("user_id", context.userId)
        .select(
          "id, label, origin_tz, dest_tz, dest_label, dest_lat, dest_lon, depart_utc, arrive_utc, status, source, created_at, updated_at",
        )
        .single();
      if (error) throw new Error(error.message);
      return rowToTrip(updated as TripRow);
    }
    const { data: inserted, error } = await context.supabase
      .from("trips")
      .insert(row)
      .select(
        "id, label, origin_tz, dest_tz, dest_label, dest_lat, dest_lon, depart_utc, arrive_utc, status, source, created_at, updated_at",
      )
      .single();
    if (error) throw new Error(error.message);
    return rowToTrip(inserted as TripRow);
  });

export const setTripStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { id: string; status: TripStatus }) => data)
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("trips")
      .update({ status: data.status })
      .eq("id", data.id)
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

export const deleteTrip = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { id: string }) => data)
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("trips")
      .delete()
      .eq("id", data.id)
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

// ─────────────────────────── tz_events ───────────────────────────

export type TzEvent = {
  id: string;
  fromTz: string | null;
  toTz: string;
  detectedAt: string;
  source: string;
  confidence: number;
};

/**
 * Append a tz change to the ledger if the destination differs from the most
 * recent recorded tz. Silent no-op on no-change so we don't spam the table
 * on every dashboard mount.
 */
export const recordTzEvent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { toTz: string; source?: "device_tz" | "manual" | "calendar"; confidence?: number }) => data)
  .handler(async ({ data, context }) => {
    const toTz = (data.toTz ?? "").trim();
    if (!toTz) throw new Error("toTz required");
    const { data: latest } = await context.supabase
      .from("tz_events")
      .select("to_tz")
      .eq("user_id", context.userId)
      .order("detected_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const previousTz = (latest as { to_tz: string } | null)?.to_tz ?? null;
    if (previousTz === toTz) return { changed: false as const };
    const { error } = await context.supabase.from("tz_events").insert({
      user_id: context.userId,
      from_tz: previousTz,
      to_tz: toTz,
      source: data.source ?? "device_tz",
      confidence: typeof data.confidence === "number" ? data.confidence : 1,
    });
    if (error) throw new Error(error.message);
    return { changed: true as const, fromTz: previousTz, toTz };
  });

export const listRecentTzEvents = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { limit?: number } | undefined) => data ?? {})
  .handler(async ({ data, context }) => {
    const limit = Math.min(Math.max(data.limit ?? 10, 1), 50);
    const { data: rows, error } = await context.supabase
      .from("tz_events")
      .select("id, from_tz, to_tz, detected_at, source, confidence")
      .eq("user_id", context.userId)
      .order("detected_at", { ascending: false })
      .limit(limit);
    if (error) throw new Error(error.message);
    return ((rows ?? []) as Array<{
      id: string; from_tz: string | null; to_tz: string;
      detected_at: string; source: string; confidence: number;
    }>).map((r) => ({
      id: r.id,
      fromTz: r.from_tz,
      toTz: r.to_tz,
      detectedAt: r.detected_at,
      source: r.source,
      confidence: r.confidence,
    } satisfies TzEvent));
  });
