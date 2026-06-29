// Lightweight session hook — gates UI on a *hydrated* Supabase session, not
// a stale "signedIn" prop. Prevents first-paint races where a protected
// serverFn fires before the SDK has loaded the access token from storage.

import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

export function useSession() {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let mounted = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setSession(data.session ?? null);
      setReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_evt, s) => {
      if (!mounted) return;
      setSession(s ?? null);
      setReady(true);
    });
    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  return {
    session,
    ready,
    hasSession: Boolean(session),
    hasAccessToken: Boolean(session?.access_token),
  };
}
