// Loads the app's own server-side AI modules (TypeScript, "@/..." imports)
// through Vite's SSR loader, so evals exercise the exact prompt-assembly code
// that /api/ai runs in production instead of a copy of it.
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
let serverPromise;

async function server() {
  if (!serverPromise) {
    serverPromise = (async () => {
      const { createServer } = await import("vite");
      return createServer({
        configFile: false,
        root: repoRoot,
        logLevel: "error",
        appType: "custom",
        resolve: { alias: { "@": path.join(repoRoot, "src") } },
        server: { middlewareMode: true, hmr: false, watch: null },
        optimizeDeps: { noDiscovery: true, include: [] },
      });
    })();
  }
  return serverPromise;
}

/** Import a module under src/ (e.g. "lib/ai/context.server.ts"). */
export async function loadAppModule(relativeToSrc) {
  const s = await server();
  return s.ssrLoadModule(path.join(repoRoot, "src", relativeToSrc));
}

export async function closeAppLoader() {
  if (serverPromise) {
    const s = await serverPromise;
    serverPromise = undefined;
    await s.close();
  }
}

export { repoRoot };
