/**
 * GET /api/public/version — public deployment fingerprint.
 *
 * Returns the build ID injected at build time (see vite.config.ts → `define.__BUILD_ID__`)
 * and the server's current time. Hit this on Preview and Production to confirm
 * each environment is serving the deployment you just published:
 *
 *   curl https://shift-rest-ai.lovable.app/api/public/version
 *   curl https://id-preview--<id>.lovable.app/api/public/version
 *
 * If `buildId` differs after clicking Publish → Update, production rotated.
 * If it stays the same, the publish did not promote a new deployment.
 *
 * No auth required; no PII; safe to share.
 */
import { createFileRoute } from "@tanstack/react-router";

declare const __BUILD_ID__: string;

export const Route = createFileRoute("/api/public/version")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        return Response.json(
          {
            buildId: __BUILD_ID__,
            builtAt: __BUILD_ID__.startsWith("b-")
              ? new Date(Number(__BUILD_ID__.slice(2))).toISOString()
              : null,
            servedAt: new Date().toISOString(),
            host: url.host,
          },
          {
            headers: {
              "cache-control": "no-store, must-revalidate",
            },
          },
        );
      },
    },
  },
});
