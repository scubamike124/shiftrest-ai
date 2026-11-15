// Apple Health state for the signed-in account on this iPhone.
// Outside the iPhone app `available` stays false and nothing is read.

import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  appleHealthAvailable,
  autoRefreshDue,
  loadAppleHealth,
  refreshAppleHealth,
  type AppleHealthState,
} from "@/lib/health/apple-health-store";
import { watchAppleHealthAvailability } from "@/lib/health/availability-watch";
import { isNativeApp } from "@/lib/native-app";

// Shared by every view using this hook, so they do not each start a read.
let lastAutoAttempt = 0;

export function useAppleHealth() {
  const [available, setAvailable] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [state, setState] = useState<AppleHealthState | null>(null);

  useEffect(() => {
    let active = true;
    // Inside the app the plugin can answer "not available" before it is ready, so
    // re-probe a few times (bounded, cancelled on unmount). Probing only: no
    // authorization is requested. The shell's user agent marks the app even if the
    // Capacitor global is late.
    const inApp =
      isNativeApp() ||
      (typeof navigator !== "undefined" && navigator.userAgent.includes("RestPilotApp/"));
    const stopProbing = watchAppleHealthAvailability({
      probe: appleHealthAvailable,
      native: inApp,
      onChange: (a) => active && setAvailable(a),
    });
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
      stopProbing();
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
    const now = Date.now();
    if (!autoRefreshDue(state, lastAutoAttempt, now)) return;
    lastAutoAttempt = now;
    void refreshAppleHealth(userId).catch(() => {});
  }, [available, userId, state]);

  return { available, userId, state, nights: state?.nights ?? null };
}
