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

    // Load display name from profile (RLS: user reads their own row).
    let displayName: string | null = null;
    let firstName: string | null = null;
    try {
      const { data: profile } = await context.supabase
        .from("profiles")
        .select("display_name")
        .eq("id", identity)
        .maybeSingle();
      const raw = (profile?.display_name ?? "").trim();
      if (raw) {
        displayName = raw;
        firstName = raw.split(/\s+/)[0] ?? null;
      }
    } catch {
      /* best-effort personalization; token still mints without a name */
    }

    const metadata = JSON.stringify({
      displayName,
      firstName,
    });

    const at = new AccessToken(apiKey, apiSecret, {
      identity,
      ttl: ttlSeconds,
      metadata,
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
    | "room-service"
    | "worker-heartbeat";
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

    // 7. signal-header — same endpoint, Authorization: Bearer instead of ?access_token.
    //    If both fail, LiveKit's key lookup itself is the problem (not encoding).
    if (httpsOrigin && signedToken) {
      try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 4000);
        const res = await fetch(`${httpsOrigin}/rtc/validate`, {
          method: "GET",
          headers: { Authorization: `Bearer ${signedToken}` },
          signal: ctrl.signal,
        });
        clearTimeout(t);
        const bodySnippet = (await res.text().catch(() => "")).slice(0, 160);
        checks.push({
          id: "signal-header",
          label: "LiveKit /rtc/validate via Bearer header",
          ok: res.status === 200,
          detail: `HTTP ${res.status} ${bodySnippet ? `— ${bodySnippet}` : ""}`.trim(),
        });
      } catch (e) {
        checks.push({
          id: "signal-header",
          label: "LiveKit /rtc/validate via Bearer header",
          ok: false,
          detail: e instanceof Error ? e.message : String(e),
        });
      }
    } else {
      checks.push({
        id: "signal-header",
        label: "LiveKit /rtc/validate via Bearer header",
        ok: false,
        detail: "Skipped — URL invalid or JWT not signed",
      });
    }

    // 8. jwt-detail — decode header + payload timestamps, plus a fingerprint of
    //    the secret bytes actually used to sign (proves no encoding transform).
    if (signedToken && apiSecret) {
      try {
        const [headerB64, payloadB64] = signedToken.split(".");
        const header = JSON.parse(Buffer.from(headerB64, "base64url").toString("utf-8")) as {
          alg?: string;
          typ?: string;
        };
        const payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf-8")) as {
          iat?: number;
          nbf?: number;
          exp?: number;
        };
        const nowSec = Math.floor(Date.now() / 1000);
        const iso = (s?: number) => (typeof s === "number" ? new Date(s * 1000).toISOString() : "?");
        const secretBytes = new TextEncoder().encode(apiSecret);
        const digest = await crypto.subtle.digest("SHA-256", secretBytes);
        const fp = Array.from(new Uint8Array(digest).slice(0, 4))
          .map((b) => b.toString(16).padStart(2, "0"))
          .join("");
        const algOk = header.alg === "HS256";
        checks.push({
          id: "jwt-detail",
          label: "JWT header + timing + secret fingerprint",
          ok: algOk,
          detail: `alg=${header.alg} typ=${header.typ ?? "?"} iat=${iso(payload.iat)} nbf=${iso(payload.nbf)} exp=${iso(payload.exp)} now=${new Date(nowSec * 1000).toISOString()} secretFp=${fp}`,
        });
      } catch (e) {
        checks.push({
          id: "jwt-detail",
          label: "JWT header + timing + secret fingerprint",
          ok: false,
          detail: e instanceof Error ? e.message : String(e),
        });
      }
    } else {
      checks.push({
        id: "jwt-detail",
        label: "JWT header + timing + secret fingerprint",
        ok: false,
        detail: "Skipped — no signed JWT or missing secret",
      });
    }

    // 9. room-service — hit a completely different LiveKit API (Twirp
    //    RoomService.ListRooms) using the SAME key/secret. If /rtc/validate
    //    fails but this succeeds, /rtc/validate is misconfigured on their side.
    if (httpsOrigin && apiKey && apiSecret) {
      try {
        const { RoomServiceClient } = await import("livekit-server-sdk");
        const client = new RoomServiceClient(httpsOrigin, apiKey, apiSecret);
        const rooms = await client.listRooms();
        checks.push({
          id: "room-service",
          label: "RoomService.ListRooms with same key/secret",
          ok: true,
          detail: `OK — ${rooms.length} room(s) visible`,
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        checks.push({
          id: "room-service",
          label: "RoomService.ListRooms with same key/secret",
          ok: false,
          detail: msg.slice(0, 200),
        });
      }
    } else {
      checks.push({
        id: "room-service",
        label: "RoomService.ListRooms with same key/secret",
        ok: false,
        detail: "Skipped — URL/key/secret missing",
      });
    }

    // 10. worker-heartbeat — dispatch an agent job into a temporary room and
    //     poll for a non-local participant to appear. Confirms a LiveKit
    //     Agent Worker is registered against this project and can be
    //     dispatched. If this fails but everything else passes, the
    //     agent-worker/ process has not been deployed (or is offline).
    if (httpsOrigin && apiKey && apiSecret) {
      const hbRoom = `pilot-heartbeat-${identity}-${Date.now().toString(36)}`;
      let workerJoined = false;
      let detail = "";
      let roomServiceClient: unknown = null;
      try {
        const { AgentDispatchClient, RoomServiceClient } = await import(
          "livekit-server-sdk"
        );
        const dispatch = new AgentDispatchClient(httpsOrigin, apiKey, apiSecret);
        const rooms = new RoomServiceClient(httpsOrigin, apiKey, apiSecret);
        roomServiceClient = rooms;

        // Empty agent name → dispatch to any available worker registered
        // against this project. Matches how LiveKit auto-dispatches to the
        // default `defineAgent` export in agent-worker/worker.ts.
        await dispatch.createDispatch(hbRoom, "");

        // Poll for up to ~5s. Worker cold-start on LiveKit Cloud is
        // typically < 2s; give it a bit of headroom.
        const deadline = Date.now() + 5000;
        while (Date.now() < deadline) {
          await new Promise((r) => setTimeout(r, 500));
          try {
            const parts = await rooms.listParticipants(hbRoom);
            if (parts.length > 0) {
              workerJoined = true;
              detail = `Worker joined as "${parts[0].identity}" in ${((5000 - (deadline - Date.now())) / 1000).toFixed(1)}s`;
              break;
            }
          } catch {
            /* room may not exist yet; keep polling */
          }
        }
        if (!workerJoined) {
          detail =
            "No worker joined within 5s. Deploy agent-worker/ (see agent-worker/README.md).";
        }
      } catch (e) {
        detail = `Dispatch failed: ${e instanceof Error ? e.message : String(e)}`;
      } finally {
        // Best-effort cleanup so heartbeat rooms don't accumulate.
        try {
          const rooms = roomServiceClient as
            | { deleteRoom: (name: string) => Promise<unknown> }
            | null;
          if (rooms) await rooms.deleteRoom(hbRoom);
        } catch {
          /* noop */
        }
      }
      checks.push({
        id: "worker-heartbeat",
        label: "Agent Worker is deployed and joins rooms",
        ok: workerJoined,
        detail,
      });
    } else {
      checks.push({
        id: "worker-heartbeat",
        label: "Agent Worker is deployed and joins rooms",
        ok: false,
        detail: "Skipped — URL/key/secret missing",
      });
    }

    return {
      ok: checks.every((c) => c.ok),
      checks,
      identity,
      room,
    };
  });
