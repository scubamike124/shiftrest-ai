import { Link } from "@tanstack/react-router";
import { Moon } from "lucide-react";
import { LEGAL_DOCS } from "@/lib/legal/meta";

export function SiteFooter() {
  const legalLinks = LEGAL_DOCS.map((d) => ({ to: d.path, label: d.title }));

  return (
    <footer className="mt-24 border-t border-border/60 bg-background/40">
      <div className="mx-auto grid w-full max-w-7xl gap-12 px-5 py-16 lg:grid-cols-[1.4fr_1fr_1fr_1.4fr] lg:px-10">
        <div>
          <div className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl border border-primary/30 bg-gradient-to-br from-indigo to-secondary">
              <Moon className="h-4 w-4 text-primary-foreground" />
            </span>
            <span className="text-base font-semibold tracking-tight">
              RestPilot <span className="text-indigo-glow">AI</span>
            </span>
          </div>
          <p className="mt-4 max-w-sm text-sm leading-relaxed text-muted-foreground">
            The AI rest platform for shift workers. Plan sleep, light, and
            recovery around a schedule that never stops moving.
          </p>
        </div>

        <FooterCol
          title="Product"
          links={[
            { to: "/features", label: "Features" },
            { to: "/pricing", label: "Pricing" },
            { to: "/dashboard", label: "Dashboard" },
            { to: "/safety", label: "Safety Center" },
          ]}
        />
        <FooterCol
          title="Account"
          links={[
            { to: "/auth", label: "Sign in" },
            { to: "/auth", label: "Get started" },
            { to: "/profile", label: "Profile" },
          ]}
        />
        <FooterCol title="Legal" links={legalLinks} />

      </div>
      <div className="border-t border-border/60">
        <div className="mx-auto flex w-full max-w-7xl flex-col items-start justify-between gap-3 px-5 py-6 text-xs text-muted-foreground lg:flex-row lg:items-center lg:px-10">
          <p>© {new Date().getFullYear()} RestPilot AI. All rights reserved.</p>
          <p className="opacity-70">
            Designed for humans who work nights. See our{" "}
            <Link to="/legal" className="underline hover:text-foreground">
              legal documents
            </Link>
            .
          </p>
        </div>
      </div>
    </footer>
  );
}

function FooterCol({
  title,
  links,
}: {
  title: string;
  links: { to: string; label: string }[];
}) {
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-indigo-glow">
        {title}
      </p>
      <ul className="mt-4 space-y-2.5">
        {links.map((l) => (
          <li key={l.to + l.label}>
            <Link
              to={l.to}
              className="text-sm text-muted-foreground transition hover:text-foreground"
            >
              {l.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
