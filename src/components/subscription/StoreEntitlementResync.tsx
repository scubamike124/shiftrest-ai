import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { getEntitlementStatus, syncMyStoreEntitlement } from "@/lib/entitlements/entitlement.functions";
import { iapAvailable } from "@/lib/entitlements/iap-bridge";
import { isNativeApp } from "@/lib/native-app";
import { resyncStoreEntitlement } from "@/lib/entitlements/store-resync";

const lastAttempt = new Map<string, number>();

/** Renders nothing. In the signed-in iPhone app it re-syncs the App Store
 *  entitlement on open and on return to the foreground (see store-resync.ts).
 *  Fire-and-forget: it never blocks rendering and shows no purchase UI. */
export function StoreEntitlementResync() {
  const queryClient = useQueryClient();
  const [userId, setUserId] = useState<string | null>(null);
  useEffect(() => {
    if (!isNativeApp()) return;
    supabase.auth.getSession().then(({ data }) => setUserId(data.session?.user.id ?? null));
    const { data } = supabase.auth.onAuthStateChange((_e, session) =>
      setUserId(session?.user.id ?? null),
    );
    return () => data.subscription.unsubscribe();
  }, []);
  useEffect(() => {
    if (!userId || !isNativeApp()) return;
    const run = () => {
      void resyncStoreEntitlement({
        isNativeApp,
        iapAvailable,
        userId,
        getStatus: () => getEntitlementStatus(),
        sync: () => syncMyStoreEntitlement(),
        now: Date.now,
        lastAttempt,
      }).then((outcome) => {
        if (outcome === "synced") void queryClient.invalidateQueries({ queryKey: ["subscription-state"] });
      });
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") run();
    };
    run();
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [userId, queryClient]);
  return null;
}
