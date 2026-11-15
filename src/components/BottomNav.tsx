import { Link, useRouterState } from "@tanstack/react-router";
import { LayoutDashboard, User, Sun, Calendar } from "lucide-react";
import { OrbBadge } from "@/components/PilotOrb";

const tabs = [
  { to: "/dashboard", label: "Home", icon: LayoutDashboard },
  { to: "/plan", label: "Plan", icon: Sun },
  { to: "/companion", label: "Companion", icon: null },
  { to: "/events", label: "Events", icon: Calendar },
  { to: "/profile", label: "Profile", icon: User },
] as const;

/**
 * Mobile-only bottom navigation. Hidden on desktop where the AppSidebar takes
 * over. Renders only on app routes via the parent shell.
 *
 * The AI companion is the centre tab, so it is one thumb-tap away on every
 * screen without a floating button covering page content. The Companion screen
 * has its own tap-to-talk microphone; the separate voice Pilot screen is in the
 * dashboard's Quick Actions (and the desktop sidebar).
 */
export function BottomNav() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  return (
    <nav
      aria-label="App"
      data-bottom-nav=""
      className="fixed bottom-0 inset-x-0 z-40 border-t border-border bg-background/90 pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)] backdrop-blur-xl lg:hidden"
    >
      <ul className="mx-auto flex max-w-md items-stretch justify-around">
        {tabs.map((t) => {
          const active = pathname === t.to;
          const Icon = t.icon;
          return (
            <li key={t.to} className="flex-1">
              <Link
                to={t.to}
                aria-current={active ? "page" : undefined}
                className={`flex min-h-[60px] flex-col items-center justify-center gap-1 py-2 text-[11px] font-medium transition-all active:scale-95 ${
                  active ? "text-primary" : "text-muted-foreground"
                }`}
              >
                <span
                  className={`flex h-8 w-8 items-center justify-center rounded-full transition-all ${
                    active ? "bg-primary/15 shadow-[var(--shadow-glow)]" : ""
                  }`}
                >
                  {Icon ? <Icon className="h-5 w-5" /> : <OrbBadge state="idle" size="sm" className="h-8 w-8" />}
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
