/**
 * Legacy /api/brief — kept for backward compatibility.
 * Forwards to /api/ai (intent: "brief").
 */
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/brief")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const body = await request.text();
        let parsed: { plan?: string } = {};
        try {
          parsed = JSON.parse(body);
        } catch {
          return new Response(JSON.stringify({ error: "Invalid JSON" }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
          });
        }
        const url = new URL(request.url);
        url.pathname = "/api/ai";
        const forward = await fetch(url.toString(), {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(request.headers.get("authorization")
              ? { Authorization: request.headers.get("authorization")! }
              : {}),
          },
          body: JSON.stringify({ intent: "brief", plan: parsed.plan }),
        });
        return new Response(forward.body, {
          status: forward.status,
          headers: forward.headers,
        });
      },
    },
  },
});
