import { useEffect, useMemo, useState } from "react";
import { SafetyNote } from "@/components/legal/SafetyNote";
import { Sun, Moon, Coffee, Briefcase, Sparkles, AlarmClock, Wind, Info, Glasses } from "lucide-react";
import type { Shift } from "@/lib/shifts";
import type { Prefs } from "@/lib/prefs";
import { sunTimes } from "@/lib/sleep-engine";
import { buildClockBands } from "@/lib/clock-bands";
import { detectDeviceTz } from "@/lib/tz";
import { useDecisionsByIntent } from "@/lib/ai/decisions";
import {
  RecommendationActions,
  RecommendationDetailSheet,
} from "./ai/trust";

const BAND_INTENT_MAP: Record<string, string[]> = {
  alarm: ["smart_alarm"],
  light: ["light_plan", "daily_plan"],
  caffeine: ["caffeine", "daily_plan"],
  wind: ["daily_plan"],
  sleep: ["sleep_plan", "daily_plan"],
  recovery: ["recovery", "daily_plan"],
  commute: ["commute"],
};

const RIGHT_NOW_CACHE_KEY = "rp_rightnow_v1";

const BAND_STYLE: Record<string, { color: string; icon: typeof Sun }> = {
  light: { color: "var(--amber)", icon: Sun },
  work: { color: "var(--shift, var(--indigo))", icon: Briefcase },
  wind: { color: "var(--winddown, var(--amber))", icon: Wind },
  sleep: { color: "var(--sleep, var(--indigo-glow))", icon: Moon },
  caffeine: { color: "var(--destructive)", icon: Coffee },
  amber: { color: "var(--amber)", icon: Glasses },
  alarm: { color: "var(--primary)", icon: AlarmClock },
  recovery: { color: "var(--accent, #6ee7b7)", icon: Sparkles },
};

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
  // Sun times on the SAME clock as every band (the device zone); a saved
  // trip/home zone here put sunrise on a different clock than sleep.
  const tz = detectDeviceTz() ?? undefined;
  const { sunrise, sunset } = useMemo(
    () => sunTimes(now, prefs.lat ?? null, prefs.lon ?? null, tz),
    [now, prefs.lat, prefs.lon, tz],
  );
  const nextSunrise = useMemo(
    () => sunTimes(new Date(now.getTime() + 86_400_000), prefs.lat ?? null, prefs.lon ?? null, tz).sunrise,
    [now, prefs.lat, prefs.lon, tz],
  );

  const { bands, markers } = useMemo(() => {
    const built = buildClockBands({
      shift,
      prefs,
      now,
      tz: detectDeviceTz() ?? "UTC",
      sunrise,
      nextSunrise,
      sunset,
    });
    return {
      bands: built.bands.map((b) => ({ ...b, ...BAND_STYLE[b.id] })) as Band[],
      markers: built.markers.map((m) => ({ ...m, ...BAND_STYLE[m.id] })) as Marker[],
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shift, prefs.windDownMin, prefs.sleepHours, now, sunrise, nextSunrise, sunset]);

  const [activeId, setActiveId] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const decisionsByIntent = useDecisionsByIntent();
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
            <span className="absolute -top-1 left-1/2 h-2 w-2 -translate-x-1/2 animate-pulse motion-reduce:animate-none rounded-full bg-foreground shadow-[0_0_8px_rgba(255,255,255,0.8)]" />
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
      {(() => {
        const intents = active ? BAND_INTENT_MAP[active.id] ?? [] : [];
        const decision = intents.map((i) => decisionsByIntent[i]).find((x) => !!x) ?? null;
        return (
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
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold">{active.label}</p>
                  <p className="mt-0.5 text-xs leading-snug text-muted-foreground">{active.reason}</p>
                  {decision && (
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setSheetOpen(true)}
                        className="inline-flex items-center gap-1 rounded-full border border-indigo-glow/40 bg-indigo-glow/10 px-2.5 py-1 text-[11px] font-semibold text-indigo-glow hover:bg-indigo-glow/20"
                      >
                        <Info className="h-3 w-3" /> AI reason · what changes if ignored
                      </button>
                      <RecommendationActions
                        recommendationId={decision.id}
                        signedIn
                        initialReaction={decision.reaction}
                        size="sm"
                      />
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                Tap any band or marker to see why it's there.
              </p>
            )}
            <RecommendationDetailSheet
              open={sheetOpen}
              onOpenChange={setSheetOpen}
              recommendationId={decision?.id ?? null}
              intent={decision?.intent}
              headline={decision?.headline}
              why={decision?.rationale ?? null}
              confidence={decision?.confidence ?? null}
            />
          </div>
        );
      })()}



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
    <div className="mt-3 flex justify-end"><SafetyNote /></div>
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
