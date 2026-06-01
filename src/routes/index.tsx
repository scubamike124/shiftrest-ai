import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Moon, Plus, Trash2, X, TrendingUp, Sparkles } from "lucide-react";
import {
  DAYS,
  type Shift,
  loadShifts,
  saveShifts,
  fmt,
  parseTime,
  toTimeInput,
  endAbsolute,
} from "@/lib/shifts";
import { circadianDebt, detectRotation } from "@/lib/sleep-engine";
import { loadPrefs } from "@/lib/prefs";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Your Week — ShiftRest AI" },
      {
        name: "description",
        content: "Map your shifts and see automatic wind-down and sleep windows.",
      },
    ],
  }),
  component: Dashboard,
});

function Dashboard() {
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [editing, setEditing] = useState<{ day: number } | null>(null);
  const prefs = useMemo(() => loadPrefs(), []);

  useEffect(() => {
    setShifts(loadShifts());
  }, []);

  function update(next: Shift[]) {
    setShifts(next);
    saveShifts(next);
  }

  function addShift(day: number, start: number, end: number) {
    const s: Shift = { id: crypto.randomUUID(), day, start, end };
    update([...shifts.filter((x) => x.day !== day), s]);
  }

  function removeShift(id: string) {
    update(shifts.filter((s) => s.id !== id));
  }

  const today = new Date();
  const weekday = (today.getDay() + 6) % 7;
  const rotation = useMemo(() => detectRotation(shifts), [shifts]);
  const debt = useMemo(() => circadianDebt(shifts), [shifts]);

  return (
    <main className="flex flex-col gap-6 px-5 pt-12">
      <header>
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">
          ShiftRest AI
        </p>
        <h1 className="mt-2 text-3xl font-bold">Your week, optimized.</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Tap a day to log your shift. We'll plot wind-down and sleep windows automatically.
        </p>
      </header>

      <section className="rounded-3xl border border-border bg-[image:var(--gradient-hero)] p-5 shadow-[var(--shadow-glow)]">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs uppercase tracking-widest text-muted-foreground">Today</p>
            <h2 className="mt-1 text-xl font-semibold">{DAYS[weekday]}</h2>
          </div>
          <Moon className="h-8 w-8 text-primary" />
        </div>
        <NextWindowSummary
          shifts={shifts}
          weekday={weekday}
          sleepHours={prefs.sleepHours}
          windDownMin={prefs.windDownMin}
        />
      </section>

      {shifts.length > 0 && (
        <section className="rounded-2xl border border-border bg-card p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-widest text-muted-foreground">
                Circadian debt
              </p>
              <p className="mt-1 text-2xl font-bold">
                {debt.score}
                <span className="text-sm font-medium text-muted-foreground">/100</span>
              </p>
              <p className="mt-1 text-xs text-muted-foreground">{rotation.label}</p>
            </div>
            <DebtRing score={debt.score} />
          </div>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-secondary">
            <div
              className="h-full rounded-full transition-all"
              style={{
                width: `${debt.score}%`,
                background:
                  debt.score >= 60
                    ? "var(--destructive)"
                    : debt.score >= 30
                    ? "var(--amber)"
                    : "var(--mint)",
              }}
            />
          </div>
          {debt.reasons.length > 0 && (
            <ul className="mt-3 flex flex-wrap gap-1.5">
              {debt.reasons.slice(0, 4).map((r) => (
                <li
                  key={r}
                  className="rounded-full bg-secondary px-2.5 py-1 text-[10px] text-muted-foreground"
                >
                  {r}
                </li>
              ))}
            </ul>
          )}
          <Link
            to="/plan"
            className="mt-4 flex h-11 items-center justify-center gap-2 rounded-xl bg-primary/15 text-sm font-semibold text-primary"
          >
            <Sparkles className="h-4 w-4" /> See today's light plan
          </Link>
        </section>
      )}

      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold">This week</h3>
          <span className="text-xs text-muted-foreground">
            {shifts.length} shift{shifts.length === 1 ? "" : "s"}
          </span>
        </div>

        <div className="flex flex-col gap-3">
          {DAYS.map((d, idx) => {
            const shift = shifts.find((s) => s.day === idx);
            return (
              <DayRow
                key={d}
                day={idx}
                label={d}
                today={idx === weekday}
                shift={shift}
                onAdd={() => setEditing({ day: idx })}
                onRemove={() => shift && removeShift(shift.id)}
              />
            );
          })}
        </div>
      </section>

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

function DebtRing({ score }: { score: number }) {
  const tone =
    score >= 60 ? "text-destructive" : score >= 30 ? "text-amber" : "text-mint";
  return (
    <span
      className={`flex h-12 w-12 items-center justify-center rounded-full bg-secondary ${tone}`}
    >
      <TrendingUp className="h-5 w-5" />
    </span>
  );
}

function NextWindowSummary({
  shifts,
  weekday,
  sleepHours,
  windDownMin,
}: {
  shifts: Shift[];
  weekday: number;
  sleepHours: number;
  windDownMin: number;
}) {
  const todayShift = shifts.find((s) => s.day === weekday);
  if (!todayShift) {
    return (
      <p className="mt-4 text-sm text-muted-foreground">
        No shift logged for today — add one below to generate your recovery windows.
      </p>
    );
  }
  const end = endAbsolute(todayShift);
  return (
    <div className="mt-4 grid grid-cols-2 gap-3">
      <Tile label="Wind-down" value={`${fmt(end)} → ${fmt(end + windDownMin)}`} tone="amber" />
      <Tile
        label="Sleep window"
        value={`${fmt(end + windDownMin)} → ${fmt(end + windDownMin + sleepHours * 60)}`}
        tone="mint"
      />
    </div>
  );
}

function Tile({ label, value, tone }: { label: string; value: string; tone: "amber" | "mint" }) {
  const cls =
    tone === "amber"
      ? "border-amber/30 bg-amber/10 text-amber"
      : "border-mint/30 bg-mint/10 text-mint";
  return (
    <div className={`rounded-2xl border ${cls} p-3`}>
      <p className="text-[10px] uppercase tracking-widest opacity-80">{label}</p>
      <p className="mt-1 text-sm font-semibold text-foreground">{value}</p>
    </div>
  );
}

function DayRow({
  day,
  label,
  today,
  shift,
  onAdd,
  onRemove,
}: {
  day: number;
  label: string;
  today: boolean;
  shift?: Shift;
  onAdd: () => void;
  onRemove: () => void;
}) {
  return (
    <div
      className={`rounded-2xl border bg-card p-4 transition ${
        today ? "border-primary/50" : "border-border"
      }`}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span
            className={`flex h-9 w-9 items-center justify-center rounded-xl text-sm font-bold ${
              today ? "bg-primary text-primary-foreground" : "bg-secondary text-foreground"
            }`}
          >
            {label[0]}
          </span>
          <div>
            <p className="text-sm font-semibold">{label}</p>
            <p className="text-xs text-muted-foreground">
              {shift ? `${fmt(shift.start)} – ${fmt(shift.end)}` : "No shift"}
            </p>
          </div>
        </div>
        {shift ? (
          <button
            onClick={onRemove}
            aria-label="Remove shift"
            className="flex h-10 w-10 items-center justify-center rounded-full bg-secondary text-muted-foreground active:scale-95"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        ) : (
          <button
            onClick={onAdd}
            className="flex h-10 items-center gap-1 rounded-full bg-primary px-4 text-sm font-semibold text-primary-foreground active:scale-95"
          >
            <Plus className="h-4 w-4" /> Add
          </button>
        )}
      </div>
      {shift && <Timeline shift={shift} />}
    </div>
  );
}

function Timeline({ shift }: { shift: Shift }) {
  const total = 24 * 60;
  const prefs = loadPrefs();
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
            <p className="text-xs uppercase tracking-widest text-muted-foreground">
              {DAYS[day]}
            </p>
            <h3 className="text-xl font-semibold">Log your shift</h3>
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
          className="mt-5 h-14 w-full rounded-2xl bg-primary text-base font-semibold text-primary-foreground shadow-[var(--shadow-glow)] active:scale-[0.99]"
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
