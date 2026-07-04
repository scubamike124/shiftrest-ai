// CSP violation-report sink.
//
// The `Content-Security-Policy-Report-Only` header set in src/start.ts
// points browsers at this endpoint. Browsers POST a small JSON payload
// (`application/csp-report` or `application/reports+json`) describing each
// blocked resource. We log a compact summary server-side so we can spot
// unexpected origins before flipping the header to enforcing mode.
//
// This route is intentionally public (no auth) — browsers send reports
// without credentials — and non-response (always 204). It never returns
// user data, never persists to the DB, and rate-limiting is unnecessary
// because bogus POSTs cost only a console line.

import { createFileRoute } from "@tanstack/react-router";

interface LegacyReport {
  "csp-report"?: {
    "document-uri"?: string;
    "violated-directive"?: string;
    "effective-directive"?: string;
    "blocked-uri"?: string;
    "source-file"?: string;
    "line-number"?: number;
  };
}

interface ReportsApiEntry {
  type?: string;
  body?: {
    documentURL?: string;
    effectiveDirective?: string;
    blockedURL?: string;
    sourceFile?: string;
    lineNumber?: number;
  };
}

export const Route = createFileRoute("/api/public/csp-report")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const raw = await request.text();
          if (raw) {
            let summary: string | null = null;
            try {
              const parsed = JSON.parse(raw);
              const legacy = (parsed as LegacyReport)["csp-report"];
              if (legacy) {
                summary = `[csp-ro] directive=${legacy["effective-directive"] ?? legacy["violated-directive"]} blocked=${legacy["blocked-uri"]} on=${legacy["document-uri"]}`;
              } else if (Array.isArray(parsed)) {
                const first = parsed[0] as ReportsApiEntry | undefined;
                if (first?.body) {
                  summary = `[csp-ro] directive=${first.body.effectiveDirective} blocked=${first.body.blockedURL} on=${first.body.documentURL}`;
                }
              }
            } catch {
              summary = `[csp-ro] unparseable report (${raw.length} bytes)`;
            }
            if (summary) console.warn(summary);
          }
        } catch {
          /* swallow */
        }
        return new Response(null, { status: 204 });
      },
      // Some browsers preflight the report endpoint.
      OPTIONS: async () =>
        new Response(null, {
          status: 204,
          headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type",
          },
        }),
    },
  },
});
