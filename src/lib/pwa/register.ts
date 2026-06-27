/**
 * App-shell service worker registrar — the ONLY place that calls
 * `navigator.serviceWorker.register("/sw.js", ...)`.
 *
 * Why this exists
 * ───────────────
 * Service workers are sticky browser state. Registering one in the
 * Lovable editor preview, an iframe, or dev would cache stale chunks
 * and white-screen returning visitors. This wrapper enforces the
 * skill's refuse-list and unregisters any historical SW found in
 * those contexts, so the rollout stays reversible per-environment.
 *
 * Push notifications: the same `/sw.js` file ships push handlers
 * (see `public/sw-src.ts`). On allowed origins, registering it here
 * activates both app-shell caching AND push delivery in a single
 * worker, which is required because the browser only allows one
 * registration per scope.
 */

const SW_PATH = "/sw.js";

function shouldRefuse(): { refused: true; reason: string } | { refused: false } {
  if (typeof window === "undefined" || typeof navigator === "undefined") {
    return { refused: true, reason: "no-window" };
  }
  if (!("serviceWorker" in navigator)) {
    return { refused: true, reason: "unsupported" };
  }
  if (!import.meta.env.PROD) {
    return { refused: true, reason: "dev" };
  }
  try {
    if (window.self !== window.top) return { refused: true, reason: "iframe" };
  } catch {
    return { refused: true, reason: "iframe" }; // cross-origin top access blocked
  }
  const host = window.location.hostname;
  if (
    host.startsWith("id-preview--") ||
    host.startsWith("preview--") ||
    host === "lovableproject.com" ||
    host.endsWith(".lovableproject.com") ||
    host === "lovableproject-dev.com" ||
    host.endsWith(".lovableproject-dev.com") ||
    host === "beta.lovable.dev" ||
    host.endsWith(".beta.lovable.dev")
  ) {
    return { refused: true, reason: `lovable-preview:${host}` };
  }
  const killed = new URLSearchParams(window.location.search).get("sw") === "off";
  if (killed) return { refused: true, reason: "sw=off" };
  return { refused: false };
}

async function unregisterStale(): Promise<void> {
  try {
    const reg = await navigator.serviceWorker.getRegistration(SW_PATH);
    if (reg) await reg.unregister();
  } catch {
    /* ignore — best effort */
  }
}

/**
 * Register the app-shell service worker if and only if we are in an
 * allowed environment. In every refused environment, unregister any
 * stale registration first so old caches don't survive a code change.
 *
 * Safe to call multiple times — `register()` is idempotent for the
 * same scriptURL.
 */
export async function registerAppShell(): Promise<void> {
  const decision = shouldRefuse();
  if (decision.refused) {
    if (typeof navigator !== "undefined" && "serviceWorker" in navigator) {
      await unregisterStale();
    }
    if (decision.reason !== "no-window" && decision.reason !== "unsupported") {
      // Useful in browser devtools when verifying the guards.
      console.info(`[pwa] SW registration refused (${decision.reason})`);
    }
    return;
  }
  try {
    await navigator.serviceWorker.register(SW_PATH, { scope: "/" });
  } catch (err) {
    console.warn("[pwa] SW registration failed", err);
  }
}
