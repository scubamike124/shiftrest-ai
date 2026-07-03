/**
 * GET /api/public/health — lightweight liveness probe.
 * Intended for external uptime monitors (UptimeRobot, BetterStack, etc.).
 * Returns 200 with a tiny JSON body; no database or upstream calls so the
 * probe measures Worker reachability, not backend health.
 */
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/health")({
  server: {
    handlers: {
      GET: () =>
        Response.json(
          { ok: true, at: new Date().toISOString() },
          { headers: { "Cache-Control": "no-store" } },
        ),
    },
  },
});
