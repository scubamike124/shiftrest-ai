import { redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";

/**
 * Route `beforeLoad` guard for authenticated app surfaces.
 *
 * Reads the current Supabase session (client-side; pair the route with
 * `ssr: false`) and, when absent, redirects to `/auth` with a `return`
 * param so the sign-in flow can send the user back where they were.
 *
 * Used by top-level app routes (dashboard, companion, pilot, settings/*,
 * etc.) that live outside the `_authenticated` layout tree.
 */
export async function requireSession({
  location,
}: {
  location: { href: string };
}) {
  const { data } = await supabase.auth.getSession();
  if (!data.session?.access_token) {
    throw redirect({
      to: "/auth",
      search: { return: location.href },
    });
  }
}
