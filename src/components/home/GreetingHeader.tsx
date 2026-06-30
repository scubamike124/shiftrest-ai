import { Link } from "@tanstack/react-router";
import { OrbBadge } from "@/components/PilotOrb";

function greeting(hour: number, name: string) {
  const part = hour < 5 ? "Still up" : hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : hour < 22 ? "Good evening" : "Winding down";
  return name ? `${part}, ${name}` : part;
}

export function GreetingHeader({ name, now, dateLabel }: { name: string; now: Date; dateLabel: string }) {
  const hour = now.getHours();
  const title = greeting(hour, name);

  return (
    <header className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4">
      <div className="min-w-0">
        <p className="card-eyebrow">{dateLabel || "Today"}</p>
        <h1
          className="mt-1 truncate text-3xl text-foreground sm:text-4xl"
          style={{ fontFamily: "var(--font-display)", letterSpacing: "-0.02em" }}
        >
          {title}
        </h1>
        <p className="mt-1 text-xs text-muted-foreground">
          Your sleep coach is one tap away.
        </p>
      </div>

      <Link
        to="/companion"
        aria-label="Open Companion"
        className="relative flex h-14 w-14 shrink-0 items-center justify-center rounded-full border border-white/15 bg-card/70 backdrop-blur-xl"
      >
        <span className="pointer-events-none absolute inset-0 rounded-full bg-gradient-to-br from-primary/30 via-transparent to-transparent" />
        <OrbBadge state="idle" size="sm" />
      </Link>
    </header>
  );
}
