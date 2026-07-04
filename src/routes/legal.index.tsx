import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";
import { LEGAL_DOCS, LEGAL_EFFECTIVE } from "@/lib/legal/meta";

export const Route = createFileRoute("/legal/")({
  head: () => ({
    meta: [
      { title: "Legal — RestPilot AI" },
      {
        name: "description",
        content:
          "Terms, Privacy Policy, disclaimers, subscription terms, and all RestPilot AI legal documents in one place.",
      },
      { property: "og:title", content: "Legal — RestPilot AI" },
      {
        property: "og:description",
        content: "All RestPilot AI legal documents in one place.",
      },
      { property: "og:url", content: "/legal" },
    ],
    links: [{ rel: "canonical", href: "/legal" }],
  }),
  component: LegalIndex,
});

const SECTIONS: Array<{ title: string; category: string }> = [
  { title: "Core legal", category: "core" },
  { title: "Disclosures", category: "disclosure" },
  { title: "Billing", category: "billing" },
  { title: "Policies", category: "policy" },
  { title: "Intellectual property", category: "ip" },
];

function LegalIndex() {
  return (
    <section className="mx-auto w-full max-w-5xl px-5 pb-24 pt-12 lg:px-10" aria-label="Legal documents">
      <header>
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">
          Legal
        </p>
        <h1 className="mt-2 text-4xl font-bold tracking-tight">
          RestPilot AI legal documents
        </h1>
        <p className="mt-3 max-w-2xl text-sm text-muted-foreground">
          The full set of agreements, disclaimers, and disclosures that apply to
          your use of RestPilot AI. Effective {formatDate(LEGAL_EFFECTIVE)}.
          Documents are draft templates and will be finalized by qualified
          counsel before launch.
        </p>
      </header>

      <div className="mt-12 space-y-10">
        {SECTIONS.map((section) => {
          const docs = LEGAL_DOCS.filter((d) => d.category === section.category);
          if (!docs.length) return null;
          return (
            <section key={section.category}>
              <h2 className="text-[11px] font-semibold uppercase tracking-[0.2em] text-indigo-glow">
                {section.title}
              </h2>
              <ul className="mt-4 grid gap-3 sm:grid-cols-2">
                {docs.map((d) => (
                  <li key={d.slug}>
                    <Link
                      to={d.path}
                      className="group flex h-full items-start justify-between gap-3 rounded-2xl border border-border/60 bg-card/40 p-5 transition hover:border-primary/40 hover:bg-card/60"
                    >
                      <div>
                        <p className="text-sm font-semibold text-foreground">
                          {d.title}
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {d.summary}
                        </p>
                      </div>
                      <ChevronRight className="mt-1 h-4 w-4 flex-none text-muted-foreground transition group-hover:translate-x-0.5 group-hover:text-foreground" />
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>

      <footer className="mt-16 border-t border-border/60 pt-6 text-xs text-muted-foreground">
        Questions? Email{" "}
        <a href="mailto:support@restpilotai.com" className="text-primary underline">
          support@restpilotai.com
        </a>
        . Security reports go to{" "}
        <a
          href="mailto:security@restpilotai.com"
          className="text-primary underline"
        >
          security@restpilotai.com
        </a>
        .
      </footer>
    </section>
  );
}

function formatDate(iso: string) {
  return new Date(iso + "T00:00:00Z").toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}
