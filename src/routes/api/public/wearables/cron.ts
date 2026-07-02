// Nightly wearable sync — called by pg_cron with the Supabase anon apikey header.
import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

export const Route = createFileRoute("/api/public/wearables/cron")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { requireCronSecret } = await import("@/lib/api/cron-auth.server");
        const authFail = requireCronSecret(request);
        if (authFail) return authFail;

        const supabase = createClient<Database>(
          process.env.SUPABASE_URL!,
          process.env.SUPABASE_SERVICE_ROLE_KEY!,
        );

        const { data: rows, error } = await supabase
          .from("wearable_connections")
          .select("*");
        if (error) return Response.json({ error: error.message }, { status: 500 });

        const { syncConnection } = await import("@/lib/wearables/sync.server");
        const results: Array<{ user: string; provider: string; ok: boolean; error?: string }> = [];
        for (const row of rows ?? []) {
          const r = await syncConnection(supabase, row);
          results.push({
            user: row.user_id,
            provider: row.provider,
            ok: r.ok,
            error: r.error,
          });
        }
        return Response.json({ ok: true, synced: results.length, results });
      },
    },
  },
});
