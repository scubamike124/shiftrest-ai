import { Link } from "@tanstack/react-router";
import { Sun, CalendarClock, MessageSquare, Moon, Activity, Mic } from "lucide-react";
import { HomeCard, HomeCardHeader } from "./HomeCard";

const ACTIONS = [
  { to: "/plan", label: "Light Plan", icon: Sun },
  { to: "/sleep", label: "Sleep Mode", icon: Moon },
  { to: "/pilot", label: "Voice Pilot", icon: Mic },
  { to: "/events", label: "Smart Alarm", icon: CalendarClock },
  { to: "/health", label: "Wellness", icon: Activity },
  { to: "/coach", label: "AI Coach", icon: MessageSquare },
] as const;

export function QuickActionsCard() {
  return (
    <HomeCard>
      <HomeCardHeader eyebrow="Quick Actions" title="Jump right in" />
      <div className="mt-4 grid grid-cols-3 gap-2">
        {ACTIONS.map(({ to, label, icon: Icon }) => (
          <Link
            key={to}
            to={to}
            className="group flex flex-col items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-2 py-3 text-center transition hover:border-primary/40 hover:bg-primary/10 active:scale-95"
          >
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/20 text-indigo-glow transition group-hover:bg-primary/30">
              <Icon className="h-4 w-4" />
            </span>
            <span className="text-[10px] font-semibold uppercase tracking-wider text-foreground/80">{label}</span>
          </Link>
        ))}
      </div>
    </HomeCard>
  );
}
