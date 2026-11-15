import { lazy, Suspense } from "react";
import { NativeSubscriptionNotice } from "@/components/native/NativeSubscriptionNotice";
import { iapAvailable } from "@/lib/entitlements/iap-bridge";

const NativeSubscription = lazy(() =>
  import("./NativeSubscription").then((m) => ({ default: m.NativeSubscription })),
);

// What /paywall and /pricing show inside the iPhone app. Rendered only once
// useIsNativeApp() is true (after hydration), so reading window here is safe.
// Without VITE_REVENUECAT_IOS_API_KEY or the native Purchases plugin this is
// exactly the existing neutral notice (#40). With both, the App Store paywall,
// which itself falls back to the notice until the server reports IAP ready.
export function AppSubscriptionScreen() {
  if (!iapAvailable()) return <NativeSubscriptionNotice />;
  return (
    <Suspense fallback={<p className="px-5 py-16 text-center text-muted-foreground">Loading…</p>}>
      <NativeSubscription />
    </Suspense>
  );
}
