import { Link } from "@tanstack/react-router";
import { MessageCircle } from "lucide-react";
import { PilotPortrait } from "@/components/companion/PilotPortrait";
import { greetingWithName } from "@/lib/time/day-part";
import { buildGreetingLine, type GreetingContext } from "@/lib/greeting/context";

/**
 * Home focal-point hero — makes the AI Companion the centerpiece.
 * Portrait + personal greeting + contextual sub-line + one-tap "Talk to Pilot".
 * All data passed in props (no fetches) — computed by the dashboard route.
 */
export function CompanionHero({
  name,
  now,
  dateLabel,
  context,
}: {
  name: string;
  now: Date;
  dateLabel: string;
  context: Omit<GreetingContext, "now">;
}) {
  const title = greetingWithName(name, now);
  const line = buildGreetingLine({ now, ...context });

  return (
    <section
      aria-label="Your AI companion"
      className="relative overflow-hidden rounded-3xl border border-white/10 bg-card/60 backdrop-blur-xl p-5 shadow-[0_10px_40px_-15px_hsl(var(--primary)/0.4)] sm:p-6"
    >
      <div aria-hidden className="pointer-events-none absolute inset-0 opacity-70">
        <div className="absolute -left-16 -top-16 h-64 w-64 rounded-full bg-primary/20 blur-3xl" />
        <div className="absolute -right-10 bottom-0 h-48 w-48 rounded-full bg-sky-500/15 blur-3xl" />
      </div>

      <div className="relative grid grid-cols-[auto_minmax(0,1fr)] items-center gap-3 sm:gap-6">
        <div className="shrink-0">
          {/* Smaller portrait on phones so the greeting has room to breathe */}
          <div className="sm:hidden">
            <PilotPortrait state="idle" size="md" eager />
          </div>
          <div className="hidden sm:block">
            <PilotPortrait state="idle" size="lg" eager />
          </div>
        </div>

        <div className="min-w-0">
          <p className="card-eyebrow">{dateLabel || "Today"}</p>
          <h1
            className="mt-1 text-[1.35rem] leading-tight text-foreground sm:text-3xl sm:truncate"
            style={{ fontFamily: "var(--font-display)", letterSpacing: "-0.02em", overflowWrap: "anywhere" }}
          >
            {title}
          </h1>
          <p className="mt-1.5 text-sm text-muted-foreground sm:text-[15px] sm:line-clamp-2">
            {line}
          </p>
        </div>
      </div>

      <Link
        to="/companion"
        className="relative mt-5 flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-primary via-primary to-indigo-500 text-sm font-semibold text-primary-foreground shadow-[0_10px_30px_-8px_hsl(var(--primary)/0.6)] transition active:scale-[0.99]"
      >
        <MessageCircle className="h-4 w-4" />
        Talk to Pilot
      </Link>
    </section>
  );
}
