// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, nitro (build-only using cloudflare as a default target),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import { VitePWA } from "vite-plugin-pwa";

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
          globPatterns: ["**/*.{js,css,html,svg,png,ico,woff,woff2,webmanifest}"],
          // Don't precache the source SW file itself or large media.
          globIgnores: ["**/sw-src.*", "**/*.map"],
          maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        },
        manifest: false, // existing public/manifest.webmanifest is the source of truth
      }),
    ],
  },
});
