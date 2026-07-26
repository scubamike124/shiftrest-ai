import { useMemo, useState } from "react";
import { buildMultiDayPlan, weekLabel, type DayPlan, type LongClockEvent } from "@/lib/schedule";
import type { Prefs } from "@/lib/prefs";
import type { Shift } from "@/lib/shifts";

const DOW = ["M", "T", "W", "T", "F", "S", "S"];

function fmtClock(d: Date): string {
  const h = d.getHours();
  const m = d.getMinutes();
  const period = h >= 12 ? "PM" : "AM";
  const h12 = ((h + 11) % 12) + 1;
  return `${h12}:${m.toString().padStart(2, "0")} ${period}`;
}

function shortKind(k: LongClockEvent["kind"]): string {
  switch (k) {
    case "wake":
      return "Wake";
    case "bright-light":
      return "Bright light";
    case "meal":
      return "Meal";
    case "caffeine-on":
      return "Caffeine";
    case "shift-start":
      return "Shift in";
    case "caffeine-cutoff":
      return "Caf. cutoff";
    case "shift-end":
      return "Shift out";
    case "wind-down":
      return "Wind-down";
    case "amber-light":
      return "Amber glasses";
    case "blackout":
      return "Sleep";
    case "recovery":
      return "Recovery";
    case "nap":
      return "Nap";
  }
}

/**
 * 7-day rolling plan strip. Tap a day to expand its Long Clock (every
 * meaningful moment between wake and sleep). Multi-week rotations are
 * surfaced via a small "Week A/B/…" chip.
 */
export function MultiDayPlan({ shifts, prefs, now }: { shifts: Shift[]; prefs: Prefs; now: Date }) {
  const days = useMemo<DayPlan[]>(
    () =>
      buildMultiDayPlan(shifts, prefs, now, 7, {
        lat: prefs.lat ?? null,
        lon: prefs.lon ?? null,
      }),
    [shifts, prefs, now],
  );
  const [openIdx, setOpenIdx] = useState<number | null>(0);

  return (
    <section className="mt-6">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-[10px] font-semibold uppercase tracking-[0.25em] text-indigo-glow">
          Next 7 Days — Long Clock
        </h2>
        {prefs.cycleWeeks > 1 && (
          <span className="text-[10px] italic text-muted-foreground">
            {prefs.cycleWeeks}-week rotation
          </span>
        )}
      </div>

      <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {days.map((d, i) => {
          const open = openIdx === i;
          const dow = (d.date.getDay() + 6) % 7;
          return (
            <button
              key={i}
              onClick={() => setOpenIdx(open ? null : i)}
              className={`flex min-w-[64px] flex-col items-center rounded-2xl border px-2 py-2 text-center transition active:scale-95 ${
                open
                  ? "border-primary/50 bg-primary/15"
                  : d.isOff
                    ? "border-border bg-secondary/50"
                    : "border-border bg-card"
              }`}
            >
              <span className="text-[9px] font-bold uppercase tracking-widest text-indigo-glow">
                {DOW[dow]}
              </span>
              <span className="text-lg leading-none" style={{ fontFamily: "var(--font-display)" }}>
                {d.date.getDate()}
              </span>
              {prefs.cycleWeeks > 1 && (
                <span className="mt-0.5 text-[9px] text-muted-foreground">
                  Wk {weekLabel(d.weekIndex)}
                </span>
              )}
              {d.shift ? (
                <span className="mt-1 text-[9px] font-semibold text-foreground/80">
                  {(() => {
                    const start = d.shift!.start;
                    const h24 = Math.floor(start / 60) % 24;
                    const h12 = ((h24 + 11) % 12) + 1;
                    return `${h12}${h24 >= 12 ? "p" : "a"}`;
                  })()}
                </span>
              ) : (
                <span className="mt-1 text-[9px] text-muted-foreground">Off</span>
              )}
            </button>
          );
        })}
      </div>

      {openIdx != null && days[openIdx] && (
        <div className="mt-3 rounded-2xl border border-border bg-card p-4">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-xs font-semibold text-foreground">
              {days[openIdx].date.toLocaleDateString(undefined, {
                weekday: "long",
                month: "short",
                day: "numeric",
              })}
            </p>
            {days[openIdx].shift && (
              <span className="text-[10px] uppercase tracking-widest text-indigo-glow">
                {fmtClock(
                  new Date(
                    days[openIdx].date.getFullYear(),
                    days[openIdx].date.getMonth(),
                    days[openIdx].date.getDate(),
                    Math.floor(days[openIdx].shift!.start / 60),
                    days[openIdx].shift!.start % 60,
                  ),
                )}
              </span>
            )}
          </div>

          {days[openIdx].longClock.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Rest day — protect your normal sleep window.
              {days[openIdx + 1]?.shift &&
                ` Next shift is ${days[openIdx + 1].date.toLocaleDateString(undefined, { weekday: "long" })}.`}
            </p>
          ) : (
            <ol className="space-y-2">
              {days[openIdx].longClock.map((ev, j) => (
                <li key={j} className="flex items-start gap-3">
                  <span className="mt-0.5 w-16 shrink-0 text-[11px] font-semibold tabular-nums text-indigo-glow">
                    {fmtClock(ev.at)}
                  </span>
                  <span className="flex-1">
                    <span className="text-sm font-semibold text-foreground">
                      {shortKind(ev.kind)} — {ev.title}
                    </span>
                    <span className="block text-xs text-muted-foreground">{ev.detail}</span>
                  </span>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </section>
  );
}
