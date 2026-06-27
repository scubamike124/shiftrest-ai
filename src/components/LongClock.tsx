import { useEffect, useMemo, useState } from "react";
import { Sun, Moon, Coffee, Briefcase, Sparkles, AlarmClock, Wind } from "lucide-react";
import type { Shift } from "@/lib/shifts";
import { endAbsolute } from "@/lib/shifts";
import type { Prefs } from "@/lib/prefs";
import { sunTimes } from "@/lib/sleep-engine";

const RIGHT_NOW_CACHE_KEY = "rp_rightnow_v1";

type CoachHighlight = { startMin: number; endMin: number; label: string } | null;

function readCoachHighlight(): CoachHighlight {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(RIGHT_NOW_CACHE_KEY);
    if (!raw) return null;
    const c = JSON.parse(raw) as { data?: { timeWindow?: { startIso: string; endIso: string }; action?: string } };
    const w = c.data?.timeWindow;
    if (!w?.startIso || !w?.endIso) return null;
    const s = new Date(w.startIso);
    const e = new Date(w.endIso);
    if (isNaN(s.getTime()) || isNaN(e.getTime())) return null;
    return {
      startMin: s.getHours() * 60 + s.getMinutes(),
      endMin: e.getHours() * 60 + e.getMinutes(),
      label: c.data?.action ?? "Coach window",
    };
  } catch {
    return null;
  }
}

/**
 * LongClock — the signature 24h ribbon. Shows the user's whole day in one glance:
 * sleep · work · bright light · caffeine cutoff · wind-down · alarm · recovery.
 * Tap a band to see the reason behind it.
 */
type Band = {
  id: string;
  label: string;
  start: number; // 0-1440
  end: number; // 0-1440
  color: string;
  reason: string;
  icon: typeof Sun;
};

type Marker = {
  id: string;
  at: number;
  label: string;
  color: string;
  icon: typeof Sun;
  reason: string;
};

function fmtTime(m: number): string {
  const mm = ((m % 1440) + 1440) % 1440;
  const h = Math.floor(mm / 60);
  const min = Math.round(mm % 60);
  const ap = h >= 12 ? "p" : "a";
  const h12 = ((h + 11) % 12) + 1;
  return min === 0 ? `${h12}${ap}` : `${h12}:${min.toString().padStart(2, "0")}${ap}`;
}

export function LongClock({
  shift,
  prefs,
  now,
}: {
  shift?: Shift;
  prefs: Prefs;
  now: Date;
}) {
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const tz = prefs.currentTz ?? prefs.homeTz ?? undefined;
  const { sunrise, sunset } = useMemo(
    () => sunTimes(now, prefs.lat ?? null, prefs.lon ?? null, tz),
    [now, prefs.lat, prefs.lon, tz],
  );

  const { bands, markers } = useMemo(() => {
    const bands: Band[] = [];
    const markers: Marker[] = [];

    // Bright light window: from sunrise to ~3h after sunrise — anchor circadian phase.
    if (sunrise != null) {
      bands.push({
        id: "light",
        label: "Bright light",
        start: sunrise,
        end: (sunrise + 180) % 1440,
        color: "var(--amber)",
        icon: Sun,
        reason: `Get bright light from ${fmtTime(sunrise)} to anchor your circadian phase.`,
      });
    }

    if (shift) {
      const sStart = shift.start;
      const sEnd = endAbsolute(shift) % 1440;
      bands.push({
        id: "work",
        label: "Work",
        start: sStart,
        end: sEnd,
        color: "var(--shift, var(--indigo))",
        icon: Briefcase,
        reason: `Shift ${fmtTime(sStart)} – ${fmtTime(sEnd)}.`,
      });

      const windStart = sEnd;
      const windEnd = (windStart + prefs.windDownMin) % 1440;
      bands.push({
        id: "wind",
        label: "Wind-down",
        start: windStart,
        end: windEnd,
        color: "var(--winddown, var(--amber))",
        icon: Wind,
        reason: `${prefs.windDownMin} min wind-down after shift — dim lights, no screens.`,
      });

      const sleepStart = windEnd;
      const sleepEnd = (sleepStart + prefs.sleepHours * 60) % 1440;
      bands.push({
        id: "sleep",
        label: "Sleep",
        start: sleepStart,
        end: sleepEnd,
        color: "var(--sleep, var(--indigo-glow))",
        icon: Moon,
        reason: `Target ${prefs.sleepHours}h sleep starting around ${fmtTime(sleepStart)}.`,
      });

      // Caffeine cutoff: 8h before sleep start.
      const caffCut = ((sleepStart - 8 * 60) % 1440 + 1440) % 1440;
      markers.push({
        id: "caffeine",
        at: caffCut,
        label: "Caffeine cut",
        color: "var(--destructive)",
        icon: Coffee,
        reason: `Stop caffeine by ${fmtTime(caffCut)} — 8h half-life protects sleep onset.`,
      });

      // Alarm at end of sleep
      markers.push({
        id: "alarm",
        at: sleepEnd,
        label: "Alarm",
        color: "var(--primary)",
        icon: AlarmClock,
        reason: `Wake target ${fmtTime(sleepEnd)} — aligned to end of a sleep cycle.`,
      });

      // Recovery window: 90 min after wake
      bands.push({
        id: "recovery",
        label: "Recovery",
        start: sleepEnd,
        end: (sleepEnd + 90) % 1440,
        color: "var(--accent, #6ee7b7)",
        icon: Sparkles,
        reason: `90-min recovery window after wake — light food, hydrate, daylight.`,
      });
    } else if (sunset != null) {
      // No shift: wind-down before typical sleep at sunset + 4h
      const targetSleep = (sunset + 4 * 60) % 1440;
      const windStart = (targetSleep - prefs.windDownMin + 1440) % 1440;
      bands.push({
        id: "wind",
        label: "Wind-down",
        start: windStart,
        end: targetSleep,
        color: "var(--winddown, var(--amber))",
        icon: Wind,
        reason: `${prefs.windDownMin} min wind-down before a ${fmtTime(targetSleep)} bedtime.`,
      });
      bands.push({
        id: "sleep",
        label: "Sleep",
        start: targetSleep,
        end: (targetSleep + prefs.sleepHours * 60) % 1440,
        color: "var(--sleep, var(--indigo-glow))",
        icon: Moon,
        reason: `Target ${prefs.sleepHours}h sleep.`,
      });
    }

    return { bands, markers };
  }, [shift, prefs.windDownMin, prefs.sleepHours, prefs.lat, prefs.lon, sunrise, sunset]);

  const [activeId, setActiveId] = useState<string | null>(null);
  const active = useMemo(
    () =>
      [...bands.map((b) => ({ ...b, kind: "band" as const })), ...markers.map((m) => ({ ...m, kind: "marker" as const }))]
        .find((x) => x.id === activeId),
    [activeId, bands, markers],
  );

  // Live link to RightNowCard: highlight the coach's recommended window.
  const [highlight, setHighlight] = useState<CoachHighlight>(null);
  useEffect(() => {
    setHighlight(readCoachHighlight());
    const handler = (e: StorageEvent) => {
      if (e.key === RIGHT_NOW_CACHE_KEY) setHighlight(readCoachHighlight());
    };
    window.addEventListener("storage", handler);
    return () => window.removeEventListener("storage", handler);
  }, []);
  const highlightSegs = useMemo(
    () => (highlight ? splitWrap(highlight.startMin, highlight.endMin) : []),
    [highlight],
  );

  return (
    <section className="rounded-[24px] border border-border bg-card p-5">
      <header className="mb-4 flex items-center justify-between">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.25em] text-indigo-glow">
            Long Clock
          </p>
          <h3 className="mt-0.5 text-lg" style={{ fontFamily: "var(--font-display)" }}>
            Your whole day at a glance
          </h3>
        </div>
        <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
          Now {fmtTime(nowMin)}
        </span>
      </header>

      {highlight && (
        <p className="-mt-2 mb-3 inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-1 text-[11px] font-semibold text-indigo-glow">
          <Sparkles className="h-3 w-3" />
          Coach window {fmtTime(highlight.startMin)} – {fmtTime(highlight.endMin)} · {highlight.label}
        </p>
      )}

      {/* Ribbon */}
      <div className="relative">
        <div className="relative h-14 overflow-hidden rounded-full border border-border/70 bg-secondary/50">
          {bands.map((b) => {
            const segs = splitWrap(b.start, b.end);
            return segs.map((seg, i) => (
              <button
                key={`${b.id}-${i}`}
                onClick={() => setActiveId(activeId === b.id ? null : b.id)}
                aria-label={`${b.label} ${fmtTime(b.start)} to ${fmtTime(b.end)}`}
                className={`absolute top-0 h-full transition ${activeId === b.id ? "brightness-125" : "opacity-90 hover:opacity-100"}`}
                style={{
                  left: `${(seg.start / 1440) * 100}%`,
                  width: `${Math.max(0.5, (seg.len / 1440) * 100)}%`,
                  background: `linear-gradient(180deg, ${b.color}cc 0%, ${b.color}88 100%)`,
                }}
              />
            ));
          })}
          {/* Coach highlight — the window RightNowCard recommended */}
          {highlightSegs.map((seg, i) => (
            <div
              key={`coach-${i}`}
              aria-label={`Coach window: ${highlight?.label}`}
              className="pointer-events-none absolute -top-1 bottom-0 rounded-full ring-2 ring-primary/80 shadow-[0_0_24px_rgba(99,102,241,0.55)]"
              style={{
                left: `${(seg.start / 1440) * 100}%`,
                width: `${Math.max(0.5, (seg.len / 1440) * 100)}%`,
                height: "calc(100% + 0.5rem)",
                background:
                  "linear-gradient(180deg, rgba(99,102,241,0.18) 0%, rgba(99,102,241,0.05) 100%)",
              }}
            />
          ))}
          {markers.map((m) => (
            <button
              key={m.id}
              onClick={() => setActiveId(activeId === m.id ? null : m.id)}
              aria-label={`${m.label} at ${fmtTime(m.at)}`}
              className="absolute top-0 flex h-full w-[2px] items-start justify-center"
              style={{ left: `${(m.at / 1440) * 100}%`, background: m.color }}
            >
              <span
                className="-mt-1 flex h-5 w-5 items-center justify-center rounded-full border border-background"
                style={{ background: m.color, color: "white" }}
              >
                <m.icon className="h-2.5 w-2.5" />
              </span>
            </button>
          ))}
          {/* Now indicator */}
          <div
            className="pointer-events-none absolute top-0 h-full w-px bg-foreground"
            style={{ left: `${(nowMin / 1440) * 100}%` }}
          >
            <span className="absolute -top-1 left-1/2 h-2 w-2 -translate-x-1/2 animate-pulse rounded-full bg-foreground shadow-[0_0_8px_rgba(255,255,255,0.8)]" />
          </div>
        </div>

        {/* Tick labels */}
        <div className="mt-2 flex justify-between text-[10px] text-muted-foreground">
          <span>12a</span>
          <span>6a</span>
          <span>12p</span>
          <span>6p</span>
          <span>12a</span>
        </div>
      </div>

      {/* Active reason */}
      <div className="mt-4 min-h-[68px] rounded-2xl border border-border/60 bg-background/40 p-3">
        {active ? (
          <div className="flex items-start gap-3">
            <span
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl"
              style={{
                background: "color-mix(in oklab, " + (active as Band | Marker).color + " 20%, transparent)",
                color: (active as Band | Marker).color,
              }}
            >
              <active.icon className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <p className="text-sm font-semibold">{active.label}</p>
              <p className="mt-0.5 text-xs leading-snug text-muted-foreground">{active.reason}</p>
            </div>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            Tap any band or marker to see why it's there.
          </p>
        )}
      </div>

      {/* Legend */}
      <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1.5 text-[10px] text-muted-foreground">
        {bands.map((b) => (
          <span key={b.id} className="inline-flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full" style={{ background: b.color }} />
            {b.label} · {fmtTime(b.start)}
          </span>
        ))}
        {markers.map((m) => (
          <span key={m.id} className="inline-flex items-center gap-1.5">
            <span className="h-2 w-px" style={{ background: m.color, display: "inline-block", height: "10px" }} />
            {m.label} · {fmtTime(m.at)}
          </span>
        ))}
      </div>
    </section>
  );
}

function splitWrap(start: number, end: number): { start: number; len: number }[] {
  const s = ((start % 1440) + 1440) % 1440;
  const e = ((end % 1440) + 1440) % 1440;
  if (e === s) return [{ start: s, len: 1440 }];
  if (e > s) return [{ start: s, len: e - s }];
  return [
    { start: s, len: 1440 - s },
    { start: 0, len: e },
  ];
}
