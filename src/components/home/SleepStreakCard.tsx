import { Flame } from "lucide-react";
import { HomeCard, HomeCardHeader } from "./HomeCard";
import type { Shift } from "@/lib/shifts";

/** Streak = consecutive recent days that have a logged shift, ending today or yesterday. */
function computeStreak(shifts: Shift[], now: Date): number {
  if (!shifts.length) return 0;
  const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
  // map day-of-week presence (simple proxy — shifts don't carry dates, just weekday)
  const haveWeekday = new Set(shifts.map((s) => s.day));
  let streak = 0;
  const probe = new Date(now);
  for (let i = 0; i < 14; i++) {
    const weekday = (probe.getDay() + 6) % 7;
    if (haveWeekday.has(weekday)) streak++;
    else if (i > 0) break;
    probe.setDate(probe.getDate() - 1);
    void dayKey;
  }
  return streak;
}

export function SleepStreakCard({ shifts, now }: { shifts: Shift[]; now: Date }) {
  const streak = computeStreak(shifts, now);
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(now);
    d.setDate(d.getDate() - (6 - i));
    const weekday = (d.getDay() + 6) % 7;
    const has = shifts.some((s) => s.day === weekday);
    return { label: ["M", "T", "W", "T", "F", "S", "S"][weekday], has, isToday: i === 6 };
  });

  return (
    <HomeCard accent className="flex flex-col">
      <HomeCardHeader
        eyebrow="Sleep Streak"
        title={`${streak} day${streak === 1 ? "" : "s"} in rhythm`}
        action={
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-amber/20 text-amber">
            <Flame className="h-4 w-4" />
          </span>
        }
      />
      <p className="mt-2 text-xs text-muted-foreground">
        Logging shifts trains your body clock. Keep the streak alive.
      </p>

      <div className="mt-4 grid grid-cols-7 gap-1.5">
        {days.map((d, i) => (
          <div key={i} className="flex flex-col items-center gap-1.5">
            <span
              className={`flex h-8 w-full items-center justify-center rounded-lg text-[10px] font-bold ${
                d.has
                  ? "bg-gradient-to-b from-primary to-primary/60 text-primary-foreground shadow-[0_0_20px_-6px_var(--primary)]"
                  : "border border-white/10 bg-white/5 text-muted-foreground/60"
              } ${d.isToday ? "ring-2 ring-indigo-glow/60" : ""}`}
            >
              {d.has ? "✓" : ""}
            </span>
            <span className="text-[9px] uppercase tracking-wider text-muted-foreground/70">{d.label}</span>
          </div>
        ))}
      </div>
    </HomeCard>
  );
}
