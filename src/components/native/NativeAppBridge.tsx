// Glue between the site and the iPhone app shell. Renders nothing.
// Mounted once in the root; does nothing outside the app shell.
//
//  - Keeps the native reminders and the offline plan in step with the user's
//    shifts and sleep prefs (and re-plans when the app comes back to the
//    foreground, so the 7-day window keeps rolling).
//  - Routes universal links and notification taps to in-app pages.
//  - Clears native reminders and the offline plan on sign-out.
//  - Hides the launch screen once the page is up.

import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { fetchEmployers } from "@/lib/employers";
import { DEFAULT_PREFS, fetchPrefs } from "@/lib/prefs";
import { fetchShifts } from "@/lib/shifts";
import { isNativeApp } from "@/lib/native-app";
import {
  asHandle,
  nativePlugin,
  type AppPlugin,
  type ListenerHandle,
  type SplashScreenPlugin,
} from "@/lib/native/capacitor";
import { buildOfflinePlan } from "@/lib/native/offline-plan";
import { planNativeReminders } from "@/lib/native/reminders";
import { safeInAppPath } from "@/lib/native/links";
import {
  clearNativeUserData,
  loadReminderSettings,
  localNotifications,
  rememberAppUrl,
  syncNativeReminders,
  writeOfflinePlan,
} from "@/lib/native/sync";

export function NativeAppBridge({ signedIn }: { signedIn: boolean }) {
  const [native, setNative] = useState(false);
  useEffect(() => setNative(isNativeApp()), []);
  return native ? <Bridge signedIn={signedIn} /> : null;
}

function Bridge({ signedIn }: { signedIn: boolean }) {
  const router = useRouter();
  const qc = useQueryClient();
  const [userId, setUserId] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  // Who is signed in; wipe native user data when they sign out.
  useEffect(() => {
    let active = true;
    supabase.auth.getSession().then(({ data }) => {
      if (active) setUserId(data.session?.user.id ?? null);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      setUserId(session?.user.id ?? null);
      if (event === "SIGNED_OUT") void clearNativeUserData();
    });
    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const shiftsQ = useQuery({ queryKey: ["shifts"], queryFn: fetchShifts, enabled: signedIn });
  const employersQ = useQuery({
    queryKey: ["employers"],
    queryFn: fetchEmployers,
    enabled: signedIn,
  });
  const { data: prefs = DEFAULT_PREFS } = useQuery({
    queryKey: ["prefs"],
    queryFn: fetchPrefs,
    initialData: DEFAULT_PREFS,
  });

  // Re-plan whenever the inputs change (debounced: edits come in bursts).
  useEffect(() => {
    if (!userId || !signedIn || !shiftsQ.data) return;
    const shifts = shiftsQ.data;
    const employers = employersQ.data ?? [];
    const t = window.setTimeout(() => {
      const now = new Date();
      void writeOfflinePlan(buildOfflinePlan({ shifts, prefs, employers, now })).catch(() => {});
      const planned = planNativeReminders({
        shifts,
        prefs,
        settings: loadReminderSettings(userId),
        now,
      });
      void syncNativeReminders(planned).catch(() => {});
    }, 800);
    return () => window.clearTimeout(t);
  }, [userId, signedIn, shiftsQ.data, employersQ.data, prefs, tick]);

  // Settings changed on the reminders card.
  useEffect(() => {
    const bump = () => setTick((n) => n + 1);
    window.addEventListener("rp:native-reminders-changed", bump);
    return () => window.removeEventListener("rp:native-reminders-changed", bump);
  }, []);

  // One-time shell wiring.
  useEffect(() => {
    void rememberAppUrl(window.location.origin).catch(() => {});
    void nativePlugin<SplashScreenPlugin>("SplashScreen")
      ?.hide({ fadeOutDuration: 200 })
      .catch(() => {});

    const handles: Promise<ListenerHandle>[] = [];
    const go = (href: string | null) => {
      if (href) void router.navigate({ href });
    };
    const app = nativePlugin<AppPlugin>("App");
    if (app) {
      handles.push(
        asHandle(
          app.addListener("appUrlOpen", (e) => go(safeInAppPath(e.url, window.location.host))),
        ),
      );
      handles.push(
        asHandle(
          app.addListener("resume", () => {
            setTick((n) => n + 1);
            void qc.invalidateQueries({ queryKey: ["shifts"] });
          }),
        ),
      );
    }
    const ln = localNotifications();
    if (ln) {
      handles.push(
        asHandle(
          ln.addListener("localNotificationActionPerformed", (e) => {
            const path = e.notification.extra?.path;
            go(typeof path === "string" ? safeInAppPath(path, window.location.host) : null);
          }),
        ),
      );
    }
    return () => {
      for (const h of handles) void h.then((x) => x.remove()).catch(() => {});
    };
  }, [router, qc]);

  return null;
}
