// Lab-only: mint a short-lived Simli session token server-side so the
// SIMLI_API_KEY never reaches the browser. Gated behind /lab/* (noindex).

import { createFileRoute } from "@tanstack/react-router";
import { requireLabAccess } from "@/lib/api/lab-gate.server";

export const Route = createFileRoute("/api/lab/simli/session")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const denied = await requireLabAccess(request);
        if (denied) return denied;
        // Staff-only, but still third-party AI: same permission as everywhere.
        let labUserId = "";
        {
          const { requireUser } = await import("@/lib/api/auth.server");
          const auth = await requireUser(request);
          if ("response" in auth) return auth.response;
          const { requireAIConsent } = await import("@/lib/ai/consent.server");
          const refused = await requireAIConsent(auth.userId);
          if (refused) return refused;
          const { requireAIBudget } = await import("@/lib/ai/log.server");
          const overBudget = await requireAIBudget(auth.userId);
          if (overBudget) return overBudget;
          labUserId = auth.userId;
        }
        const apiKey = process.env.SIMLI_API_KEY;
        if (!apiKey) {
          return Response.json(
            { error: "SIMLI_API_KEY not configured on server." },
            { status: 500 },
          );
        }
        let body: { faceId?: string; maxSessionLength?: number; maxIdleTime?: number } = {};
        try { body = await request.json(); } catch { /* ok */ }

        const faceId = body.faceId?.trim();
        if (!faceId) {
          return Response.json({ error: "faceId required" }, { status: 400 });
        }

        const t0 = Date.now();
        const upstream = await fetch("https://api.simli.ai/compose/token", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-simli-api-key": apiKey,
          },
          body: JSON.stringify({
            faceId,
            apiVersion: "v2",
            handleSilence: true,
            maxSessionLength: Math.min(body.maxSessionLength ?? 300, 600),
            maxIdleTime: Math.min(body.maxIdleTime ?? 60, 300),
            audioInputFormat: "pcm16",
          }),
        });

        const text = await upstream.text();
        const ms = Date.now() - t0;

        if (!upstream.ok) {
          console.error(
            `[lab/simli/session] upstream_fail status=${upstream.status} ms=${ms} body=${text.slice(0, 240)}`,
          );
          return Response.json(
            { error: "Simli session refused", status: upstream.status, detail: text.slice(0, 500) },
            { status: 502 },
          );
        }
        {
          // Accrue a fixed estimate per session token against the daily cap.
          const { recordAIUsage, USAGE_ESTIMATE } = await import("@/lib/ai/log.server");
          await recordAIUsage(labUserId, {
            intent: "lab-simli-session",
            model: "simli/compose",
            promptTokens: USAGE_ESTIMATE.SESSION_MINT_TOKENS,
          });
        }
        console.log(`[lab/simli/session] ok faceId=${faceId} ms=${ms}`);
        return new Response(text, {
          headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
        });
      },
    },
  },
});
