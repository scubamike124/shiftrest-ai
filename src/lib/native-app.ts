// Detects the RestPilot iPhone/Android app shell (White Glove Treatment wraps
// restpilotai.com in Capacitor with `server.url`). Inside that shell the page
// runs in a native WebView, not in Safari, so:
//   - Google refuses OAuth in embedded WebViews, and the shell opens other
//     hosts in Safari, so a Google sign-in never comes back to the app;
//   - Web Push and "Add to Home Screen" do not exist there, so Safari
//     install instructions would point the user at the wrong app.
// Capacitor injects `window.Capacitor` into every page the shell loads, but it can
// arrive after the first requests (dashboard cards fetch on open). The shell also
// appends "RestPilotApp/<version>" to its WebView user agent from the first byte
// (ios-app/capacitor.config.json), so either signal means "in the app". Nothing
// that sells or upsells may render before the app is recognised.

/** Same token as NATIVE_APP_UA_TOKEN in src/lib/entitlements/app-request-guard.ts (a test keeps them equal). */
export const APP_USER_AGENT_TOKEN = "RestPilotApp/";

type CapacitorGlobal = { isNativePlatform?: () => boolean };

export function isNativeApp(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const cap = (window as unknown as { Capacitor?: CapacitorGlobal }).Capacitor;
    if (typeof cap?.isNativePlatform === "function" && cap.isNativePlatform() === true) return true;
  } catch {
    /* fall through to the user agent */
  }
  try {
    const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
    return typeof ua === "string" && ua.toLowerCase().includes(APP_USER_AGENT_TOKEN.toLowerCase());
  } catch {
    return false;
  }
}
