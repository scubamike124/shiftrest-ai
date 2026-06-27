import { Link, useRouterState } from "@tanstack/react-router";
import { LayoutDashboard, Mic, User, Sun, Calendar } from "lucide-react";

const tabs = [
  { to: "/dashboard", label: "Home", icon: LayoutDashboard },
  { to: "/plan", label: "Plan", icon: Sun },
  { to: "/pilot", label: "Pilot", icon: Mic },
  { to: "/events", label: "Events", icon: Calendar },
  { to: "/profile", label: "Profile", icon: User },
] as const;

/**
 * Mobile-only bottom navigation. Hidden on desktop where the AppSidebar takes
 * over. Renders only on app routes via the parent shell.
 */
export function BottomNav() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  return (
    <nav className="fixed bottom-0 inset-x-0 z-40 border-t border-border bg-background/85 backdrop-blur-xl pb-[env(safe-area-inset-bottom)] lg:hidden">
      <ul className="mx-auto flex max-w-md items-stretch justify-around">
        {tabs.map((t) => {
          const active = pathname === t.to;
          const Icon = t.icon;
          return (
            <li key={t.to} className="flex-1">
              <Link
                to={t.to}
                className={`flex flex-col items-center gap-1 py-2.5 text-[10px] font-medium transition-colors ${
                  active ? "text-primary" : "text-muted-foreground"
                }`}
              >
                <span
                  className={`flex h-8 w-8 items-center justify-center rounded-full transition-all ${
                    active ? "bg-primary/15 shadow-[var(--shadow-glow)]" : ""
                  }`}
                >
                  <Icon className="h-4 w-4" />
                </span>
                {t.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
