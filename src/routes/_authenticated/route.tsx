import { createFileRoute, redirect } from "@tanstack/react-router";
import { Outlet } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";

/**
 * Authenticated layout.
 *
 * Any route under this pathless layout requires a hydrated Supabase session.
 * Visitors without a session are redirected to /auth with a return link so they
 * land back where they were after signing in.
 *
 * ssr: false keeps the guard client-side, where the Supabase browser client has
 * access to localStorage/session cookies.
 */
export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async ({ location }) => {
    const { data } = await supabase.auth.getSession();
    if (!data.session?.access_token) {
      throw redirect({
        to: "/auth",
        search: { return: location.href },
      });
    }
  },
  component: () => <Outlet />,
});
