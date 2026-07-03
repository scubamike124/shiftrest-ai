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

/**
 * Preflight — Phase 3A.
 *
 * Verifies server-side config and JWT signing WITHOUT the client attempting
 * a WebRTC connection. Surfaces per-check pass/fail so we can catch a
 * misconfigured LiveKit env before deploying the external agent worker.
 *
 * Checks:
 *  1. All four env vars present.
 *  2. LIVEKIT_URL parses as a `wss://…` (or `ws://…`) URL.
 *  3. `AccessToken` mints a token that decodes to a JWT with the expected
 *     identity, room grant, and TTL.
 *  4. LiveKit HTTPS endpoint responds — a quick reachability probe against
 *     the derived `https://` origin's `/rtc/validate` route (LiveKit returns
 *     400 for a bogus token, which proves the server is up and answering).
 */
export type RealtimePreflightCheck = {
  id:
    | "env"
    | "url"
    | "jwt"
    | "reachability"
    | "identity"
    | "signal"
    | "signal-header"
    | "jwt-detail"
    | "room-service";
  label: string;
  ok: boolean;
  detail: string;
};

export type RealtimePreflightResult = {
  ok: boolean;
  checks: RealtimePreflightCheck[];
  identity: string;
  room: string;
};

export const realtimePreflight = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<RealtimePreflightResult> => {
    const url = process.env.LIVEKIT_URL;
    const apiKey = process.env.LIVEKIT_API_KEY;
    const apiSecret = process.env.LIVEKIT_API_SECRET;
    const openaiKey = process.env.OPENAI_REALTIME_API_KEY;

    const checks: RealtimePreflightCheck[] = [];
    const identity = context.userId;
    const room = `pilot-${identity}`;

    // 1. env
    const missing = [
      !url && "LIVEKIT_URL",
      !apiKey && "LIVEKIT_API_KEY",
      !apiSecret && "LIVEKIT_API_SECRET",
      !openaiKey && "OPENAI_REALTIME_API_KEY",
    ].filter(Boolean);
    checks.push({
      id: "env",
      label: "Server env vars present",
      ok: missing.length === 0,
      detail:
        missing.length === 0
          ? "LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET, OPENAI_REALTIME_API_KEY all set"
          : `Missing: ${missing.join(", ")}`,
    });

    // 2. url shape
    let httpsOrigin: string | null = null;
    if (url) {
      try {
        const parsed = new URL(url);
        const scheme = parsed.protocol;
        const okScheme = scheme === "wss:" || scheme === "ws:";
        httpsOrigin = `${scheme === "wss:" ? "https:" : "http:"}//${parsed.host}`;
        checks.push({
          id: "url",
          label: "LIVEKIT_URL is a valid WebSocket URL",
          ok: okScheme,
          detail: okScheme
            ? `${parsed.protocol}//${parsed.host}`
            : `Unexpected scheme "${scheme}" (want ws:/wss:)`,
        });
      } catch (e) {
        checks.push({
          id: "url",
          label: "LIVEKIT_URL is a valid WebSocket URL",
          ok: false,
          detail: `Parse error: ${e instanceof Error ? e.message : String(e)}`,
        });
      }
    } else {
      checks.push({ id: "url", label: "LIVEKIT_URL is a valid WebSocket URL", ok: false, detail: "LIVEKIT_URL is missing" });
    }

    // 3. jwt sign + decode
    let signedToken: string | null = null;
    if (apiKey && apiSecret) {
      try {
        const { AccessToken } = await import("livekit-server-sdk");
        const at = new AccessToken(apiKey, apiSecret, { identity, ttl: 60 });
        at.addGrant({ room, roomJoin: true, canPublish: true, canSubscribe: true, canPublishData: true });
        signedToken = await at.toJwt();
        const parts = signedToken.split(".");
        if (parts.length !== 3) throw new Error("JWT does not have 3 parts");
        const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf-8")) as {
          sub?: string;
          video?: { room?: string; roomJoin?: boolean };
          exp?: number;
        };
        const okIdentity = payload.sub === identity;
        const okRoom = payload.video?.room === room && payload.video?.roomJoin === true;
        const okTtl = typeof payload.exp === "number" && payload.exp * 1000 > Date.now();
        const ok = okIdentity && okRoom && okTtl;
        checks.push({
          id: "jwt",
          label: "AccessToken signs and decodes correctly",
          ok,
          detail: ok
            ? `identity=${payload.sub}, room=${payload.video?.room}, ttl=${payload.exp ? Math.round(payload.exp - Date.now() / 1000) : "?"}s`
            : `identity=${payload.sub}, room=${payload.video?.room}, expOk=${okTtl}`,
        });
      } catch (e) {
        checks.push({
          id: "jwt",
          label: "AccessToken signs and decodes correctly",
          ok: false,
          detail: e instanceof Error ? e.message : String(e),
        });
      }
    } else {
      checks.push({ id: "jwt", label: "AccessToken signs and decodes correctly", ok: false, detail: "Missing LIVEKIT_API_KEY or LIVEKIT_API_SECRET" });
    }

    // 4. reachability probe (best effort, 3s timeout)
    if (httpsOrigin) {
      try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 3000);
        const res = await fetch(`${httpsOrigin}/`, { method: "GET", signal: ctrl.signal });
        clearTimeout(t);
        // LiveKit's root typically returns 200 or 404; either proves the
        // server is reachable. What matters is that the fetch didn't throw.
        checks.push({
          id: "reachability",
          label: "LiveKit host is reachable",
          ok: true,
          detail: `HTTP ${res.status} from ${httpsOrigin}`,
        });
      } catch (e) {
        checks.push({
          id: "reachability",
          label: "LiveKit host is reachable",
          ok: false,
          detail: e instanceof Error ? e.message : String(e),
        });
      }
    } else {
      checks.push({ id: "reachability", label: "LiveKit host is reachable", ok: false, detail: "Skipped — URL invalid" });
    }

    // 5. identity — non-sensitive fingerprint of the key/secret + JWT issuer.
    //    Lets us confirm the deployed Worker is actually using the values we
    //    just pasted (catches stale env / trimming / wrong-project mismatch)
    //    WITHOUT exposing the secret.
    if (apiKey && apiSecret) {
      const keyPrefix = apiKey.slice(0, 6);
      const keyLen = apiKey.length;
      const secLen = apiSecret.length;
      const keyTrimmed = apiKey.trim().length === keyLen;
      const secTrimmed = apiSecret.trim().length === secLen;
      let issuer: string | null = null;
      if (signedToken) {
        try {
          const payload = JSON.parse(
            Buffer.from(signedToken.split(".")[1], "base64url").toString("utf-8"),
          ) as { iss?: string };
          issuer = payload.iss ?? null;
        } catch {
          issuer = null;
        }
      }
      const issuerMatches = issuer === apiKey;
      checks.push({
        id: "identity",
        label: "Key fingerprint + JWT issuer",
        ok: issuerMatches && keyTrimmed && secTrimmed,
        detail: `keyPrefix=${keyPrefix} keyLen=${keyLen} secretLen=${secLen} jwtIss=${
          issuer ? issuer.slice(0, 6) : "?"
        } issuerMatchesKey=${issuerMatches} trimmed=${keyTrimmed && secTrimmed}`,
      });
    } else {
      checks.push({
        id: "identity",
        label: "Key fingerprint + JWT issuer",
        ok: false,
        detail: "Skipped — key or secret missing",
      });
    }

    // 6. signal probe — hit LiveKit's /rtc/validate with the freshly minted
    //    JWT. This is the SAME check the browser signal socket does; if the
    //    project rejects the key/signature we see it here without any WebRTC.
    if (httpsOrigin && signedToken) {
      try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 4000);
        const probeUrl = `${httpsOrigin}/rtc/validate?access_token=${encodeURIComponent(signedToken)}`;
        const res = await fetch(probeUrl, { method: "GET", signal: ctrl.signal });
        clearTimeout(t);
        const bodySnippet = (await res.text().catch(() => "")).slice(0, 160);
        checks.push({
          id: "signal",
          label: "LiveKit signal accepts minted JWT",
          ok: res.status === 200,
          detail: `HTTP ${res.status} ${bodySnippet ? `— ${bodySnippet}` : ""}`.trim(),
        });
      } catch (e) {
        checks.push({
          id: "signal",
          label: "LiveKit signal accepts minted JWT",
          ok: false,
          detail: e instanceof Error ? e.message : String(e),
        });
      }
    } else {
      checks.push({
        id: "signal",
        label: "LiveKit signal accepts minted JWT",
        ok: false,
        detail: "Skipped — URL invalid or JWT not signed",
      });
    }

    return {
      ok: checks.every((c) => c.ok),
      checks,
      identity,
      room,
    };
  });
