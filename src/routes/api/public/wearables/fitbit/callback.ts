// Fitbit OAuth callback. Public route (no auth middleware) — the state param
// embeds the userId issued at /startWearableOAuth and PKCE verifier comes via
// a short-lived cookie set by the client before redirect.
import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { exchangeCode, FITBIT_SCOPES } from "@/lib/wearables/fitbit.server";

function appOrigin() {
  return process.env.PUBLIC_APP_URL || "https://shift-rest-ai.lovable.app";
}

function getAdmin() {
  return createClient<Database>(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

function parseCookies(header: string | null): Record<string, string> {
  if (!header) return {};
  const out: Record<string, string> = {};
  for (const part of header.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k) out[k] = decodeURIComponent(rest.join("="));
  }
  return out;
}

export const Route = createFileRoute("/api/public/wearables/fitbit/callback")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const code = url.searchParams.get("code");
        const state = url.searchParams.get("state") ?? "";
        const err = url.searchParams.get("error");
        const redirectBack = (status: "connected" | "error", reason?: string) => {
          const back = new URL(`${appOrigin()}/profile`);
          back.searchParams.set(status, "fitbit");
          if (reason) back.searchParams.set("reason", reason);
          return Response.redirect(back.toString(), 302);
        };
        if (err) return redirectBack("error", err);
        if (!code || !state) return redirectBack("error", "missing_code");

        const userId = state.split(":")[0];
        if (!userId) return redirectBack("error", "bad_state");

        const cookies = parseCookies(request.headers.get("cookie"));
        const verifier = cookies["wearable_pkce"];
        if (!verifier) return redirectBack("error", "missing_verifier");

        try {
          const redirectUri = `${appOrigin()}/api/public/wearables/fitbit/callback`;
          const tok = await exchangeCode(code, redirectUri, verifier);
          const supabase = getAdmin();
          const expiresAt = new Date(Date.now() + tok.expires_in * 1000).toISOString();
          await supabase.from("wearable_connections").upsert(
            {
              user_id: userId,
              provider: "fitbit",
              access_token: tok.access_token,
              refresh_token: tok.refresh_token,
              expires_at: expiresAt,
              provider_user_id: tok.user_id,
              scope: tok.scope || FITBIT_SCOPES,
              last_sync_error: null,
            },
            { onConflict: "user_id,provider" },
          );
          // Fire one immediate sync (best-effort) so the dashboard has data.
          try {
            const { data: row } = await supabase
              .from("wearable_connections")
              .select("*")
              .eq("user_id", userId)
              .eq("provider", "fitbit")
              .single();
            if (row) {
              const { syncConnection } = await import("@/lib/wearables/sync.server");
              await syncConnection(supabase, row);
            }
          } catch {
            /* non-fatal */
          }

          const back = new URL(`${appOrigin()}/profile`);
          back.searchParams.set("connected", "fitbit");
          return new Response(null, {
            status: 302,
            headers: {
              Location: back.toString(),
              "Set-Cookie": "wearable_pkce=; Path=/; Max-Age=0; SameSite=Lax",
            },
          });
        } catch (e: any) {
          return redirectBack("error", encodeURIComponent(e?.message ?? "exchange_failed"));
        }
      },
    },
  },
});
