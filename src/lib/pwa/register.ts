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
import { logBreadcrumb } from "./breadcrumbs";

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
//
// The token is keyed by `__BUILD_ID__` (injected at build time via Vite
// `define`), so every deploy gets a fresh sessionStorage key. iOS PWAs
// keep sessionStorage alive across reopens for the lifetime of the
// home-screen window, which is why a hardcoded key would silently
// refuse to auto-activate on the 2nd+ deploy of the same session and
// leave users stranded on the previous build.
declare const __BUILD_ID__: string;
const AUTO_SKIP_KEY = `rpai:sw-auto-skip:${__BUILD_ID__}`;

function autoActivateIfPossible(reg: ServiceWorkerRegistration): void {
  if (!reg.waiting) return;
  try {
    if (sessionStorage.getItem(AUTO_SKIP_KEY) === "1") return;
    sessionStorage.setItem(AUTO_SKIP_KEY, "1");
  } catch {
    /* private mode — fall through; controllerchange reload is still gated */
  }
  logBreadcrumb("auto-skip-waiting", __BUILD_ID__, {
    waitingScript: reg.waiting.scriptURL,
  });
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
  const RELOAD_TOKEN = `rpai:sw-reloaded:${__BUILD_ID__}`;
  const triggerReload = (source: string) => {
    if (reloading) return;
    try {
      if (sessionStorage.getItem(RELOAD_TOKEN) === "1") return;
      sessionStorage.setItem(RELOAD_TOKEN, "1");
    } catch { /* private mode ok */ }
    reloading = true;
    emitUpdate({ type: "activated" });
    logBreadcrumb("reload", __BUILD_ID__, { source });
    console.info(`[pwa] reloading after SW activation (${source})`);
    window.location.reload();
  };
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    triggerReload("controllerchange");
  });
  // Belt-and-suspenders for iOS PWAs where controllerchange doesn't
  // always fire after clientsClaim(). The SW posts SW_ACTIVATED on
  // activate; the RELOAD_TOKEN sessionStorage guard prevents loops.
  navigator.serviceWorker.addEventListener("message", (event) => {
    const data = event.data as { type?: string; build?: string } | null;
    if (data?.type === "SW_ACTIVATED" && data.build && data.build !== __BUILD_ID__) {
      triggerReload("sw-activated-message");
    }
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
    logBreadcrumb("registered", __BUILD_ID__, {
      scope: reg.scope,
      hasController: !!navigator.serviceWorker.controller,
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

    // Stale-bundle guards. Marker: PWA_STALE_GUARD_BUILD =
    // "pwa-stale-guard-2026-07-06-01" — grep production JS to confirm
    // this file shipped.
    installStaleBundleGuards(reg);
  } catch (err) {
    console.warn("[pwa] SW registration failed", err);
  }
}

/**
 * PWA_STALE_GUARD_BUILD = "pwa-stale-guard-2026-07-06-01"
 *
 * Three defenses against users sitting on a stale JS bundle when the SW's
 * own update flow misses (foregrounded-only visits, bfcache-restored tabs,
 * iOS Safari holding the previous controller):
 *
 *   1. pageshow → reg.update()  (also fires on bfcache restore)
 *   2. bfcache guard: if event.persisted AND server buildId ≠ current, reload once
 *   3. 60s poll of /api/public/version while visible; if buildId drifts
 *      for 2 checks in a row, emit `available` so UpdateBanner shows.
 *      Tapping Update reloads even without a waiting SW.
 */
function installStaleBundleGuards(reg: ServiceWorkerRegistration): void {
  const CURRENT_BUILD = __BUILD_ID__;
  const BFCACHE_RELOAD_TOKEN = `rpai:bfcache-reloaded:${CURRENT_BUILD}`;

  let mismatchStreak = 0;
  let banneredForBuild: string | null = null;

  const fetchServerBuildId = async (): Promise<string | null> => {
    try {
      const res = await fetch("/api/public/version", { cache: "no-store" });
      if (!res.ok) return null;
      const json = (await res.json()) as { buildId?: string };
      return typeof json.buildId === "string" ? json.buildId : null;
    } catch {
      return null;
    }
  };

  const checkForDrift = async (source: string): Promise<void> => {
    const serverBuild = await fetchServerBuildId();
    if (!serverBuild) return;
    if (serverBuild === CURRENT_BUILD) {
      mismatchStreak = 0;
      return;
    }
    mismatchStreak += 1;
    console.info(
      `[pwa] build-id drift (${source}) server=${serverBuild} current=${CURRENT_BUILD} streak=${mismatchStreak}`,
    );
    logBreadcrumb("drift-detected", CURRENT_BUILD, {
      source,
      serverBuild,
      streak: mismatchStreak,
    });
    // Nudge the SW to fetch the new script; if it's really new the
    // normal updatefound/waiting path will fire and the banner appears
    // via wireUpdateDetection.
    reg.update().catch(() => { /* offline ok */ });
    if (mismatchStreak >= 2 && banneredForBuild !== serverBuild) {
      banneredForBuild = serverBuild;
      emitUpdate({ type: "available", reg });
    }
  };

  // (2) bfcache guard — fires when Safari restores a persisted page.
  window.addEventListener("pageshow", (event: PageTransitionEvent) => {
    // (1) always re-check for a new SW on pageshow (covers bfcache too).
    reg.update().catch(() => { /* offline ok */ });

    if (!event.persisted) return;
    (async () => {
      const serverBuild = await fetchServerBuildId();
      if (!serverBuild || serverBuild === CURRENT_BUILD) return;
      try {
        if (sessionStorage.getItem(BFCACHE_RELOAD_TOKEN) === "1") return;
        sessionStorage.setItem(BFCACHE_RELOAD_TOKEN, "1");
      } catch { /* private mode ok */ }
      logBreadcrumb("bfcache-restore-stale", CURRENT_BUILD, { serverBuild });
      logBreadcrumb("reload", CURRENT_BUILD, { source: "bfcache" });
      console.info(
        `[pwa] bfcache restore with stale build (server=${serverBuild}) — reloading`,
      );
      window.location.reload();
    })();
  });

  // (3) Poll every 60s while visible. Skip when hidden to conserve battery.
  const POLL_MS = 60_000;
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  const startPoll = () => {
    if (pollTimer) return;
    pollTimer = setInterval(() => {
      if (document.visibilityState === "visible") {
        void checkForDrift("poll");
      }
    }, POLL_MS);
  };
  const stopPoll = () => {
    if (!pollTimer) return;
    clearInterval(pollTimer);
    pollTimer = null;
  };
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      void checkForDrift("visibilitychange");
      startPoll();
    } else {
      stopPoll();
    }
  });
  // Initial check after a short delay so we don't race the first paint.
  setTimeout(() => { void checkForDrift("initial"); }, 8000);
  startPoll();
}
