// Oura OAuth callback.
import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { exchangeCode, OURA_SCOPES } from "@/lib/wearables/oura.server";

function appOrigin() {
  return process.env.PUBLIC_APP_URL || "https://shift-rest-ai.lovable.app";
}

function getAdmin() {
  return createClient<Database>(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

export const Route = createFileRoute("/api/public/wearables/oura/callback")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const code = url.searchParams.get("code");
        const state = url.searchParams.get("state") ?? "";
        const err = url.searchParams.get("error");
        const redirectBack = (status: "connected" | "error", reason?: string) => {
          const back = new URL(`${appOrigin()}/profile`);
          back.searchParams.set(status, "oura");
          if (reason) back.searchParams.set("reason", reason);
          return Response.redirect(back.toString(), 302);
        };
        if (err) return redirectBack("error", err);
        if (!code || !state) return redirectBack("error", "missing_code");

        const userId = state.split(":")[0];
        if (!userId) return redirectBack("error", "bad_state");

        try {
          const redirectUri = `${appOrigin()}/api/public/wearables/oura/callback`;
          const tok = await exchangeCode(code, redirectUri);
          const supabase = getAdmin();
          const expiresAt = new Date(Date.now() + tok.expires_in * 1000).toISOString();
          await supabase.from("wearable_connections").upsert(
            {
              user_id: userId,
              provider: "oura",
              access_token: tok.access_token,
              refresh_token: tok.refresh_token,
              expires_at: expiresAt,
              scope: OURA_SCOPES,
              last_sync_error: null,
            },
            { onConflict: "user_id,provider" },
          );
          try {
            const { data: row } = await supabase
              .from("wearable_connections")
              .select("*")
              .eq("user_id", userId)
              .eq("provider", "oura")
              .single();
            if (row) {
              const { syncConnection } = await import("@/lib/wearables/sync.server");
              await syncConnection(supabase, row);
            }
          } catch {
            /* non-fatal */
          }
          return redirectBack("connected");
        } catch (e: any) {
          return redirectBack("error", encodeURIComponent(e?.message ?? "exchange_failed"));
        }
      },
    },
  },
});
