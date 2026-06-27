import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Menu, X, Moon } from "lucide-react";

const nav = [
  { to: "/features", label: "Features" },
  { to: "/pricing", label: "Pricing" },
  { to: "/privacy", label: "Privacy" },
];

export function SiteHeader({ signedIn }: { signedIn: boolean }) {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={`sticky top-0 z-40 w-full transition-colors ${
        scrolled
          ? "border-b border-border/60 bg-background/80 backdrop-blur-xl"
          : "border-b border-transparent bg-transparent"
      }`}
    >
      <div className="mx-auto flex h-16 w-full max-w-7xl items-center justify-between gap-4 px-5 lg:h-20 lg:px-10">
        <Link to="/" className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl border border-primary/30 bg-gradient-to-br from-indigo to-secondary shadow-[var(--shadow-glow)]">
            <Moon className="h-4 w-4 text-primary-foreground" />
          </span>
          <span className="text-base font-semibold tracking-tight">
            RestPilot <span className="text-indigo-glow">AI</span>
          </span>
        </Link>

        <nav className="hidden items-center gap-1 md:flex">
          {nav.map((n) => (
            <Link
              key={n.to}
              to={n.to}
              className="rounded-full px-4 py-2 text-sm font-medium text-muted-foreground transition hover:bg-secondary/60 hover:text-foreground"
              activeProps={{ className: "text-foreground bg-secondary/60" }}
            >
              {n.label}
            </Link>
          ))}
        </nav>

        <div className="hidden items-center gap-2 md:flex">
          {signedIn ? (
            <Link
              to="/dashboard"
              className="rounded-full bg-foreground px-5 py-2 text-sm font-semibold text-background transition hover:opacity-90"
            >
              Open app
            </Link>
          ) : (
            <>
              <Link
                to="/auth"
                className="rounded-full px-4 py-2 text-sm font-medium text-muted-foreground transition hover:text-foreground"
              >
                Sign in
              </Link>
              <Link
                to="/auth"
                className="rounded-full bg-foreground px-5 py-2 text-sm font-semibold text-background transition hover:opacity-90"
              >
                Get started
              </Link>
            </>
          )}
        </div>

        <button
          onClick={() => setOpen((v) => !v)}
          className="flex h-10 w-10 items-center justify-center rounded-xl border border-border bg-card/60 md:hidden"
          aria-label="Menu"
        >
          {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </div>

      {open && (
        <div className="border-t border-border/60 bg-background/95 backdrop-blur-xl md:hidden">
          <div className="mx-auto flex w-full max-w-7xl flex-col gap-1 px-5 py-3">
            {nav.map((n) => (
              <Link
                key={n.to}
                to={n.to}
                onClick={() => setOpen(false)}
                className="rounded-xl px-3 py-3 text-sm font-medium text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
              >
                {n.label}
              </Link>
            ))}
            <div className="mt-2 flex gap-2">
              {signedIn ? (
                <Link
                  to="/dashboard"
                  onClick={() => setOpen(false)}
                  className="flex-1 rounded-full bg-foreground px-4 py-2.5 text-center text-sm font-semibold text-background"
                >
                  Open app
                </Link>
              ) : (
                <>
                  <Link
                    to="/auth"
                    onClick={() => setOpen(false)}
                    className="flex-1 rounded-full border border-border px-4 py-2.5 text-center text-sm font-semibold"
                  >
                    Sign in
                  </Link>
                  <Link
                    to="/auth"
                    onClick={() => setOpen(false)}
                    className="flex-1 rounded-full bg-foreground px-4 py-2.5 text-center text-sm font-semibold text-background"
                  >
                    Get started
                  </Link>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </header>
  );
}
