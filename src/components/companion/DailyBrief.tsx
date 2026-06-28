// Slice 7 — Daily Brief orchestrator. Picks Morning / Afternoon / Evening
// from local time, respects per-period enable toggles, and renders cards
// in the saved layout order with hide-on-empty behavior.
//
// Morning delegates to the existing <MorningBrief /> to avoid regressing
// Slice 6. Afternoon and Evening are new in this slice.

import { lazy, Suspense, useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Card } from "@/components/ui/card";
import type { Prefs } from "@/lib/prefs";
import { currentBriefPeriod, lastSeenKey, type BriefPeriod } from "@/lib/companion/brief-window";
import { MorningBrief } from "@/components/morning/MorningBrief";
import { getAfternoonBrief } from "@/lib/companion/afternoon-brief.functions";
import { getEveningBrief } from "@/lib/companion/evening-brief.functions";
import type { AfternoonBriefDTO, EveningBriefDTO, AfternoonCardId, EveningCardId } from "@/lib/companion/types";

const AfternoonCards = lazy(() =>
  import("./AfternoonCards").then((m) => ({
    default: function Bundle({ dto }: { dto: AfternoonBriefDTO }) {
      return (
        <>
          <m.RemainingCard remaining={dto.remaining} />
          <m.NextTrafficCard nextTraffic={dto.nextTraffic} />
          <m.WeatherShiftCard shift={dto.weatherShift} />
          <m.WorkingLateCard workingLate={dto.workingLate} />
          {dto.hydrationEnabled && <m.HydrationCard />}
          {dto.movementEnabled && <m.MovementCard />}
          <m.BatteryCard />
        </>
      );
    },
  })),
);

const EveningCards = lazy(() =>
  import("./EveningCards").then((m) => ({
    default: function Bundle({ dto }: { dto: EveningBriefDTO }) {
      return (
        <>
          <m.TomorrowFirstCard first={dto.tomorrowFirst} />
          <m.TomorrowWeatherCard weather={dto.tomorrowWeather} />
          <m.ClothingCard clothing={dto.clothing} />
          <m.SmartAlarmCard alarm={dto.smartAlarm} />
          <m.BedtimeCard alarm={dto.smartAlarm} />
          <m.PrepCard prep={dto.prep} />
          <m.TravelCard travel={dto.travel} />
          <m.SummaryCard summary={dto.summary} />
          <m.WindDownCard minutes={dto.windDownMin} />
        </>
      );
    },
  })),
);

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
    // Keep the Slice 6 event working for the existing morning pulse listener.
    if (period === "morning") {
      window.localStorage.setItem("brief:lastSeenISO", new Date().toISOString());
    }
    window.dispatchEvent(new CustomEvent("brief:seen", { detail: { period } }));
  } catch {
    /* noop */
  }
}

/** Order-aware renderer for the afternoon period. */
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

  // We render the lazy bundle once and let each card hide itself when empty.
  // Layout ordering for afternoon is preserved by re-rendering individual
  // cards in the chosen order via the same module.
  return (
    <Suspense fallback={<CardSkeleton />}>
      <OrderedAfternoon dto={dto} order={order} hidden={hidden} />
    </Suspense>
  );
}

function OrderedAfternoon({
  dto,
  order,
  hidden,
}: {
  dto: AfternoonBriefDTO;
  order: AfternoonCardId[];
  hidden: Set<string>;
}) {
  // Defer dynamic import resolution to the lazy bundle so we don't pay it
  // when the period isn't active; once mounted, the inner module is cached.
  const Mod = AfternoonCardsModule.use();
  if (!Mod) return <CardSkeleton />;
  return (
    <>
      {order.map((id) => {
        if (hidden.has(id)) return null;
        switch (id) {
          case "remaining":
            return <Mod.RemainingCard key={id} remaining={dto.remaining} />;
          case "nextTraffic":
            return <Mod.NextTrafficCard key={id} nextTraffic={dto.nextTraffic} />;
          case "weatherShift":
            return <Mod.WeatherShiftCard key={id} shift={dto.weatherShift} />;
          case "workingLate":
            return <Mod.WorkingLateCard key={id} workingLate={dto.workingLate} />;
          case "hydration":
            return dto.hydrationEnabled ? <Mod.HydrationCard key={id} /> : null;
          case "movement":
            return dto.movementEnabled ? <Mod.MovementCard key={id} /> : null;
          case "battery":
            return <Mod.BatteryCard key={id} />;
          default:
            return null;
        }
      })}
    </>
  );
}

function OrderedEvening({
  dto,
  order,
  hidden,
}: {
  dto: EveningBriefDTO;
  order: EveningCardId[];
  hidden: Set<string>;
}) {
  const Mod = EveningCardsModule.use();
  if (!Mod) return <CardSkeleton />;
  return (
    <>
      {order.map((id) => {
        if (hidden.has(id)) return null;
        switch (id) {
          case "tomorrowFirst":
            return <Mod.TomorrowFirstCard key={id} first={dto.tomorrowFirst} />;
          case "tomorrowWeather":
            return <Mod.TomorrowWeatherCard key={id} weather={dto.tomorrowWeather} />;
          case "clothing":
            return <Mod.ClothingCard key={id} clothing={dto.clothing} />;
          case "smartAlarm":
            return <Mod.SmartAlarmCard key={id} alarm={dto.smartAlarm} />;
          case "bedtime":
            return <Mod.BedtimeCard key={id} alarm={dto.smartAlarm} />;
          case "prep":
            return <Mod.PrepCard key={id} prep={dto.prep} />;
          case "travel":
            return <Mod.TravelCard key={id} travel={dto.travel} />;
          case "summary":
            return <Mod.SummaryCard key={id} summary={dto.summary} />;
          case "windDown":
            return <Mod.WindDownCard key={id} minutes={dto.windDownMin} />;
          default:
            return null;
        }
      })}
    </>
  );
}

// ── Lazy module loaders kept outside React tree so we can call them once ──
type AfternoonModule = typeof import("./AfternoonCards");
const AfternoonCardsModule = makeAsyncModule<AfternoonModule>(() => import("./AfternoonCards"));
type EveningModule = typeof import("./EveningCards");
const EveningCardsModule = makeAsyncModule<EveningModule>(() => import("./EveningCards"));

function makeAsyncModule<T>(loader: () => Promise<T>) {
  let mod: T | null = null;
  let promise: Promise<T> | null = null;
  const listeners = new Set<() => void>();
  return {
    use(): T | null {
      // Render-time hook substitute — kicks off loading, returns module when ready.
      // We avoid React.use() to keep React 18 compatibility.
      // eslint-disable-next-line react-hooks/rules-of-hooks
      const [, set] = useStateForceRender();
      useEffect(() => {
        if (mod) return;
        const cb = () => set((n) => n + 1);
        listeners.add(cb);
        if (!promise) {
          promise = loader().then((m) => {
            mod = m;
            listeners.forEach((l) => l());
            return m;
          });
        }
        return () => {
          listeners.delete(cb);
        };
      }, [set]);
      return mod;
    },
  };
}

import { useState as useReactState } from "react";
function useStateForceRender() {
  return useReactState(0);
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
    <Suspense fallback={<CardSkeleton />}>
      <OrderedEvening dto={dto} order={order} hidden={hidden} />
    </Suspense>
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
    if (period === "afternoon" && afternoonQ.data) markBriefSeenPeriod("afternoon");
  }, [period, afternoonQ.data]);
  useEffect(() => {
    if (period === "evening" && eveningQ.data) markBriefSeenPeriod("evening");
  }, [period, eveningQ.data]);

  if (!signedIn || !enabled) return null;

  if (period === "morning") {
    // Reuse the existing component verbatim so Slice 6 is untouched.
    return <MorningBrief prefs={prefs} signedIn={signedIn} />;
  }

  return (
    <section
      aria-label={period === "afternoon" ? "Afternoon check-in" : "Evening brief"}
      className="mt-2 flex flex-col gap-3"
      data-testid={`daily-brief-${period}`}
    >
      {period === "afternoon" && (
        afternoonQ.isLoading && !afternoonQ.data ? (
          <CardSkeleton />
        ) : afternoonQ.data ? (
          <AfternoonSection dto={afternoonQ.data} prefs={prefs} />
        ) : null
      )}
      {period === "evening" && (
        eveningQ.isLoading && !eveningQ.data ? (
          <CardSkeleton />
        ) : eveningQ.data ? (
          <EveningSection dto={eveningQ.data} prefs={prefs} />
        ) : null
      )}
    </section>
  );
}
