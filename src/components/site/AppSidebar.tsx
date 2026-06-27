import { Link, useRouterState } from "@tanstack/react-router";
import {
  LayoutDashboard,
  Sun,
  MessageCircle,
  Calendar,
  BookOpen,
  Repeat,
  User,
  Sparkles,
  Moon,
  Brain,
} from "lucide-react";

const nav = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/plan", label: "Today's Plan", icon: Sun },
  { to: "/coach", label: "AI Coach", icon: MessageCircle },
  { to: "/events", label: "Events & Alarm", icon: Calendar },
  { to: "/memory", label: "Memory", icon: Brain },
  { to: "/playbooks", label: "Playbooks", icon: BookOpen },
  { to: "/swap", label: "Shift Swap", icon: Repeat },
] as const;

const footerNav = [
  { to: "/paywall", label: "Upgrade", icon: Sparkles },
  { to: "/profile", label: "Profile", icon: User },
] as const;

export function AppSidebar() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  return (
    <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r border-border/60 bg-background/40 px-4 py-6 lg:flex">
      <Link to="/" className="flex items-center gap-2.5 px-2">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl border border-primary/30 bg-gradient-to-br from-indigo to-secondary shadow-[var(--shadow-glow)]">
          <Moon className="h-4 w-4 text-primary-foreground" />
        </span>
        <span className="text-base font-semibold tracking-tight">
          RestPilot <span className="text-indigo-glow">AI</span>
        </span>
      </Link>

      <nav className="mt-10 flex flex-1 flex-col gap-0.5">
        <p className="px-3 pb-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
          Workspace
        </p>
        {nav.map((n) => {
          const active = pathname === n.to;
          const Icon = n.icon;
          return (
            <Link
              key={n.to}
              to={n.to}
              className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition ${
                active
                  ? "bg-secondary/80 text-foreground"
                  : "text-muted-foreground hover:bg-secondary/40 hover:text-foreground"
              }`}
            >
              <Icon className="h-4 w-4" />
              {n.label}
            </Link>
          );
        })}
      </nav>

      <div className="flex flex-col gap-0.5 border-t border-border/60 pt-4">
        {footerNav.map((n) => {
          const active = pathname === n.to;
          const Icon = n.icon;
          return (
            <Link
              key={n.to}
              to={n.to}
              className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition ${
                active
                  ? "bg-secondary/80 text-foreground"
                  : "text-muted-foreground hover:bg-secondary/40 hover:text-foreground"
              }`}
            >
              <Icon className="h-4 w-4" />
              {n.label}
            </Link>
          );
        })}
      </div>
    </aside>
  );
}
