import { Link } from "@tanstack/react-router";
import { OrbBadge } from "@/components/PilotOrb";
import { greetingWithName } from "@/lib/time/day-part";

export function GreetingHeader({ name, now, dateLabel }: { name: string; now: Date; dateLabel: string }) {
  const title = greetingWithName(name, now);

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
        className="group relative flex h-14 w-14 shrink-0 items-center justify-center rounded-full border border-white/15 bg-card/70 backdrop-blur-xl transition hover:border-primary/40 active:scale-95"
      >
        <span className="pointer-events-none absolute inset-0 rounded-full bg-gradient-to-br from-primary/30 via-transparent to-transparent" />
        <span className="pointer-events-none absolute -inset-1 rounded-full bg-primary/20 opacity-0 blur-md transition group-hover:opacity-100" />
        <OrbBadge state="idle" size="sm" />
      </Link>
    </header>
  );
}
