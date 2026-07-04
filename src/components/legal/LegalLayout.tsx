import { Link } from "@tanstack/react-router";
import { ReactNode } from "react";
import { AlertTriangle, FileText, Printer } from "lucide-react";
import { LEGAL_DOCS, type LegalDoc } from "@/lib/legal/meta";

type Props = {
  doc: LegalDoc;
  children: ReactNode;
};

export function LegalLayout({ doc, children }: Props) {
  return (
    <section className="mx-auto w-full max-w-7xl px-5 pb-24 pt-10 lg:px-10" aria-labelledby="legal-doc-title">
      <div className="mb-6 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <Link to="/legal" className="hover:text-foreground">
          Legal
        </Link>
        <span>/</span>
        <span className="text-foreground">{doc.title}</span>
      </div>

      <div className="grid gap-10 lg:grid-cols-[260px_1fr]">
        <aside className="hidden lg:block">
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-indigo-glow">
            All documents
          </p>
          <nav className="mt-4 flex flex-col gap-1">
            {LEGAL_DOCS.map((d) => (
              <Link
                key={d.slug}
                to={d.path}
                className="rounded-lg px-3 py-2 text-sm text-muted-foreground transition hover:bg-muted/40 hover:text-foreground aria-[current=page]:bg-muted/60 aria-[current=page]:text-foreground"
                activeProps={{ "aria-current": "page" }}
              >
                {d.title}
              </Link>
            ))}
          </nav>
        </aside>

        <article className="min-w-0">
          <header className="border-b border-border/60 pb-6">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">
              {doc.category === "core"
                ? "Core legal"
                : doc.category === "billing"
                  ? "Billing"
                  : doc.category === "ip"
                    ? "Intellectual property"
                    : doc.category === "disclosure"
                      ? "Disclosure"
                      : "Policy"}
            </p>
            <h1 id="legal-doc-title" className="mt-2 text-3xl font-bold tracking-tight md:text-4xl">
              {doc.title}
            </h1>
            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
              <span>Effective: {formatDate(doc.effective)}</span>
              <span>Last updated: {formatDate(doc.effective)}</span>
              <button
                type="button"
                onClick={() => window.print()}
                className="inline-flex items-center gap-1 rounded-full border border-border/60 px-2.5 py-1 text-xs hover:text-foreground"
              >
                <Printer className="h-3 w-3" /> Print
              </button>
            </div>

            <div className="mt-5 flex items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 text-sm text-amber-200">
              <AlertTriangle className="mt-0.5 h-4 w-4 flex-none" />
              <div>
                <p className="font-semibold">Draft — pending attorney review</p>
                <p className="mt-1 text-xs text-amber-200/80">
                  This document is a working draft maintained by RestPilot AI. It
                  is not a substitute for legal advice and will be reviewed and
                  finalized by qualified counsel before launch.
                </p>
              </div>
            </div>

            <p className="mt-4 text-sm text-muted-foreground">{doc.summary}</p>
          </header>

          <section className="prose prose-invert mt-8 max-w-none space-y-5 text-sm leading-relaxed text-muted-foreground prose-headings:text-foreground prose-strong:text-foreground prose-a:text-primary prose-h2:mt-8 prose-h2:text-base prose-h2:font-semibold prose-h3:mt-6 prose-h3:text-sm prose-h3:font-semibold">
            {children}
          </section>

          <footer className="mt-12 flex flex-wrap items-center gap-3 border-t border-border/60 pt-6 text-xs text-muted-foreground">
            <FileText className="h-3 w-3" />
            <span>
              Questions about this document? Email{" "}
              <a
                href="mailto:support@restpilotai.com"
                className="text-primary underline"
              >
                support@restpilotai.com
              </a>
              .
            </span>
          </footer>
        </article>
      </div>
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
