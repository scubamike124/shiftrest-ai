import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  Sun,
  Moon,
  Coffee,
  Glasses,
  Volume2,
  Share2,
  Sparkles,
  BookOpen,
  AlertCircle,
} from "lucide-react";
import { DAYS, fmt, fetchShifts, type Shift } from "@/lib/shifts";
import { useQuery } from "@tanstack/react-query";
import { buildLightPlan, sunTimes, type PlanEvent } from "@/lib/sleep-engine";
import { loadPrefs } from "@/lib/prefs";
import { toast } from "sonner";

export const Route = createFileRoute("/plan")({
  head: () => ({
    meta: [
      { title: "Smart Light Plan — ShiftRest AI" },
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

function PlanPage() {
  const [mounted, setMounted] = useState(false);
  const { data: shifts = [] } = useQuery({ queryKey: ["shifts"], queryFn: fetchShifts });
  const prefs = useMemo(() => loadPrefs(), []);
  const today = useMemo(() => new Date(), []);
  const weekday = (today.getDay() + 6) % 7;
  const [activeDay, setActiveDay] = useState(weekday);

  useEffect(() => {
    setMounted(true);
  }, []);

  const shift = shifts.find((s: Shift) => s.day === activeDay);
  const sun = useMemo(
    () => sunTimes(today, prefs.lat, prefs.lon),
    [prefs.lat, prefs.lon, today],
  );
  const events = useMemo(
    () => (mounted && shift ? buildLightPlan(shift, prefs, sun) : []),
    [mounted, shift, prefs, sun],
  );

  function speak() {
    if (!("speechSynthesis" in window)) {
      toast.error("Voice not supported in this browser");
      return;
    }
    if (events.length === 0) {
      toast.info("No shift to brief on");
      return;
    }
    const intro = `Good morning. Here is your sleep and light plan for ${DAYS[activeDay]}.`;
    const body = events
      .map((e) => `At ${fmt(e.time)}, ${e.title}. ${e.detail}`)
      .join(" ");
    const outro = "Stay sharp out there.";
    const u = new SpeechSynthesisUtterance(`${intro} ${body} ${outro}`);
    u.rate = 1.0;
    u.pitch = 1.0;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(u);
    toast.success("Briefing started");
  }

  return (
    <main className="flex flex-col gap-6 px-5 pt-12">
      <header>
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">
          Smart Light Plan
        </p>
        <h1 className="mt-2 text-3xl font-bold">Today's recipe.</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Hour-by-hour light, caffeine, and blackout plan — tuned to {prefs.locationLabel}.
        </p>
      </header>

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

      {sun.sunrise != null && sun.sunset != null && (
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
          <p className="text-sm font-semibold">No shift on {DAYS[activeDay]}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Add a shift on the Schedule tab to generate a plan.
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
            <button
              onClick={speak}
              className="flex h-12 flex-1 items-center justify-center gap-2 rounded-2xl bg-primary text-sm font-semibold text-primary-foreground shadow-[var(--shadow-glow)] active:scale-[0.99]"
            >
              <Volume2 className="h-4 w-4" /> Voice briefing
            </button>
            <Link
              to="/share"
              className="flex h-12 w-12 items-center justify-center rounded-2xl border border-border bg-card text-foreground active:scale-95"
              aria-label="Share with partner"
            >
              <Share2 className="h-4 w-4" />
            </Link>
          </div>

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
