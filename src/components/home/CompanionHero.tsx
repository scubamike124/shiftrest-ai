// Home dashboard CompanionHero — greeting header + Pilot portrait + CTA.
// Reads the pure hero-state resolver to pick copy, then renders a calm
// entry point that navigates to /companion.
import { Link } from "@tanstack/react-router";
import { useMemo } from "react";
import { PilotPortrait } from "@/components/companion/PilotPortrait";
import { HomeCard } from "@/components/home/HomeCard";
import { resolveHero, type HeroSignals } from "@/lib/companion/hero-state";
import { periodFor } from "@/lib/companion/brief-window";
import { useOnline } from "@/hooks/use-online";

export type CompanionHeroContext = {
  nextShiftStart: Date | null;
  debtScore: number | null;
  recoveryScore: number | null;
  recommendedBedtime: Date | null;
};

export function CompanionHero({
  name,
  now,
  dateLabel,
  context,
}: {
  name: string;
  now: Date;
  dateLabel: string;
  context: CompanionHeroContext;
}) {
  const online = useOnline();
  const hour = now.getHours();

  const view = useMemo(() => {
    const signals: HeroSignals = {
      period: periodFor(now),
      periodFresh: false,
      actionPending: false,
      offline: !online,
      quiet: false,
      voiceMuted: false,
      name,
      hour,
    };
    return resolveHero(signals);
  }, [now, online, name, hour]);

  return (
    <HomeCard accent className="!p-0">
      <div className="flex items-center gap-4 p-5 sm:p-6">
        <PilotPortrait size="md" state="idle" eager />
        <div className="min-w-0 flex-1">
          {dateLabel ? (
            <p className="text-[0.65rem] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
              {dateLabel}
            </p>
          ) : null}
          <h2 className="mt-1 truncate text-xl sm:text-2xl font-semibold text-foreground">
            {view.title}
          </h2>
          <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
            {view.subtitle}
          </p>
          {context.debtScore !== null && context.recoveryScore !== null ? (
            <p className="mt-2 text-[0.65rem] uppercase tracking-[0.18em] text-muted-foreground/80">
              Recovery {Math.round(context.recoveryScore)}% · Sleep debt {Math.round(context.debtScore)}
            </p>
          ) : null}
          <div className="mt-4">
            <Link
              to="/companion"
              className="inline-flex items-center justify-center rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-[var(--shadow-glow)] transition-transform active:scale-[0.98]"
            >
              {view.ctaLabel}
            </Link>
          </div>
        </div>
      </div>
    </HomeCard>
  );
}
