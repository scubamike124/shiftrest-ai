import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  Sun,
  Moon,
  Coffee,
  Glasses,
  Share2,
  Sparkles,
  BookOpen,
  AlertCircle,
  Bed,
  Droplet,
  Lightbulb,
  Utensils,
} from "lucide-react";
import { DAYS, fmt, fetchShifts, type Shift } from "@/lib/shifts";
import { useQuery } from "@tanstack/react-query";
import { buildLightPlan, sunTimes, type PlanEvent } from "@/lib/sleep-engine";
import { DEFAULT_PREFS, fetchPrefs } from "@/lib/prefs";
import { fetchEmployers } from "@/lib/employers";
import { supabase } from "@/integrations/supabase/client";
import { VoicePlayer } from "@/components/VoicePlayer";
import { computeInsights } from "@/lib/insights";
import { buildRecommendations, type Recommendation } from "@/lib/recommendations";
import { getWearableSummary } from "@/lib/wearables/wearables.functions";


export const Route = createFileRoute("/plan")({
  head: () => ({
    meta: [
      { title: "Smart Light Plan — RestPilot AI" },
      {
        name: "description",
        content:
          "Hour-by-hour light, caffeine, and blackout plan tailored to your shift and sunrise.",
      },
    ],
  }),
  component: PlanPage,
});

const ICONS: Record<PlanEvent["kind"], typeof Sun> = {
  wake: Sun,
  bright: Sun,
  amber: Glasses,
  blackout: Moon,
  "caffeine-on": Coffee,
  "caffeine-cutoff": Coffee,
  "shift-start": AlertCircle,
  "shift-end": AlertCircle,
  meal: BookOpen,
  nap: Moon,
};

const REC_ICONS: Record<Recommendation["kind"], typeof Sun> = {
  "anchor-sleep": Moon,
  "wind-down": Bed,
  "bright-light": Sun,
  "amber-light": Lightbulb,
  "caffeine-on": Coffee,
  "caffeine-cutoff": Coffee,
  meal: Utensils,
  nap: Bed,
  "split-sleep": Moon,
  hydrate: Droplet,
  recovery: Sparkles,
};


function PlanPage() {
  const [mounted, setMounted] = useState(false);
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const { data: shifts = [] } = useQuery({ queryKey: ["shifts"], queryFn: fetchShifts });
  const { data: prefs = DEFAULT_PREFS } = useQuery({ queryKey: ["prefs"], queryFn: fetchPrefs, initialData: DEFAULT_PREFS });
  const today = useMemo(() => new Date(), []);
  const weekday = (today.getDay() + 6) % 7;
  const [activeDay, setActiveDay] = useState(weekday);

  useEffect(() => {
    setMounted(true);
    supabase.auth.getSession().then(({ data }) => setSignedIn(!!data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => setSignedIn(!!session));
    return () => sub.subscription.unsubscribe();
  }, []);

  const shift = shifts.find((s: Shift) => s.day === activeDay);
  // Only compute sunrise/sunset when the user has VERIFIED a real location.
  // A coords-shaped label like "33.66, -117.88" is a legacy fallback from a
  // broken reverse-geocode path and must NOT count as verified.
  const rawLabel = prefs.locationLabel?.trim() ?? "";
  const isCoordsLabel = /^-?\d+(\.\d+)?\s*,\s*-?\d+(\.\d+)?$/.test(rawLabel);
  const hasVerifiedLocation = rawLabel.length > 0 && !isCoordsLabel;
  const displayLabel = hasVerifiedLocation ? rawLabel : "";
  const sun = useMemo(
    () =>
      hasVerifiedLocation
        ? sunTimes(today, prefs.lat, prefs.lon)
        : { sunrise: null, sunset: null },
    [hasVerifiedLocation, prefs.lat, prefs.lon, today],
  );
  const events = useMemo(
    () => (mounted && shift ? buildLightPlan(shift, prefs, sun) : []),
    [mounted, shift, prefs, sun],
  );

  const { data: employers = [] } = useQuery({
    queryKey: ["employers"],
    queryFn: fetchEmployers,
    enabled: signedIn === true,
  });
  const getWearableSummaryFn = useServerFn(getWearableSummary);
  const { data: wearableSummary } = useQuery({
    queryKey: ["wearable-summary"],
    queryFn: () => getWearableSummaryFn(),
    staleTime: 60_000,
    enabled: signedIn === true,
  });
  const recommendations: Recommendation[] = useMemo(() => {
    if (!mounted) return [];
    const insights = computeInsights(
      shifts,
      prefs,
      today,
      employers,
      wearableSummary?.latest ?? null,
    );
    return buildRecommendations(insights, prefs, today, {
      lat: prefs.lat ?? null,
      lon: prefs.lon ?? null,
    });
  }, [mounted, shifts, prefs, today, employers, wearableSummary]);


  function buildPlanText(): string | null {
    if (!shift || events.length === 0) return null;
    const intro = `Plan for ${DAYS[activeDay]}. Shift ${shift.start} to ${shift.end}.`;
    const body = events
      .map((e) => `At ${fmt(e.time)} — ${e.title}: ${e.detail}`)
      .join("\n");
    return `${intro}\n${body}`;
  }

  return (
    <main className="flex flex-col gap-6 px-5 pt-12">
      <header>
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">
          Smart Light Plan
        </p>
        <h1 className="mt-2 text-3xl font-bold">Today's recipe.</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Hour-by-hour light, caffeine, and blackout plan
          {displayLabel ? ` — tuned to ${displayLabel}.` : "."}
        </p>
      </header>

      {!hasVerifiedLocation && (
        <Link
          to={signedIn === false ? "/auth" : "/profile"}
          search={signedIn === false ? ({ return: "/profile" } as never) : undefined}
          className="flex items-center justify-between rounded-2xl border border-amber/40 bg-amber/10 p-3 text-xs"
        >
          <span className="text-amber">
            {signedIn === false
              ? "Sign in to set your location for accurate sunrise & sunset timing."
              : "Set your location for accurate sunrise & sunset timing."}
          </span>
          <span className="font-semibold text-amber">
            {signedIn === false ? "Sign in →" : "Open profile →"}
          </span>
        </Link>
      )}

      <div className="flex gap-2 overflow-x-auto pb-1">
        {DAYS.map((d, i) => {
          const has = shifts.some((s) => s.day === i);
          const active = i === activeDay;
          return (
            <button
              key={d}
              onClick={() => setActiveDay(i)}
              className={`flex h-14 w-12 shrink-0 flex-col items-center justify-center rounded-xl border text-xs font-semibold transition ${
                active
                  ? "border-primary bg-primary/15 text-primary"
                  : "border-border bg-card text-muted-foreground"
              }`}
            >
              {d[0]}
              <span className={`mt-1 h-1.5 w-1.5 rounded-full ${has ? "bg-mint" : "bg-muted"}`} />
            </button>
          );
        })}
      </div>

      {hasVerifiedLocation && sun.sunrise != null && sun.sunset != null && (
        <div className="flex items-center justify-between rounded-2xl border border-border bg-card px-4 py-3 text-xs">
          <span className="flex items-center gap-2 text-amber">
            <Sun className="h-4 w-4" /> Sunrise {fmt(sun.sunrise)}
          </span>
          <span className="flex items-center gap-2 text-primary">
            <Moon className="h-4 w-4" /> Sunset {fmt(sun.sunset)}
          </span>
        </div>
      )}

      {!shift ? (
        <div className="rounded-2xl border border-border bg-card p-6 text-center">
          <p className="text-sm font-semibold">No shift scheduled today</p>
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
            Add today's shift and RestPilot AI will generate your personalized
            light, caffeine, blackout, and recovery plan.
          </p>
          <Link
            to="/"
            className="mt-4 inline-flex h-10 items-center rounded-full bg-primary px-4 text-sm font-semibold text-primary-foreground"
          >
            Open Schedule
          </Link>
        </div>
      ) : (
        <>
          <div className="flex gap-2">
            <div className="flex-1">
              <VoicePlayer buildPlanText={buildPlanText} />
            </div>
            <Link
              to="/share"
              className="flex h-12 w-12 items-center justify-center rounded-2xl border border-border bg-card text-foreground active:scale-95"
              aria-label="Share with partner"
            >
              <Share2 className="h-4 w-4" />
            </Link>
          </div>

          {recommendations.length > 0 && (
            <section className="rounded-2xl border border-primary/25 bg-gradient-to-br from-primary/10 to-card p-4">
              <p className="text-[10px] font-semibold uppercase tracking-[0.25em] text-indigo-glow">
                Personalized for you · next 24h
              </p>
              <ol className="mt-3 flex flex-col gap-2">
                {recommendations.map((r, i) => {
                  const Icon = REC_ICONS[r.kind] ?? Sparkles;
                  return (
                    <li
                      key={i}
                      className="flex gap-3 rounded-xl border border-border/60 bg-card/70 p-3"
                    >
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/15 text-indigo-glow">
                        <Icon className="h-4 w-4" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline justify-between gap-2">
                          <p className="text-sm font-semibold leading-tight">{r.title}</p>
                          <span className="shrink-0 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                            {r.whenLabel}
                          </span>
                        </div>
                        <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                          {r.detail}
                        </p>
                      </div>
                    </li>
                  );
                })}
              </ol>
            </section>
          )}

          <section className="flex flex-col gap-2">

            {events.map((e, i) => {
              const Icon = ICONS[e.kind] ?? Sparkles;
              const tone =
                e.kind === "blackout" || e.kind === "shift-start"
                  ? "primary"
                  : e.kind === "amber" || e.kind === "caffeine-cutoff"
                  ? "amber"
                  : "mint";
              return (
                <div
                  key={i}
                  className="flex gap-3 rounded-2xl border border-border bg-card p-3"
                >
                  <div className="flex w-14 shrink-0 flex-col items-center justify-center rounded-xl bg-secondary/60 text-center">
                    <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
                      {fmt(e.time).split(" ")[1]}
                    </span>
                    <span className="text-sm font-bold">
                      {fmt(e.time).split(" ")[0]}
                    </span>
                  </div>
                  <div className="flex flex-1 gap-3">
                    <span
                      className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${
                        tone === "primary"
                          ? "bg-primary/15 text-primary"
                          : tone === "amber"
                          ? "bg-amber/15 text-amber"
                          : "bg-mint/15 text-mint"
                      }`}
                    >
                      <Icon className="h-4 w-4" />
                    </span>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold">{e.title}</p>
                      <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                        {e.detail}
                      </p>
                    </div>
                  </div>
                </div>
              );
            })}
          </section>
        </>
      )}

      <Link
        to="/playbooks"
        className="flex items-center justify-between rounded-2xl border border-border bg-card p-4"
      >
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-mint/15 text-mint">
            <BookOpen className="h-5 w-5" />
          </span>
          <div>
            <p className="text-sm font-semibold">Recovery playbooks</p>
            <p className="text-xs text-muted-foreground">
              Pre-built protocols for common rotations
            </p>
          </div>
        </div>
      </Link>

      <Link
        to="/swap"
        className="flex items-center justify-between rounded-2xl border border-border bg-card p-4"
      >
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-amber/15 text-amber">
            <Sparkles className="h-5 w-5" />
          </span>
          <div>
            <p className="text-sm font-semibold">Shift swap copilot</p>
            <p className="text-xs text-muted-foreground">
              Paste a new shift, get the recovery cost
            </p>
          </div>
        </div>
      </Link>
    </main>
  );
}
