import { createFileRoute } from "@tanstack/react-router";
import { LegalLayout } from "@/components/legal/LegalLayout";
import { findLegalDoc } from "@/lib/legal/meta";

const DOC = findLegalDoc("open-source")!;

type Pkg = { name: string; license: string; url: string };

// Curated list of the major third-party open-source packages RestPilot AI
// depends on. Update when dependencies change. Full machine-readable list
// can be regenerated at build time in a future iteration.
const PACKAGES: Pkg[] = [
  { name: "React", license: "MIT", url: "https://github.com/facebook/react" },
  { name: "TanStack Start", license: "MIT", url: "https://github.com/TanStack/router" },
  { name: "TanStack Router", license: "MIT", url: "https://github.com/TanStack/router" },
  { name: "TanStack Query", license: "MIT", url: "https://github.com/TanStack/query" },
  { name: "Vite", license: "MIT", url: "https://github.com/vitejs/vite" },
  { name: "TypeScript", license: "Apache-2.0", url: "https://github.com/microsoft/TypeScript" },
  { name: "Tailwind CSS", license: "MIT", url: "https://github.com/tailwindlabs/tailwindcss" },
  { name: "Radix UI", license: "MIT", url: "https://github.com/radix-ui/primitives" },
  { name: "shadcn/ui", license: "MIT", url: "https://github.com/shadcn-ui/ui" },
  { name: "Lucide Icons", license: "ISC", url: "https://github.com/lucide-icons/lucide" },
  { name: "Zod", license: "MIT", url: "https://github.com/colinhacks/zod" },
  { name: "date-fns", license: "MIT", url: "https://github.com/date-fns/date-fns" },
  { name: "Sonner", license: "MIT", url: "https://github.com/emilkowalski/sonner" },
  { name: "Recharts", license: "MIT", url: "https://github.com/recharts/recharts" },
  { name: "vite-plugin-pwa", license: "MIT", url: "https://github.com/vite-pwa/vite-plugin-pwa" },
  { name: "Workbox", license: "MIT", url: "https://github.com/GoogleChrome/workbox" },
  { name: "@supabase/supabase-js", license: "MIT", url: "https://github.com/supabase/supabase-js" },
  { name: "Stripe Node SDK", license: "MIT", url: "https://github.com/stripe/stripe-node" },
  { name: "web-push", license: "MPL-2.0", url: "https://github.com/web-push-libs/web-push" },
];

export const Route = createFileRoute("/legal/open-source")({
  head: () => ({
    meta: [
      { title: `${DOC.title} — RestPilot AI` },
      { name: "description", content: DOC.summary },
      { property: "og:title", content: `${DOC.title} — RestPilot AI` },
      { property: "og:description", content: DOC.summary },
      { property: "og:url", content: DOC.path },
    ],
    links: [{ rel: "canonical", href: DOC.path }],
  }),
  component: () => (
    <LegalLayout doc={DOC}>
      <p>
        RestPilot AI is built on top of open-source software. We honor the
        applicable open-source licenses and preserve required copyright and
        license notices. The list below covers the major third-party
        packages we ship. Each package is © its respective authors and is
        used under the listed license. Full license texts are available on
        each package's source page.
      </p>

      <h2>Major packages</h2>
      <div className="not-prose mt-4 overflow-hidden rounded-2xl border border-border/60">
        <table className="w-full border-collapse text-sm">
          <thead className="bg-muted/30 text-xs uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-4 py-2 text-left font-semibold">Package</th>
              <th className="px-4 py-2 text-left font-semibold">License</th>
              <th className="px-4 py-2 text-left font-semibold">Source</th>
            </tr>
          </thead>
          <tbody>
            {PACKAGES.map((p) => (
              <tr key={p.name} className="border-t border-border/60">
                <td className="px-4 py-2 font-medium text-foreground">{p.name}</td>
                <td className="px-4 py-2 text-muted-foreground">{p.license}</td>
                <td className="px-4 py-2">
                  <a
                    href={p.url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-primary underline"
                  >
                    Repository
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2>How to request notices</h2>
      <p>
        For a complete machine-readable list of all open-source dependencies
        and their license texts, email{" "}
        <a href="mailto:support@restpilotai.com">support@restpilotai.com</a>. We will
        provide a copy at no charge.
      </p>

      <h2>Reporting issues</h2>
      <p>
        If you believe an open-source notice is missing or incorrect, please
        email{" "}
        <a href="mailto:support@restpilotai.com">support@restpilotai.com</a> and we
        will investigate.
      </p>
    </LegalLayout>
  ),
});
