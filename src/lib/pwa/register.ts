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
 * Update flow
 * ───────────
 *   • `updateViaCache: "none"` — forces the browser to revalidate the
 *     SW script on every check (iOS otherwise caches it up to 24h, so
 *     new deploys go undiscovered until the next cold start).
 *   • `reg.update()` on load + every visibilitychange→visible — catches
 *     installed PWAs that stay backgrounded for days.
 *   • `updatefound` / `waiting` → emit on the update channel so the
 *     UpdateBanner can prompt the user with one tap to activate.
 *
 * Push notifications: the same `/sw.js` ships push handlers (see
 * `public/sw-src.ts`). On allowed origins, registering it here
 * activates both app-shell caching AND push delivery in a single
 * worker, which is required because the browser only allows one
 * registration per scope.
 */

import { emitUpdate } from "./update-channel";

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

// One-time auto-activation token. When a waiting worker is detected we
// post SKIP_WAITING automatically so installed PWAs (iOS Home-Screen)
// pick up the new release without the user having to tap the banner.
// The sessionStorage guard ensures we only do this once per tab session
// per release — if activation somehow loops, the second attempt is a
// no-op and the UpdateBanner remains as a manual fallback.
const AUTO_SKIP_KEY = "rpai:sw-auto-skip:v2-2026-06-30-smart-alarm";

function autoActivateIfPossible(reg: ServiceWorkerRegistration): void {
  if (!reg.waiting || !navigator.serviceWorker.controller) return;
  try {
    if (sessionStorage.getItem(AUTO_SKIP_KEY) === "1") return;
    sessionStorage.setItem(AUTO_SKIP_KEY, "1");
  } catch {
    /* private mode — fall through; controllerchange reload is still gated */
  }
  reg.waiting.postMessage({ type: "SKIP_WAITING" });
}

function announceIfWaiting(reg: ServiceWorkerRegistration): void {
  // A worker is "waiting" once installed but blocked behind the current
  // controller. That's the trigger for the update banner.
  if (reg.waiting && navigator.serviceWorker.controller) {
    emitUpdate({ type: "available", reg });
    autoActivateIfPossible(reg);
  }
}

function wireUpdateDetection(reg: ServiceWorkerRegistration): void {
  // Already-waiting at register time (returning visitor after deploy).
  announceIfWaiting(reg);

  reg.addEventListener("updatefound", () => {
    const installing = reg.installing;
    if (!installing) return;
    installing.addEventListener("statechange", () => {
      if (installing.state === "installed" && navigator.serviceWorker.controller) {
        // First load (no controller yet) → not an "update", just initial install.
        emitUpdate({ type: "available", reg });
        autoActivateIfPossible(reg);
      }
    });
  });

  // When the new SW takes over (after SKIP_WAITING + activation), reload
  // once so the page is served by the new worker's precache. The
  // `reloading` guard plus the sessionStorage token above together
  // prevent any reload loop even if controllerchange fires twice.
  let reloading = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (reloading) return;
    reloading = true;
    emitUpdate({ type: "activated" });
    window.location.reload();
  });
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
    const reg = await navigator.serviceWorker.register(SW_PATH, {
      scope: "/",
      updateViaCache: "none",
    });
    wireUpdateDetection(reg);

    // Initial check after hydration settles.
    setTimeout(() => { reg.update().catch(() => { /* offline ok */ }); }, 4000);

    // Re-check whenever the tab comes back into focus.
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") {
        reg.update().catch(() => { /* offline ok */ });
      }
    });
  } catch (err) {
    console.warn("[pwa] SW registration failed", err);
  }
}
