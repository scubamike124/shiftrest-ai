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

import { useEffect, useState, useSyncExternalStore } from "react";

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

// No subscription: whether this page runs inside the app shell never changes.
const noopSubscribe = () => () => {};

/** React hook. During server render and hydration it returns false (the
 *  server snapshot), so hydration always matches the server HTML, including
 *  for code-split routes that hydrate after the layout; React then re-renders
 *  with the real value. Components mounted later (client navigation) read the
 *  real value on their first render, so they never flash web-only UI. */
export function useIsNativeApp(): boolean {
  return useSyncExternalStore(noopSubscribe, isNativeApp, () => false);
}

/** True only after mount, and only outside the app shell. Use for website-only
 *  wording or links that must never appear in the app, not even for the
 *  server-rendered / hydration first render: that render is always false
 *  (neutral), so an app user never sees the website version. Website visitors
 *  get it right after hydration. */
export function useWebOnlyAfterMount(): boolean {
  const [web, setWeb] = useState(false);
  useEffect(() => {
    setWeb(!isNativeApp());
  }, []);
  return web;
}

/** Server: does this request come from the app shell? (Spoofable; see above.) */
export function isNativeAppRequest(headers: Headers | null | undefined): boolean {
  if (!headers) return false;
  if (headers.get(NATIVE_APP_HEADER) === "1") return true;
  return (headers.get("user-agent") ?? "").includes(NATIVE_APP_UA_TOKEN);
}
