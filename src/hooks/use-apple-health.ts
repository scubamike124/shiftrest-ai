// Apple Health state for the signed-in account on this iPhone.
// Outside the iPhone app `available` stays false and nothing is read.

import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  appleHealthAvailable,
  loadAppleHealth,
  refreshAppleHealth,
  type AppleHealthState,
} from "@/lib/health/apple-health-store";

const REFRESH_AFTER_MS = 60 * 60_000;

export function useAppleHealth() {
  const [available, setAvailable] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [state, setState] = useState<AppleHealthState | null>(null);

  useEffect(() => {
    let active = true;
    void appleHealthAvailable().then((a) => active && setAvailable(a));
    void supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      const id = data.session?.user.id ?? null;
      setUserId(id);
      setState(loadAppleHealth(id));
    });
    // Follow sign-in changes, so Connect never saves under a previous account.
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      const id = session?.user.id ?? null;
      setUserId(id);
      setState(loadAppleHealth(id));
    });
    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  // Connect / Disconnect / refresh anywhere in the app updates every view.
  useEffect(() => {
    const reload = () => setState(loadAppleHealth(userId));
    window.addEventListener("rp:apple-health-changed", reload);
    return () => window.removeEventListener("rp:apple-health-changed", reload);
  }, [userId]);

  // Quietly re-read when the data is over an hour old (no permission prompt).
  useEffect(() => {
    if (!available || !userId || !state) return;
    const age = state.lastReadAt ? Date.now() - Date.parse(state.lastReadAt) : Infinity;
    if (age < REFRESH_AFTER_MS) return;
    void refreshAppleHealth(userId).catch(() => {});
  }, [available, userId, state]);

  return { available, userId, state, nights: state?.nights ?? null };
}
