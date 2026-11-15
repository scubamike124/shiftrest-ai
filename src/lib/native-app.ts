// Detects the RestPilot iPhone/Android app shell, which loads restpilotai.com
// in a native WebView via Capacitor `server.url`.
//
// Inside the app, no website purchase may be started (App Store Guideline
// 3.1.1): digital subscriptions sold in an iOS app must use In-App Purchase,
// which is not enabled yet. The website itself is unchanged.
//
// Two client signals, either one is enough:
//   1. Capacitor injects `window.Capacitor` into every page the shell loads;
//      `isNativePlatform()` is true only in the native shell.
//   2. The shell appends `RestPilotApp/<version>` to its User-Agent
//      (`appendUserAgent` in ios-app/capacitor.config.json).
//
// Server side, `isNativeAppRequest()` checks the same User-Agent token and an
// explicit header that the client attaches to every server-function call when
// it runs in the app. Both can be spoofed by a hostile client, so the server
// check is defence in depth only; the real control is that the app never shows
// a purchase button.

import { useEffect, useState } from "react";

export const NATIVE_APP_UA_TOKEN = "RestPilotApp/";
export const NATIVE_APP_HEADER = "x-restpilot-native-app";
export const NATIVE_PURCHASE_UNAVAILABLE = "Subscriptions aren't available in the app yet.";

type CapacitorGlobal = { isNativePlatform?: () => boolean };

export function isNativeApp(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const cap = (window as unknown as { Capacitor?: CapacitorGlobal }).Capacitor;
    if (typeof cap?.isNativePlatform === "function" && cap.isNativePlatform() === true) return true;
  } catch {
    /* fall through to the User-Agent check */
  }
  try {
    return typeof navigator !== "undefined" && navigator.userAgent.includes(NATIVE_APP_UA_TOKEN);
  } catch {
    return false;
  }
}

/** React hook: false during server render and the first client render (so
 *  hydration matches the website), then true inside the app shell. */
export function useIsNativeApp(): boolean {
  const [native, setNative] = useState(false);
  useEffect(() => {
    setNative(isNativeApp());
  }, []);
  return native;
}

/** Server: does this request come from the app shell? (Spoofable; see above.) */
export function isNativeAppRequest(headers: Headers | null | undefined): boolean {
  if (!headers) return false;
  if (headers.get(NATIVE_APP_HEADER) === "1") return true;
  return (headers.get("user-agent") ?? "").includes(NATIVE_APP_UA_TOKEN);
}
