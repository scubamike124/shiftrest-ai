// Slice 7 — Daily Brief orchestrator. Picks Morning / Afternoon / Evening
// from local time, respects per-period enable toggles, and renders cards
// in the saved layout order with hide-on-empty behavior.
//
// Morning delegates to the existing <MorningBrief /> to avoid regressing
// Slice 6. Afternoon and Evening are new in this slice.

import { useEffect, useMemo, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Card } from "@/components/ui/card";
import type { Prefs } from "@/lib/prefs";
import { currentBriefPeriod, lastSeenKey, type BriefPeriod } from "@/lib/companion/brief-window";
import { MorningBrief } from "@/components/morning/MorningBrief";
import { getAfternoonBrief } from "@/lib/companion/afternoon-brief.functions";
import { getEveningBrief } from "@/lib/companion/evening-brief.functions";
import type { AfternoonBriefDTO, EveningBriefDTO, AfternoonCardId, EveningCardId } from "@/lib/companion/types";
import { track } from "@/lib/companion/analytics";
import {
  RemainingCard,
  NextTrafficCard,
  WeatherShiftCard,
  WorkingLateCard,
  HydrationCard,
  MovementCard,
  BatteryCard,
} from "./AfternoonCards";
import {
  TomorrowFirstCard,
  TomorrowWeatherCard,
  ClothingCard,
  SmartAlarmCard,
  BedtimeCard,
  PrepCard,
  TravelCard,
  SummaryCard,
  WindDownCard,
} from "./EveningCards";
import { WeatherAlertsCard } from "@/components/weather/WeatherAlertsCard";
import { TrafficCard } from "@/components/traffic/TrafficCard";

function CardSkeleton() {
  return (
    <Card className="animate-pulse border-border/60 p-4">
      <div className="h-3 w-24 rounded bg-muted/60" />
      <div className="mt-3 h-5 w-3/4 rounded bg-muted/40" />
    </Card>
  );
}

export function markBriefSeenPeriod(period: BriefPeriod) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(lastSeenKey(period), new Date().toISOString());
    if (period === "morning") {
      // Keep Slice 6's avatar pulse listener working.
      window.localStorage.setItem("brief:lastSeenISO", new Date().toISOString());
    }
    window.dispatchEvent(new CustomEvent("brief:seen", { detail: { period } }));
  } catch {
    /* noop */
  }
}

function AfternoonSection({ dto, prefs }: { dto: AfternoonBriefDTO; prefs: Prefs | null | undefined }) {
  const order = (prefs?.afternoonLayout?.order ?? [
    "remaining",
    "nextTraffic",
    "weatherShift",
    "workingLate",
    "hydration",
    "movement",
    "battery",
  ]) as AfternoonCardId[];
  const hidden = new Set<string>(prefs?.afternoonLayout?.hidden ?? ["nextTraffic"]);
  return (
    <>
      {order.map((id) => {
        if (hidden.has(id)) return null;
        switch (id) {
          case "remaining":
            return <RemainingCard key={id} remaining={dto.remaining} />;
          case "nextTraffic":
            return <NextTrafficCard key={id} nextTraffic={dto.nextTraffic} />;
          case "weatherShift":
            return <WeatherShiftCard key={id} shift={dto.weatherShift} />;
          case "workingLate":
            return <WorkingLateCard key={id} workingLate={dto.workingLate} />;
          case "hydration":
            return dto.hydrationEnabled ? <HydrationCard key={id} /> : null;
          case "movement":
            return dto.movementEnabled ? <MovementCard key={id} /> : null;
          case "battery":
            return <BatteryCard key={id} />;
          default:
            return null;
        }
      })}
    </>
  );
}

function EveningSection({ dto, prefs }: { dto: EveningBriefDTO; prefs: Prefs | null | undefined }) {
  const order = (prefs?.eveningLayout?.order ?? [
    "tomorrowFirst",
    "tomorrowWeather",
    "clothing",
    "smartAlarm",
    "bedtime",
    "prep",
    "travel",
    "summary",
    "windDown",
  ]) as EveningCardId[];
  const hidden = new Set<string>(prefs?.eveningLayout?.hidden ?? []);
  return (
    <>
      {order.map((id) => {
        if (hidden.has(id)) return null;
        switch (id) {
          case "tomorrowFirst":
            return <TomorrowFirstCard key={id} first={dto.tomorrowFirst} />;
          case "tomorrowWeather":
            return <TomorrowWeatherCard key={id} weather={dto.tomorrowWeather} />;
          case "clothing":
            return <ClothingCard key={id} clothing={dto.clothing} />;
          case "smartAlarm":
            return <SmartAlarmCard key={id} alarm={dto.smartAlarm} />;
          case "bedtime":
            return <BedtimeCard key={id} alarm={dto.smartAlarm} />;
          case "prep":
            return <PrepCard key={id} prep={dto.prep} />;
          case "travel":
            return <TravelCard key={id} travel={dto.travel} />;
          case "summary":
            return <SummaryCard key={id} summary={dto.summary} />;
          case "windDown":
            return <WindDownCard key={id} minutes={dto.windDownMin} />;
          default:
            return null;
        }
      })}
    </>
  );
}

export function DailyBrief({
  prefs,
  signedIn,
  forcedPeriod,
}: {
  prefs: Prefs | null | undefined;
  signedIn: boolean;
  /** Optional override (used by ?brief=1 to show morning regardless of time). */
  forcedPeriod?: BriefPeriod;
}) {
  const period: BriefPeriod = useMemo(
    () => forcedPeriod ?? currentBriefPeriod(),
    [forcedPeriod],
  );
  const enabledMap = prefs?.briefEnabled ?? { morning: true, afternoon: true, evening: true };
  const enabled = enabledMap[period];

  const fetchAfternoon = useServerFn(getAfternoonBrief);
  const fetchEvening = useServerFn(getEveningBrief);

  const afternoonQ = useQuery({
    queryKey: ["afternoon-brief"],
    queryFn: () => fetchAfternoon(),
    enabled: signedIn && period === "afternoon" && enabled,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  const eveningQ = useQuery({
    queryKey: ["evening-brief"],
    queryFn: () => fetchEvening(),
    enabled: signedIn && period === "evening" && enabled,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    if (period === "afternoon" && afternoonQ.data) {
      markBriefSeenPeriod("afternoon");
      track({ event: "brief_opened", period: "afternoon" });
    }
  }, [period, afternoonQ.data]);
  useEffect(() => {
    if (period === "evening" && eveningQ.data) {
      markBriefSeenPeriod("evening");
      track({ event: "brief_opened", period: "evening" });
    }
  }, [period, eveningQ.data]);
  useEffect(() => {
    if (period === "afternoon" && afternoonQ.error) {
      track({ event: "brief_refresh_failed", period: "afternoon", reason: String(afternoonQ.error) });
    }
  }, [period, afternoonQ.error]);
  useEffect(() => {
    if (period === "evening" && eveningQ.error) {
      track({ event: "brief_refresh_failed", period: "evening", reason: String(eveningQ.error) });
    }
  }, [period, eveningQ.error]);

  // Slice 9 — listen for companion-triggered refresh events.
  // Slice 10 — debounce coalesces rapid bursts (e.g. multiple action completions).
  const refreshTimer = useRef<number | null>(null);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onRefresh = (e: Event) => {
      const detail = (e as CustomEvent<{ period?: string }>).detail;
      if (refreshTimer.current) window.clearTimeout(refreshTimer.current);
      refreshTimer.current = window.setTimeout(() => {
        if (!detail?.period || detail.period === "afternoon") void afternoonQ.refetch();
        if (!detail?.period || detail.period === "evening") void eveningQ.refetch();
      }, 250);
    };
    window.addEventListener("companion:brief-refresh", onRefresh as EventListener);
    return () => {
      window.removeEventListener("companion:brief-refresh", onRefresh as EventListener);
      if (refreshTimer.current) window.clearTimeout(refreshTimer.current);
    };
  }, [afternoonQ, eveningQ]);

  if (!signedIn || !enabled) return null;

  if (period === "morning") {
    return (
      <>
        <WeatherAlertsCard period="morning" signedIn={signedIn} />
        <TrafficCard period="morning" signedIn={signedIn} />
        <MorningBrief prefs={prefs} signedIn={signedIn} />
      </>
    );
  }

  return (
    <section
      aria-label={period === "afternoon" ? "Afternoon check-in" : "Evening brief"}
      className="mt-2 flex flex-col gap-3"
      data-testid={`daily-brief-${period}`}
    >
      <WeatherAlertsCard period={period} signedIn={signedIn} />
      {period === "afternoon" ? (
        afternoonQ.isLoading && !afternoonQ.data ? (
          <CardSkeleton />
        ) : afternoonQ.data ? (
          <AfternoonSection dto={afternoonQ.data} prefs={prefs} />
        ) : null
      ) : null}
      {period === "evening" ? (
        eveningQ.isLoading && !eveningQ.data ? (
          <CardSkeleton />
        ) : eveningQ.data ? (
          <EveningSection dto={eveningQ.data} prefs={prefs} />
        ) : null
      ) : null}
    </section>
  );
}
