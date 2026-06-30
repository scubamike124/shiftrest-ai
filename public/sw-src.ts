/// <reference lib="webworker" />
/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * RestPilot AI — combined service worker source.
 *
 * Compiled by vite-plugin-pwa (injectManifest mode) → `dist/sw.js`.
 *
 * Two responsibilities, intentionally co-located so we keep ONE worker
 * at scope `/` (the browser only allows one registration per scope, and
 * push notifications need scope `/` to deliver to every route):
 *
 * 1. PUSH NOTIFICATIONS — preserved verbatim from the previous
 *    `public/sw.js`. Smart Alarm depends on this.
 * 2. APP-SHELL OFFLINE — precaches the built JS/CSS bundle so the app
 *    opens with no network, and `NetworkFirst` for HTML navigations so
 *    deploys are picked up without stale-shell white screens.
 *
 * What this worker NEVER caches: anything under `/api/`, anything to
 * Supabase, anything to `/auth/`, `/~oauth*`, cross-origin requests
 * other than the Lovable assets CDN. AI responses, auth tokens, and
 * server-fn payloads stay out of Cache Storage entirely.
 */
import { precacheAndRoute, cleanupOutdatedCaches, createHandlerBoundToURL } from "workbox-precaching";
import { registerRoute, NavigationRoute } from "workbox-routing";
import { NetworkFirst, CacheFirst, StaleWhileRevalidate } from "workbox-strategies";
import { ExpirationPlugin } from "workbox-expiration";
import { clientsClaim } from "workbox-core";

declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<{ url: string; revision: string | null }>;
};

// ─── Cache version ─────────────────────────────────────────────────────────
// Bump on releases that need to evict stale app-shell caches from installed
// PWAs (iOS Home-Screen apps are the canonical victim). On activate, any
// Cache Storage bucket we own that does NOT include this token is deleted,
// so returning visitors get the new precache instead of a stale shell.
const CACHE_VERSION = "v2-2026-06-30-smart-alarm";

// ─── Lifecycle ─────────────────────────────────────────────────────────────
self.skipWaiting();
clientsClaim();

// Purge stale app-shell caches on activation. We only touch caches we own
// (prefix `rpai-`) so unrelated origin-mates (Firebase Messaging, etc.)
// are untouched.
self.addEventListener("activate", (event: ExtendableEvent) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.allSettled(
        names
          .filter((n) => n.startsWith("rpai-") && !n.includes(CACHE_VERSION))
          .map((n) => caches.delete(n)),
      );
    })(),
  );
});

// Allow the UpdateBanner (or auto-activation in register.ts) to activate
// a waiting worker on demand. `skipWaiting()` above already runs at
// install time, but if a previous version shipped without it, the
// waiting worker is stuck until something asks it to skip.
self.addEventListener("message", (event: ExtendableMessageEvent) => {
  if (event.data && (event.data as { type?: string }).type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

// ─── App-shell precache ────────────────────────────────────────────────────
// `__WB_MANIFEST` is injected by vite-plugin-pwa at build time and contains
// every hashed asset in the build output. Hashed filenames mean these are
// safe to cache forever.
cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST ?? []);

// ─── Cache bypass ──────────────────────────────────────────────────────────
// Hard rule: never intercept requests that carry secrets, auth, or
// per-user data. We register these BEFORE any runtime cache routes so
// they short-circuit Workbox routing.
function shouldBypass(url: URL): boolean {
  if (url.origin !== self.location.origin) {
    // Only allow Lovable's immutable assets CDN through runtime caching;
    // every other cross-origin request is fetched directly.
    return !url.pathname.startsWith("/__l5e/assets-v1/");
  }
  if (url.pathname.startsWith("/api/")) return true;
  if (url.pathname.startsWith("/auth/")) return true;
  if (url.pathname.startsWith("/~oauth")) return true;
  return false;
}

self.addEventListener("fetch", (event) => {
  try {
    const url = new URL(event.request.url);
    if (shouldBypass(url)) {
      // Do NOT call event.respondWith — let the browser handle it normally.
      // Workbox routes registered below will also skip because none match.
      return;
    }
  } catch {
    /* malformed URL — fall through to default */
  }
});

// ─── HTML navigations: NetworkFirst with shell fallback ────────────────────
// 3s timeout: if the network can't deliver the document, serve the cached
// shell so React can boot and the snapshot system can hydrate user data
// from localStorage. Excludes /~oauth and /api/ via the bypass above.
const navigationHandler = new NetworkFirst({
  cacheName: "rpai-pages-v1",
  networkTimeoutSeconds: 3,
  plugins: [new ExpirationPlugin({ maxEntries: 30, maxAgeSeconds: 60 * 60 * 24 })],
});
registerRoute(
  new NavigationRoute(
    async (params) => {
      const url = new URL(params.request.url);
      if (shouldBypass(url)) return fetch(params.request);
      try {
        return await navigationHandler.handle(params);
      } catch {
        // Final fallback: precached app shell.
        const shellHandler = createHandlerBoundToURL("/");
        return shellHandler(params);
      }
    },
    {
      denylist: [/^\/api\//, /^\/auth\//, /^\/~oauth/],
    },
  ),
);

// ─── Lovable assets CDN: stale-while-revalidate ────────────────────────────
registerRoute(
  ({ url }) => url.pathname.startsWith("/__l5e/assets-v1/"),
  new StaleWhileRevalidate({
    cacheName: "rpai-cdn-assets-v1",
    plugins: [new ExpirationPlugin({ maxEntries: 60, maxAgeSeconds: 60 * 60 * 24 * 30 })],
  }),
);

// ─── Fonts and icons in /public: cache-first ───────────────────────────────
registerRoute(
  ({ url, request }) =>
    url.origin === self.location.origin &&
    (request.destination === "font" ||
      url.pathname.endsWith(".png") ||
      url.pathname.endsWith(".webmanifest") ||
      url.pathname.endsWith(".ico")),
  new CacheFirst({
    cacheName: "rpai-static-v1",
    plugins: [new ExpirationPlugin({ maxEntries: 30, maxAgeSeconds: 60 * 60 * 24 * 30 })],
  }),
);

// ─── Push notifications (PRESERVED VERBATIM from previous public/sw.js) ────
// Smart Alarm depends on this. Do not modify without testing a real push.
self.addEventListener("push", (event: PushEvent) => {
  let data: { title: string; body: string; kind?: string; tag?: string; url?: string } = {
    title: "RestPilot AI",
    body: "You have a new reminder.",
  };
  try {
    if (event.data) data = { ...data, ...event.data.json() };
  } catch {
    if (event.data) data.body = event.data.text();
  }
  const isAlarm = data.kind === "smart-alarm";
  const options: NotificationOptions & { vibrate?: number[] } = {
    body: data.body,
    icon: "/icon-512.png",
    badge: "/icon-512.png",
    tag: data.tag || data.kind || "restpilot",
    data: { url: data.url || "/plan", kind: data.kind || null },
    requireInteraction: isAlarm,
    silent: false,
    vibrate: isAlarm
      ? [400, 200, 400, 200, 400, 200, 400, 200, 400]
      : [80, 40, 80],
  };
  event.waitUntil(self.registration.showNotification(data.title, options));
});

self.addEventListener("notificationclick", (event: NotificationEvent) => {
  event.notification.close();
  const url = (event.notification.data && (event.notification.data as any).url) || "/";
  event.waitUntil(
    (async () => {
      const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of all) {
        if ("focus" in client) {
          (client as WindowClient).focus();
          if ("navigate" in client) await (client as WindowClient).navigate(url);
          return;
        }
      }
      if (self.clients.openWindow) await self.clients.openWindow(url);
    })(),
  );
});
