/**
 * Legacy /api/coach — kept for backward compatibility.
 * All logic now lives in /api/ai (intent: "coach"). This file just forwards.
 */
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/coach")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const body = await request.text();
        let parsed: { messages?: unknown; context?: string; localTime?: string; timezone?: string } = {};
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
          body: JSON.stringify({
            intent: "coach",
            messages: parsed.messages,
            context: parsed.context,
            localTime: parsed.localTime,
            timezone: parsed.timezone,
          }),
        });
        return new Response(forward.body, {
          status: forward.status,
          headers: forward.headers,
        });
      },
    },
  },
});
