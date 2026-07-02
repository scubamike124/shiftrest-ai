// pg_cron target — runs every 5 minutes. For each user with reminders
// enabled, computes due reminders from their Long Clock, filters by quiet
// hours / daily cap / 30-min dedupe, sends Web Push, and writes the log.

import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/hooks/notify")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { requireCronSecret } = await import("@/lib/api/cron-auth.server");
        const authFail = requireCronSecret(request);
        if (authFail) return authFail;

        const { runNotificationTick } = await import("@/lib/notifications/run.server");
        const summary = await runNotificationTick(new Date());
        return Response.json(summary);
      },
      GET: async () =>
        Response.json({ ok: true, info: "POST with apikey header to trigger" }),
    },
  },
});
