import { readAIJson } from "@/lib/ai/request.server";
import { aiForwardUrl, DROP_FORWARD_HEADERS } from "@/lib/ai/forward.server";
/**
 * Legacy /api/coach — kept for backward compatibility.
 * All logic now lives in /api/ai (intent: "coach"). This file just forwards.
 */
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/coach")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const input = await readAIJson(request);
        if ("response" in input) return input.response;
        let parsed: { messages?: unknown; context?: string; localTime?: string; timezone?: string } = {};
        try {
          parsed = input.body as typeof parsed;
        } catch {
          return new Response(JSON.stringify({ error: "Invalid JSON" }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
          });
        }
        const forward = await fetch(aiForwardUrl(request.url), {
          method: "POST",
          redirect: "manual",
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
        if (forward.status >= 300 && forward.status < 400) {
          return Response.json({ error: "AI service unavailable" }, { status: 502 });
        }
        const headers = new Headers(forward.headers);
        for (const h of DROP_FORWARD_HEADERS) headers.delete(h);
        return new Response(forward.body, { status: forward.status, headers });
      },
    },
  },
});
