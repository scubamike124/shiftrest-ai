import { useSyncExternalStore } from "react";
import { isNativeApp } from "@/lib/native-app";

// Whether this page runs inside the app shell never changes: no subscription.
const noopSubscribe = () => () => {};

/** React hook. During server render and hydration it returns false (the server
 *  snapshot) so hydration matches the server HTML; React then re-renders with the
 *  real value. Components mounted later read the real value on first render.
 *  Upsell UI must be written so that "false" is never shown to the app as a
 *  purchase prompt before the check runs (render nothing, or gate on isNativeApp()). */
export function useIsNativeApp(): boolean {
  return useSyncExternalStore(noopSubscribe, isNativeApp, () => false);
}
