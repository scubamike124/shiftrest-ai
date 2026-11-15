import { lazy, Suspense, useEffect, useState } from "react";
import { AppPreviewAccess } from "@/components/AppPreviewAccess";
import { currentSurface, iapFlagEnabled } from "@/lib/entitlements/iap-bridge";

const NativeSubscription = lazy(() =>
  import("./NativeSubscription").then((m) => ({ default: m.NativeSubscription })),
);

// /paywall chooser. With VITE_IAP_ENABLED off (the default), and on the
// website in every case, this renders exactly the existing AppPreviewAccess
// screen: no website behaviour changes. Only inside the native app with the
// flag on does it switch, after hydration, to the in-app subscription screen.
export function AppAwarePaywall() {
  const [inApp, setInApp] = useState(false);
  useEffect(() => {
    setInApp(iapFlagEnabled() && currentSurface() !== "web");
  }, []);
  if (!inApp) return <AppPreviewAccess />;
  return (
    <Suspense fallback={<p className="px-5 py-16 text-center text-muted-foreground">Loading…</p>}>
      <NativeSubscription />
    </Suspense>
  );
}
