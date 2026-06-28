// Slice 6 — Morning Brief orchestrator. Loads once via getMorningBrief,
// then renders cards in the order saved in user_prefs.brief_layout, skipping
// hidden ids and skipping cards with no payload. Never renders error states.

import { useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Card } from "@/components/ui/card";
import { getMorningBrief } from "@/lib/morning/morning-brief.functions";
import { quoteForToday } from "@/lib/morning/quotes";
import type { Prefs } from "@/lib/prefs";
import type { BriefCardId, MorningBriefDTO } from "@/lib/morning/types";
import { GreetingCard } from "./cards/GreetingCard";
import { SleepCard } from "./cards/SleepCard";
import { AlarmCard } from "./cards/AlarmCard";
import { WeatherCard } from "./cards/WeatherCard";
import { LongClockCard } from "./cards/LongClockCard";
import { DepartureCard } from "./cards/DepartureCard";
import { TipCard } from "./cards/TipCard";
import { MotivationCard } from "./cards/MotivationCard";

const BRIEF_LAST_SEEN_KEY = "brief:lastSeenISO";

export function markBriefSeen() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(BRIEF_LAST_SEEN_KEY, new Date().toISOString());
    window.dispatchEvent(new CustomEvent("brief:seen"));
  } catch {
    /* noop */
  }
}

export function getBriefLastSeen(): Date | null {
  if (typeof window === "undefined") return null;
  try {
    const v = window.localStorage.getItem(BRIEF_LAST_SEEN_KEY);
    return v ? new Date(v) : null;
  } catch {
    return null;
  }
}

function CardSkeleton() {
  return (
    <Card className="animate-pulse border-border/60 p-4">
      <div className="h-3 w-24 rounded bg-muted/60" />
      <div className="mt-3 h-5 w-3/4 rounded bg-muted/40" />
    </Card>
  );
}

export function MorningBrief({
  prefs,
  signedIn,
}: {
  prefs: Prefs | null | undefined;
  signedIn: boolean;
}) {
  const fetchBrief = useServerFnSafe();
  const query = useQuery({
    queryKey: ["morning-brief"],
    queryFn: () => fetchBrief(),
    enabled: signedIn,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  // Mark seen as soon as we have a payload (used by dashboard avatar pulse).
  useEffect(() => {
    if (query.data) markBriefSeen();
  }, [query.data]);

  const order = useMemo<BriefCardId[]>(() => {
    const raw = prefs?.briefLayout?.order ?? [
      "sleep",
      "alarm",
      "weather",
      "longclock",
      "departure",
      "tip",
      "motivation",
    ];
    return raw.filter(isBriefCardId);
  }, [prefs?.briefLayout?.order]);

  const hidden = useMemo(
    () => new Set(prefs?.briefLayout?.hidden ?? ["departure"]),
    [prefs?.briefLayout?.hidden],
  );

  const dto: MorningBriefDTO | null = query.data ?? null;
  const quote = useMemo(() => quoteForToday(), []);

  return (
    <section
      aria-label="Morning brief"
      className="mt-2 flex flex-col gap-3"
      data-testid="morning-brief"
    >
      {/* Greeting always renders first (skeleton until payload). */}
      {dto ? (
        <GreetingCard dto={dto} />
      ) : query.isLoading ? (
        <CardSkeleton />
      ) : null}

      {order.map((id) => {
        if (hidden.has(id)) return null;
        if (!dto && query.isLoading) return <CardSkeleton key={id} />;
        if (!dto) return null;
        switch (id) {
          case "sleep":
            return dto.sleep ? <SleepCard key={id} sleep={dto.sleep} /> : null;
          case "alarm":
            return <AlarmCard key={id} signedIn={signedIn} />;
          case "weather":
            return dto.weather ? <WeatherCard key={id} weather={dto.weather} /> : null;
          case "longclock":
            return dto.longclock && dto.longclock.items.length > 0 ? (
              <LongClockCard key={id} items={dto.longclock.items} />
            ) : null;
          case "departure":
            return dto.departure ? <DepartureCard key={id} departure={dto.departure} /> : null;
          case "tip":
            return <TipCard key={id} signedIn={signedIn} />;
          case "motivation":
            return <MotivationCard key={id} text={quote.text} author={quote.author} />;
          default:
            return null;
        }
      })}
    </section>
  );
}

function isBriefCardId(s: string): s is BriefCardId {
  return ["sleep", "alarm", "weather", "longclock", "departure", "tip", "motivation"].includes(s);
}
