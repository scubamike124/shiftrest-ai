import { createFileRoute } from "@tanstack/react-router";
import type {} from "@tanstack/react-start";

const BASE_URL = "https://shift-rest-ai.lovable.app";

interface SitemapEntry {
  path: string;
  changefreq?: "always" | "hourly" | "daily" | "weekly" | "monthly" | "yearly" | "never";
  priority?: string;
}

// Phase 1 public, indexable routes. Excludes /qa/*, /lab/*, /version,
// /api/*, and any authenticated app surface (dashboard, companion, etc.).
const ENTRIES: SitemapEntry[] = [
  { path: "/", changefreq: "weekly", priority: "1.0" },
  { path: "/pricing", changefreq: "monthly", priority: "0.9" },
  { path: "/features", changefreq: "monthly", priority: "0.8" },
  { path: "/auth", changefreq: "yearly", priority: "0.3" },
  { path: "/privacy", changefreq: "yearly", priority: "0.4" },
  { path: "/terms", changefreq: "yearly", priority: "0.4" },
  { path: "/legal", changefreq: "monthly", priority: "0.5" },
  { path: "/legal/acceptable-use", changefreq: "yearly", priority: "0.3" },
  { path: "/legal/accessibility", changefreq: "yearly", priority: "0.3" },
  { path: "/legal/cookies", changefreq: "yearly", priority: "0.3" },
  { path: "/legal/copyright", changefreq: "yearly", priority: "0.3" },
  { path: "/legal/disclaimers", changefreq: "yearly", priority: "0.3" },
  { path: "/legal/electronic-consent", changefreq: "yearly", priority: "0.3" },
  { path: "/legal/license", changefreq: "yearly", priority: "0.3" },
  { path: "/legal/open-source", changefreq: "yearly", priority: "0.3" },
  { path: "/legal/privacy", changefreq: "yearly", priority: "0.4" },
  { path: "/legal/regional", changefreq: "yearly", priority: "0.3" },
  { path: "/legal/security", changefreq: "yearly", priority: "0.3" },
  { path: "/legal/subscription", changefreq: "yearly", priority: "0.3" },
  { path: "/legal/terms", changefreq: "yearly", priority: "0.4" },
  { path: "/legal/third-parties", changefreq: "yearly", priority: "0.3" },
  { path: "/legal/trademark", changefreq: "yearly", priority: "0.3" },
];

export const Route = createFileRoute("/sitemap.xml")({
  server: {
    handlers: {
      GET: async () => {
        const urls = ENTRIES.map((e) =>
          [
            `  <url>`,
            `    <loc>${BASE_URL}${e.path}</loc>`,
            e.changefreq ? `    <changefreq>${e.changefreq}</changefreq>` : null,
            e.priority ? `    <priority>${e.priority}</priority>` : null,
            `  </url>`,
          ]
            .filter(Boolean)
            .join("\n"),
        );

        const xml = [
          `<?xml version="1.0" encoding="UTF-8"?>`,
          `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`,
          ...urls,
          `</urlset>`,
        ].join("\n");

        return new Response(xml, {
          headers: {
            "Content-Type": "application/xml",
            "Cache-Control": "public, max-age=3600",
          },
        });
      },
    },
  },
});
