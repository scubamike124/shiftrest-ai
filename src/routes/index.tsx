import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, X, Sparkles, Moon } from "lucide-react";
import {
  DAYS,
  type Shift,
  fetchShifts,
  addShift as addShiftRemote,
  deleteShift as deleteShiftRemote,
  fmt,
  parseTime,
  toTimeInput,
  endAbsolute,
} from "@/lib/shifts";
import { circadianDebt, detectRotation } from "@/lib/sleep-engine";
import { DEFAULT_PREFS, fetchPrefs, type Prefs } from "@/lib/prefs";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Your Week — RestPilot AI" },
      {
        name: "description",
        content: "Map your shifts and see automatic wind-down and sleep windows.",
      },
    ],
  }),
  component: Dashboard,
});

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function Dashboard() {
  const queryClient = useQueryClient();
  const { data: shifts = [] } = useQuery({
    queryKey: ["shifts"],
    queryFn: fetchShifts,
  });
  const [editing, setEditing] = useState<{ day: number } | null>(null);
  const [mounted, setMounted] = useState(false);
  const { data: prefs = DEFAULT_PREFS } = useQuery({ queryKey: ["prefs"], queryFn: fetchPrefs, initialData: DEFAULT_PREFS });

  useEffect(() => {
    setMounted(true);
  }, []);

  const addMutation = useMutation({
    mutationFn: async (input: { day: number; start: number; end: number }) => {
      // Replace any existing shift on this day (mirrors prior single-shift-per-day UX).
      const existing = shifts.find((x) => x.day === input.day);
      if (existing) await deleteShiftRemote(existing.id);
      return addShiftRemote(input);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["shifts"] }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteShiftRemote(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["shifts"] }),
  });

  function addShift(day: number, start: number, end: number) {
    addMutation.mutate({ day, start, end });
  }

  function removeShift(id: string) {
    deleteMutation.mutate(id);
  }

  const [today, setToday] = useState<Date>(() => new Date(0));
  useEffect(() => { setToday(new Date()); }, []);
  const weekday = (today.getDay() + 6) % 7;
  const monthDate = `${MONTHS[today.getMonth()]} ${today.getDate()}`;
  const rotation = useMemo(() => detectRotation(shifts), [shifts]);
  const debt = useMemo(() => circadianDebt(shifts), [shifts]);
  const todayShift = shifts.find((s) => s.day === weekday);

  // Build week dates starting Monday
  const weekDates = useMemo(() => {
    const monday = new Date(today);
    monday.setDate(today.getDate() - weekday);
    return DAYS.map((d, i) => {
      const dt = new Date(monday);
      dt.setDate(monday.getDate() + i);
      return { label: d, num: dt.getDate(), idx: i };
    });
  }, [today, weekday]);

  // Next sleep window
  const nextSleep = useMemo(() => {
    if (!todayShift) return null;
    const end = endAbsolute(todayShift);
    const sleepStart = end + prefs.windDownMin;
    const sleepEnd = sleepStart + prefs.sleepHours * 60;
    return { start: sleepStart, end: sleepEnd };
  }, [todayShift, prefs.windDownMin, prefs.sleepHours]);

  const stability = Math.max(0, 100 - debt.score);

  return (
    <main className="flex flex-col px-5 pt-10 pb-6">
      {/* Header */}
      <header className="mb-5 flex items-end justify-between">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.25em] text-indigo-glow">
            RestPilot AI
          </p>
          <h1 className="mt-1 text-[34px] leading-none">
            {mounted ? DAYS[weekday] : "—"},{" "}
            <span className="italic opacity-60">{mounted ? monthDate : ""}</span>
          </h1>
        </div>
        <Link
          to="/profile"
          aria-label="Profile"
          className="flex h-10 w-10 items-center justify-center rounded-full border border-primary/30 bg-gradient-to-br from-secondary to-background"
        >
          <span className="h-2 w-2 animate-pulse rounded-full bg-primary" />
        </Link>
      </header>

      {/* HERO BENTO */}
      <section
        className="relative overflow-hidden rounded-[32px] border border-primary/20 p-6"
        style={{ background: "var(--gradient-hero)", boxShadow: "var(--shadow-card)" }}
      >
        <div className="absolute -right-20 -top-20 h-48 w-48 rounded-full bg-primary/30 blur-[60px] breathe" />

        <div className="relative z-10 flex items-start justify-between gap-4">
          <div className="flex flex-col gap-6">
            <div>
              <p className="text-[10px] font-medium uppercase tracking-widest text-indigo-glow">
                Circadian Debt
              </p>
              <p className="mt-1 flex items-baseline gap-1">
                <span
                  className="text-5xl"
                  style={{
                    fontFamily: "var(--font-display)",
                    color: debt.score >= 60 ? "var(--destructive)" : debt.score >= 30 ? "var(--amber)" : "var(--indigo-glow)",
                  }}
                >
                  {mounted ? debt.score : 0}
                </span>
                <span className="text-sm font-medium text-muted-foreground">/100</span>
              </p>
              <p className="mt-0.5 text-[10px] text-muted-foreground/80">{rotation.label}</p>
            </div>

            <div>
              <p className="text-[10px] font-medium uppercase tracking-widest text-indigo-glow">
                Next Sleep
              </p>
              <p className="mt-1 text-xl font-semibold">
                {nextSleep ? fmt(nextSleep.start) : "—"}
              </p>
              <p className="mt-0.5 text-[10px] text-muted-foreground/80">
                {nextSleep
                  ? `${prefs.sleepHours}h window predicted`
                  : "Add a shift to forecast"}
              </p>
            </div>
          </div>

          {/* Circadian Ring */}
          <CircadianRing shift={todayShift} prefs={prefs} mounted={mounted} />
        </div>
      </section>

      {/* Quick Action + Stability */}
      <div className="mt-4 grid grid-cols-5 gap-3">
        <button
          onClick={() => setEditing({ day: weekday })}
          className="col-span-3 flex flex-col justify-between rounded-[24px] border border-primary/40 p-5 text-left active:scale-[0.99]"
          style={{ background: "var(--gradient-cta)" }}
        >
          <p className="text-sm font-semibold leading-tight text-primary-foreground">
            {todayShift ? "Edit today's\nshift" : "Log today's\nshift"}
          </p>
          <span className="mt-4 flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white/15 text-primary-foreground">
              <Plus className="h-4 w-4" strokeWidth={2.5} />
            </span>
            <span className="text-[10px] font-bold uppercase tracking-widest text-primary-foreground">
              {todayShift ? "Edit" : "Add"}
            </span>
          </span>
        </button>

        <div className="col-span-2 flex flex-col items-center justify-center rounded-[24px] border border-border bg-card p-4 text-center">
          <p className="text-[10px] font-medium uppercase tracking-widest text-indigo-glow">
            Stability
          </p>
          <p className="mt-1 text-2xl" style={{ fontFamily: "var(--font-display)" }}>
            {mounted ? stability : 0}%
          </p>
          <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-secondary">
            <div
              className="h-full rounded-full transition-all duration-1000"
              style={{ width: `${mounted ? stability : 0}%`, background: "var(--indigo)" }}
            />
          </div>
        </div>
      </div>

      {/* Weekly bento grid */}
      <section className="mt-6">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-[10px] font-semibold uppercase tracking-[0.25em] text-indigo-glow">
            Weekly Rhythm
          </h2>
          <span className="text-[10px] italic text-muted-foreground">
            {shifts.length} shift{shifts.length === 1 ? "" : "s"} scheduled
          </span>
        </div>

        <div className="grid grid-cols-4 gap-3">
          {weekDates.map(({ label, num, idx }) => {
            const hasShift = !!shifts.find((s) => s.day === idx);
            const isToday = idx === weekday;
            const isPast = idx < weekday;
            return (
              <button
                key={label}
                onClick={() => setEditing({ day: idx })}
                className={`relative flex aspect-square flex-col items-center justify-center rounded-2xl transition active:scale-95 ${
                  isToday
                    ? "border border-white/20 shadow-[var(--shadow-glow)]"
                    : "border border-border bg-card"
                } ${isPast && !isToday ? "opacity-60" : ""}`}
                style={
                  isToday
                    ? {
                        background:
                          "linear-gradient(180deg, var(--indigo) 0%, var(--secondary) 100%)",
                      }
                    : undefined
                }
              >
                <span className="text-[10px] font-bold uppercase tracking-wider text-indigo-glow">
                  {label}
                </span>
                <span
                  className="text-lg leading-none"
                  style={{ fontFamily: "var(--font-display)", fontStyle: isToday ? "italic" : "normal" }}
                >
                  {num}
                </span>
                {hasShift && (
                  <span
                    className="mt-1 h-1 w-1 rounded-full"
                    style={{ background: isToday ? "white" : "var(--indigo)" }}
                  />
                )}
              </button>
            );
          })}
          {/* Add tile */}
          <button
            onClick={() => setEditing({ day: weekday })}
            aria-label="Quick add"
            className="flex aspect-square items-center justify-center rounded-2xl border border-dashed border-border bg-transparent text-muted-foreground active:scale-95"
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>
      </section>

      {/* Today shift detail (if any) */}
      {todayShift && (
        <section className="mt-6 rounded-2xl border border-border bg-card p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[10px] font-medium uppercase tracking-widest text-indigo-glow">
                Tonight's shift
              </p>
              <p className="mt-1 text-lg font-semibold">
                {fmt(todayShift.start)} – {fmt(todayShift.end)}
              </p>
            </div>
            <button
              onClick={() => removeShift(todayShift.id)}
              aria-label="Remove shift"
              className="flex h-10 w-10 items-center justify-center rounded-full bg-secondary text-muted-foreground active:scale-95"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
          <Timeline shift={todayShift} />
          <Link
            to="/plan"
            className="mt-4 flex h-11 items-center justify-center gap-2 rounded-xl bg-primary/15 text-sm font-semibold text-primary-foreground"
          >
            <Sparkles className="h-4 w-4 text-indigo-glow" />
            <span className="text-foreground">See today's light plan</span>
          </Link>
        </section>
      )}

      {editing && (
        <ShiftEditor
          day={editing.day}
          existing={shifts.find((s) => s.day === editing.day)}
          onClose={() => setEditing(null)}
          onSave={(start, end) => {
            addShift(editing.day, start, end);
            setEditing(null);
          }}
        />
      )}
    </main>
  );
}

function CircadianRing({
  shift,
  prefs,
  mounted,
}: {
  shift?: Shift;
  prefs: Prefs;
  mounted: boolean;
}) {
  const R = 58;
  const C = 2 * Math.PI * R;
  // base offset to make 0=midnight at top
  const minsToOffset = (m: number) => (m / 1440) * C;
  let shiftSeg = { len: 0, off: 0 };
  let windSeg = { len: 0, off: 0 };
  let sleepSeg = { len: 0, off: 0 };
  if (shift) {
    const start = shift.start;
    const shiftLen = endAbsolute(shift) - start;
    const end = endAbsolute(shift) % 1440;
    const windLen = prefs.windDownMin;
    const sleepLen = prefs.sleepHours * 60;
    shiftSeg = { len: minsToOffset(shiftLen), off: minsToOffset(start) };
    windSeg = { len: minsToOffset(windLen), off: minsToOffset(end) };
    sleepSeg = { len: minsToOffset(sleepLen), off: minsToOffset((end + windLen) % 1440) };
  }

  return (
    <div className="relative h-32 w-32 shrink-0">
      <svg viewBox="0 0 128 128" className="h-full w-full -rotate-90">
        <circle cx="64" cy="64" r={R} fill="none" stroke="var(--secondary)" strokeWidth="8" />
        {shift && mounted && (
          <>
            <circle
              cx="64" cy="64" r={R} fill="none"
              stroke="var(--indigo)" strokeWidth="8" strokeLinecap="round"
              strokeDasharray={`${shiftSeg.len} ${C}`}
              strokeDashoffset={-shiftSeg.off}
            />
            <circle
              cx="64" cy="64" r={R} fill="none"
              stroke="var(--amber)" strokeWidth="6" strokeLinecap="round" opacity="0.8"
              strokeDasharray={`${windSeg.len} ${C}`}
              strokeDashoffset={-windSeg.off}
            />
            <circle
              cx="64" cy="64" r={R} fill="none"
              stroke="var(--indigo-glow)" strokeWidth="4" strokeLinecap="round" opacity="0.7"
              strokeDasharray={`${sleepSeg.len} ${C}`}
              strokeDashoffset={-sleepSeg.off}
            />
          </>
        )}
      </svg>
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-indigo-glow">
        <Moon className="h-5 w-5" />
      </div>
    </div>
  );
}

function Timeline({ shift }: { shift: Shift }) {
  const total = 24 * 60;
  const { data: prefs = DEFAULT_PREFS } = useQuery({ queryKey: ["prefs"], queryFn: fetchPrefs, initialData: DEFAULT_PREFS });
  const segs = useMemo(() => {
    const out: { start: number; len: number; kind: "shift" | "wind" | "sleep" }[] = [];
    const push = (start: number, len: number, kind: "shift" | "wind" | "sleep") => {
      let s = start % total;
      let remaining = len;
      while (remaining > 0) {
        const room = total - s;
        const take = Math.min(room, remaining);
        out.push({ start: s, len: take, kind });
        s = 0;
        remaining -= take;
      }
    };
    const shiftLen = endAbsolute(shift) - shift.start;
    push(shift.start, shiftLen, "shift");
    const end = endAbsolute(shift);
    push(end, prefs.windDownMin, "wind");
    push(end + prefs.windDownMin, prefs.sleepHours * 60, "sleep");
    return out;
  }, [shift, prefs.windDownMin, prefs.sleepHours]);

  return (
    <div className="mt-3">
      <div className="relative h-3 overflow-hidden rounded-full bg-secondary">
        {segs.map((s, i) => (
          <div
            key={i}
            className="absolute top-0 h-full"
            style={{
              left: `${(s.start / total) * 100}%`,
              width: `${(s.len / total) * 100}%`,
              background:
                s.kind === "shift"
                  ? "var(--shift)"
                  : s.kind === "wind"
                  ? "var(--winddown)"
                  : "var(--sleep)",
            }}
          />
        ))}
      </div>
      <div className="mt-2 flex justify-between text-[10px] text-muted-foreground">
        <span>12a</span>
        <span>6a</span>
        <span>12p</span>
        <span>6p</span>
        <span>12a</span>
      </div>
    </div>
  );
}

function ShiftEditor({
  day,
  existing,
  onClose,
  onSave,
}: {
  day: number;
  existing?: Shift;
  onClose: () => void;
  onSave: (start: number, end: number) => void;
}) {
  const [start, setStart] = useState(toTimeInput(existing?.start ?? 23 * 60));
  const [end, setEnd] = useState(toTimeInput(existing?.end ?? 7 * 60));

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-t-3xl border border-border bg-card p-6 pb-[calc(env(safe-area-inset-bottom)+1.5rem)]">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <p className="text-[10px] uppercase tracking-widest text-indigo-glow">
              {DAYS[day]}
            </p>
            <h3 className="text-2xl" style={{ fontFamily: "var(--font-display)" }}>
              Log your shift
            </h3>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="flex h-10 w-10 items-center justify-center rounded-full bg-secondary"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <TimeField label="Starts" value={start} onChange={setStart} />
          <TimeField label="Ends" value={end} onChange={setEnd} />
        </div>

        <p className="mt-3 text-xs text-muted-foreground">
          Overnight shifts are supported — set an end time earlier than start to wrap to the
          next day.
        </p>

        <button
          onClick={() => onSave(parseTime(start), parseTime(end))}
          className="mt-5 h-14 w-full rounded-2xl text-base font-semibold text-primary-foreground shadow-[var(--shadow-glow)] active:scale-[0.99]"
          style={{ background: "var(--gradient-cta)" }}
        >
          Save shift
        </button>
      </div>
    </div>
  );
}

function TimeField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <input
        type="time"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-14 rounded-2xl border border-border bg-input px-4 text-lg font-semibold text-foreground outline-none focus:border-primary"
      />
    </label>
  );
}
