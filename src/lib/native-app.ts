// Detects the RestPilot iPhone/Android app shell (White Glove Treatment wraps
// restpilotai.com in Capacitor with `server.url`). Inside that shell the page
// runs in a native WebView, not in Safari, so:
//   - Google refuses OAuth in embedded WebViews, and the shell opens other
//     hosts in Safari, so a Google sign-in never comes back to the app;
//   - Web Push and "Add to Home Screen" do not exist there, so Safari
//     install instructions would point the user at the wrong app.
// Capacitor injects `window.Capacitor` into every page the shell loads.

type CapacitorGlobal = { isNativePlatform?: () => boolean };

export function isNativeApp(): boolean {
  if (typeof window === "undefined") return false;
  const cap = (window as unknown as { Capacitor?: CapacitorGlobal }).Capacitor;
  try {
    return typeof cap?.isNativePlatform === "function" && cap.isNativePlatform() === true;
  } catch {
    return false;
  }
}
