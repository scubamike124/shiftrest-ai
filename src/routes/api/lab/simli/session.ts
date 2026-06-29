// Lab-only: mint a short-lived Simli session token server-side so the
// SIMLI_API_KEY never reaches the browser. Gated behind /lab/* (noindex).

import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/lab/simli/session")({
  server: {
    handlers: {
      POST: async ({ request }) => {
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
        console.log(`[lab/simli/session] ok faceId=${faceId} ms=${ms}`);
        return new Response(text, {
          headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
        });
      },
    },
  },
});
