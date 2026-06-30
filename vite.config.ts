// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, nitro (build-only using cloudflare as a default target),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import { VitePWA } from "vite-plugin-pwa";
import { renameSync, existsSync, mkdirSync, unlinkSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { Plugin } from "vite";

/**
 * vite-plugin-pwa runs as a separate Vite build that fires AFTER the
 * main client build's closeBundle. Cloudflare/Nitro serves the client
 * bundle from `dist/client`, so the worker must live there to be
 * reachable as `/sw.js`. A regular `closeBundle` hook in the main
 * config would run BEFORE PWA's worker file exists, so we register a
 * `process.on("exit")` handler that fires once the whole build
 * pipeline (main → PWA → Nitro) has finished and the worker is on
 * disk. The handler is idempotent and safe to run multiple times.
 */
function relocatePwaWorker(): Plugin {
  let registered = false;
  const doMove = () => {
    const root = process.cwd();
    const candidates = [
      resolve(root, "dist/sw-src.js"),
      resolve(root, "dist/client/sw-src.js"),
    ];
    const src = candidates.find((p) => existsSync(p));
    const dest = resolve(root, "dist/client/sw.js");
    if (src) {
      mkdirSync(dirname(dest), { recursive: true });
      renameSync(src, dest);
    }
    // Strip the raw TS source if Nitro copied it across.
    for (const stray of [
      resolve(root, "dist/client/sw-src.ts"),
      resolve(root, "dist/sw-src.ts"),
    ]) {
      if (existsSync(stray)) unlinkSync(stray);
    }
  };
  return {
    name: "rpai-relocate-sw",
    apply: "build",
    enforce: "post",
    buildStart() {
      if (registered) return;
      registered = true;
      process.on("exit", () => {
        try {
          doMove();
        } catch {
          /* best-effort */
        }
      });
    },
    // Also run at closeBundle as a belt-and-suspenders for builds that
    // happen to have the file ready (e.g. Nitro-pass build).
    closeBundle: {
      sequential: true,
      order: "post",
      handler() {
        try {
          doMove();
        } catch {
          /* best-effort */
        }
      },
    },
  };
}


export default defineConfig({
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
  vite: {
    // Build-time identifier baked into both the client bundle and the
    // service worker source. Used by:
    //   • src/lib/pwa/register.ts — keys the auto-skip-waiting token so
    //     every new deploy is allowed to auto-activate once per session
    //     on installed PWAs (iOS Home-Screen).
    //   • public/sw-src.ts — included in CACHE_VERSION so the activate
    //     handler purges every prior release's caches.
    define: {
      __BUILD_ID__: JSON.stringify(`b-${Date.now()}`),
    },
    plugins: [
      // App-shell PWA. injectManifest mode lets us keep the existing push
      // notification handlers in `public/sw-src.ts` (Smart Alarm depends on
      // them) and layer Workbox precache + runtime routes on top, compiled
      // to a single `/sw.js` at the same scope. Never registers in dev or
      // Lovable preview — the wrapper in `src/lib/pwa/register.ts` enforces
      // the guards.
      VitePWA({
        strategies: "injectManifest",
        srcDir: "public",
        filename: "sw-src.ts",
        injectRegister: null,
        registerType: "autoUpdate",
        devOptions: { enabled: false },
        injectManifest: {
          // Precache from the Nitro client bundle so URLs are `/assets/...`
          // (NOT `/client/assets/...`).
          globDirectory: "dist/client",
          globPatterns: ["**/*.{js,css,html,svg,png,ico,woff,woff2,webmanifest}"],
          // Don't precache the source SW file itself, sourcemaps, or
          // anything that would shadow the runtime worker.
          globIgnores: ["**/sw-src.*", "**/sw.js", "**/*.map"],
          maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
          // Offline navigation fallback — guarantees `/` is in the
          // precache so cold offline opens hit the cached app shell
          // instead of the browser's offline page.
          additionalManifestEntries: [{ url: "/", revision: `${Date.now()}` }],
        },
        manifest: false, // existing public/manifest.webmanifest is the source of truth
      }),
      relocatePwaWorker(),
    ],
  },
});
