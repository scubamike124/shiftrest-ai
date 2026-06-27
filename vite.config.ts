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
 * vite-plugin-pwa writes the compiled service worker to the top-level
 * Vite outDir (`dist/sw-src.js`). Cloudflare/Nitro actually serves the
 * client bundle from `dist/client`, so the worker must live there to
 * be reachable as `/sw.js`. We let PWA generate the manifest against
 * `dist/client` (so precache URLs are `/assets/...`), then move the
 * emitted worker into `dist/client/sw.js` in a closeBundle hook.
 */
function relocatePwaWorker(): Plugin {
  return {
    name: "rpai-relocate-sw",
    apply: "build",
    enforce: "post",
    closeBundle: {
      sequential: true,
      order: "post",
      handler() {
        const root = process.cwd();
        const src = resolve(root, "dist/sw-src.js");
        const dest = resolve(root, "dist/client/sw.js");
        if (!existsSync(src)) return;
        mkdirSync(dirname(dest), { recursive: true });
        renameSync(src, dest);
        // Also clean up the stray source-file copy Nitro put under client/.
        const stray = resolve(root, "dist/client/sw-src.ts");
        if (existsSync(stray)) unlinkSync(stray);
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
