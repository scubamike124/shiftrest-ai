/**
 * Realtime Pilot — Phase 1 hidden foundation.
 *
 * Mints short-lived LiveKit JWTs so the beta client can join a per-user
 * LiveKit room. The LiveKit Agent worker (external, runs on LiveKit Cloud)
 * joins the same room and bridges audio to OpenAI Realtime.
 *
 * Nothing here is called by production paths. The `/lab/pilot-realtime`
 * route is the only caller, and it is itself gated by ENABLE_REALTIME_PILOT.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type RealtimeTokenResult = {
  url: string;
  token: string;
  room: string;
  identity: string;
  expiresAt: number;
};

export const mintRealtimePilotToken = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<RealtimeTokenResult> => {
    const url = process.env.LIVEKIT_URL;
    const apiKey = process.env.LIVEKIT_API_KEY;
    const apiSecret = process.env.LIVEKIT_API_SECRET;
    if (!url || !apiKey || !apiSecret) {
      throw new Error("Realtime pilot is not configured");
    }

    // Lazy import — livekit-server-sdk is server-only.
    const { AccessToken } = await import("livekit-server-sdk");

    const identity = context.userId;
    const room = `pilot-${identity}`;
    const ttlSeconds = 90;

    const at = new AccessToken(apiKey, apiSecret, {
      identity,
      ttl: ttlSeconds,
    });
    at.addGrant({
      room,
      roomJoin: true,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
    });

    const token = await at.toJwt();
    return {
      url,
      token,
      room,
      identity,
      expiresAt: Date.now() + ttlSeconds * 1000,
    };
  });
