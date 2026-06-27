// Internal sync helpers — server-only. Refreshes tokens if needed,
// fetches the most recent night, and upserts a reading row.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import * as fitbit from "./fitbit.server";
import * as oura from "./oura.server";
import type { WearableProvider } from "./types";

type ConnectionRow = Database["public"]["Tables"]["wearable_connections"]["Row"];

function yesterdayISO(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

async function ensureFreshToken(
  supabase: SupabaseClient<Database>,
  row: ConnectionRow,
): Promise<string> {
  const expiresAt = row.expires_at ? new Date(row.expires_at).getTime() : 0;
  // Refresh if expiring within next 60s
  if (expiresAt - Date.now() > 60_000) return row.access_token;
  if (!row.refresh_token) throw new Error("No refresh token; reconnect required");

  const refreshed =
    row.provider === "fitbit"
      ? await fitbit.refreshToken(row.refresh_token)
      : await oura.refreshToken(row.refresh_token);

  const newExpiresAt = new Date(Date.now() + refreshed.expires_in * 1000).toISOString();
  await supabase
    .from("wearable_connections")
    .update({
      access_token: refreshed.access_token,
      refresh_token: refreshed.refresh_token ?? row.refresh_token,
      expires_at: newExpiresAt,
    })
    .eq("id", row.id);
  return refreshed.access_token;
}

export async function syncConnection(
  supabase: SupabaseClient<Database>,
  row: ConnectionRow,
  date: string = yesterdayISO(),
): Promise<{ ok: boolean; date: string; inserted: boolean; error?: string }> {
  try {
    const token = await ensureFreshToken(supabase, row);
    const night =
      row.provider === "fitbit"
        ? await fitbit.fetchLastNight(token, date)
        : await oura.fetchLastNight(token, date);

    if (!night) {
      await supabase
        .from("wearable_connections")
        .update({ last_sync_at: new Date().toISOString(), last_sync_error: null })
        .eq("id", row.id);
      return { ok: true, date, inserted: false };
    }

    await supabase.from("wearable_readings").upsert(
      {
        user_id: row.user_id,
        provider: row.provider as WearableProvider,
        date,
        sleep_start: night.sleepStart,
        sleep_end: night.sleepEnd,
        sleep_duration_min: night.durationMin,
        sleep_efficiency: night.efficiency,
        deep_min: night.deepMin,
        rem_min: night.remMin,
        light_min: night.lightMin,
        hrv_ms: night.hrvMs,
        resting_hr: night.restingHr,
        raw: night as unknown as Database["public"]["Tables"]["wearable_readings"]["Insert"]["raw"],
        fetched_at: new Date().toISOString(),
      },
      { onConflict: "user_id,provider,date" },
    );

    await supabase
      .from("wearable_connections")
      .update({ last_sync_at: new Date().toISOString(), last_sync_error: null })
      .eq("id", row.id);

    return { ok: true, date, inserted: true };
  } catch (e: any) {
    const msg = e?.message ?? String(e);
    await supabase
      .from("wearable_connections")
      .update({ last_sync_error: msg.slice(0, 500) })
      .eq("id", row.id);
    return { ok: false, date, inserted: false, error: msg };
  }
}
