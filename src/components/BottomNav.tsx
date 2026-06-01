import { Link, useRouterState } from "@tanstack/react-router";
import { Calendar, MessageCircle, User, Sun } from "lucide-react";

const tabs = [
  { to: "/", label: "Schedule", icon: Calendar },
  { to: "/plan", label: "Plan", icon: Sun },
  { to: "/coach", label: "Coach", icon: MessageCircle },
  { to: "/profile", label: "Profile", icon: User },
] as const;

export function BottomNav() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  // Hide on share view
  if (pathname.startsWith("/share")) return null;
  return (
    <nav className="fixed bottom-0 inset-x-0 z-40 border-t border-border bg-background/85 backdrop-blur-xl pb-[env(safe-area-inset-bottom)]">
      <ul className="mx-auto flex max-w-md items-stretch justify-around">
        {tabs.map((t) => {
          const active = pathname === t.to;
          const Icon = t.icon;
          return (
            <li key={t.to} className="flex-1">
              <Link
                to={t.to}
                className={`flex flex-col items-center gap-1 py-3 text-[11px] font-medium transition-colors ${
                  active ? "text-primary" : "text-muted-foreground"
                }`}
              >
                <span
                  className={`flex h-9 w-9 items-center justify-center rounded-full transition-all ${
                    active ? "bg-primary/15 shadow-[var(--shadow-glow)]" : ""
                  }`}
                >
                  <Icon className="h-5 w-5" />
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
