// Server functions for wearable OAuth + sync. Auth-gated.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { WearableProvider, WearableSummary } from "./types";

const ProviderSchema = z.object({
  provider: z.enum(["fitbit", "oura"]),
});

function getOrigin(): string {
  // Production stable URL is preferred for redirect URIs registered with providers.
  // Fall back to env-provided PUBLIC_APP_URL or the live domain.
  return process.env.PUBLIC_APP_URL || "https://shift-rest-ai.lovable.app";
}

function redirectUriFor(provider: WearableProvider): string {
  return `${getOrigin()}/api/public/wearables/${provider}/callback`;
}

function randomString(len = 32): string {
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

async function pkcePair(): Promise<{ verifier: string; challenge: string }> {
  const verifier = randomString(48);
  const data = new TextEncoder().encode(verifier);
  const hash = await crypto.subtle.digest("SHA-256", data);
  const b64 = btoa(String.fromCharCode(...new Uint8Array(hash)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return { verifier, challenge: b64 };
}

export const startWearableOAuth = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { provider: WearableProvider }) => ProviderSchema.parse(data))
  .handler(async ({ data, context }) => {
    const { provider } = data;
    const redirectUri = redirectUriFor(provider);
    const state = `${context.userId}:${randomString(16)}`;

    if (provider === "fitbit") {
      const { buildAuthUrl } = await import("./fitbit.server");
      const { verifier, challenge } = await pkcePair();
      const url = buildAuthUrl({ redirectUri, state, codeChallenge: challenge });
      return { url, state, codeVerifier: verifier };
    }

    const { buildAuthUrl } = await import("./oura.server");
    const url = buildAuthUrl({ redirectUri, state });
    return { url, state, codeVerifier: null };
  });

export const disconnectWearable = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { provider: WearableProvider }) => ProviderSchema.parse(data))
  .handler(async ({ data, context }) => {
    await context.supabase
      .from("wearable_connections")
      .delete()
      .eq("user_id", context.userId)
      .eq("provider", data.provider);
    return { ok: true };
  });

export const syncWearableNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { provider: WearableProvider; date?: string }) =>
    ProviderSchema.extend({ date: z.string().optional() }).parse(data),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows, error } = await supabaseAdmin
      .from("wearable_connections")
      .select("*")
      .eq("user_id", context.userId)
      .eq("provider", data.provider)
      .limit(1);
    if (error) throw new Error(error.message);
    const row = rows?.[0];
    if (!row) throw new Error("Not connected");
    const { syncConnection } = await import("./sync.server");
    return syncConnection(supabaseAdmin, row, data.date);
  });

export const getWearableSummary = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<WearableSummary> => {
    const [{ data: connections }, { data: latestRows }] = await Promise.all([
      context.supabase
        .from("wearable_connections")
        .select("provider, last_sync_at, last_sync_error, scope")
        .eq("user_id", context.userId),
      context.supabase
        .from("wearable_readings")
        .select("*")
        .eq("user_id", context.userId)
        .order("date", { ascending: false })
        .order("fetched_at", { ascending: false })
        .limit(1),
    ]);

    const latest = latestRows?.[0];
    return {
      connections: (connections ?? []).map((c) => ({
        provider: c.provider as WearableProvider,
        connected: true,
        lastSyncAt: c.last_sync_at,
        lastSyncError: c.last_sync_error,
        scope: c.scope,
      })),
      latest: latest
        ? {
            provider: latest.provider as WearableProvider,
            date: latest.date,
            sleepStart: latest.sleep_start,
            sleepEnd: latest.sleep_end,
            sleepDurationMin: latest.sleep_duration_min,
            sleepEfficiency: latest.sleep_efficiency != null ? Number(latest.sleep_efficiency) : null,
            deepMin: latest.deep_min,
            remMin: latest.rem_min,
            lightMin: latest.light_min,
            hrvMs: latest.hrv_ms != null ? Number(latest.hrv_ms) : null,
            restingHr: latest.resting_hr,
          }
        : null,
    };
  });

// Phase 8 — read-only listing of recent nights for trend cards.
export const listWearableReadings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { days?: number } | undefined) =>
    z.object({ days: z.number().int().min(1).max(90).default(30) }).parse(d ?? {}),
  )
  .handler(async ({ data, context }) => {
    const since = new Date(Date.now() - data.days * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    const { data: rows, error } = await context.supabase
      .from("wearable_readings")
      .select("*")
      .eq("user_id", context.userId)
      .gte("date", since)
      .order("date", { ascending: true });
    if (error) throw new Error(error.message);
    return (rows ?? []).map((r) => ({
      provider: r.provider as WearableProvider,
      date: r.date,
      sleepStart: r.sleep_start,
      sleepEnd: r.sleep_end,
      sleepDurationMin: r.sleep_duration_min,
      sleepEfficiency: r.sleep_efficiency != null ? Number(r.sleep_efficiency) : null,
      deepMin: r.deep_min,
      remMin: r.rem_min,
      lightMin: r.light_min,
      hrvMs: r.hrv_ms != null ? Number(r.hrv_ms) : null,
      restingHr: r.resting_hr,
    }));
  });
