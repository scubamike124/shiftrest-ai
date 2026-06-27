import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, X, Sparkles, Moon } from "lucide-react";
import {
  DAYS,
  type Shift,
  fetchShifts,
  addShift as addShiftRemote,
  updateShift as updateShiftRemote,
  deleteShift as deleteShiftRemote,
  fmt,
  parseTime,
  toTimeInput,
  endAbsolute,
} from "@/lib/shifts";
import { fetchEmployers, type Employer } from "@/lib/employers";
import { circadianDebt, detectRotation } from "@/lib/sleep-engine";
import { computeInsights } from "@/lib/insights";
import { buildRecommendations } from "@/lib/recommendations";
import { AIBriefCard } from "@/components/AIBriefCard";
import { CoachTipCard } from "@/components/CoachTipCard";
import { MultiDayPlan } from "@/components/MultiDayPlan";
import {
  shiftsForDate,
  weekIndexFor,
  weekLabel,
} from "@/lib/schedule";

import { LastNightStrip } from "@/components/LastNightStrip";
import { useServerFn } from "@tanstack/react-start";
import { getWearableSummary } from "@/lib/wearables/wearables.functions";
import { DEFAULT_PREFS, fetchPrefs, type Prefs, AuthRequiredError } from "@/lib/prefs";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useNavigate } from "@tanstack/react-router";


export const Route = createFileRoute("/dashboard")({
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
  const navigate = useNavigate();
  const { data: shifts = [] } = useQuery({
    queryKey: ["shifts"],
    queryFn: fetchShifts,
  });
  const { data: employers = [] } = useQuery({
    queryKey: ["employers"],
    queryFn: fetchEmployers,
  });
  const defaultEmployer = employers.find((e) => e.isDefault) ?? employers[0];
  const [editing, setEditing] = useState<{ day: number; weekIndex: number } | null>(null);
  const [mounted, setMounted] = useState(false);
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const { data: prefs = DEFAULT_PREFS } = useQuery({ queryKey: ["prefs"], queryFn: fetchPrefs, initialData: DEFAULT_PREFS });

  useEffect(() => {
    setMounted(true);
    supabase.auth.getSession().then(({ data }) => setSignedIn(!!data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => setSignedIn(!!session));
    return () => sub.subscription.unsubscribe();
  }, []);

  function handleAuthError(err: unknown, fallback: string) {
    if (err instanceof AuthRequiredError) {
      toast.error(err.message, {
        action: {
          label: "Sign in",
          onClick: () => navigate({ to: "/auth", search: { return: "/dashboard" } as never }),
        },
      });
    } else {
      toast.error(fallback);
    }
  }

  const saveMutation = useMutation({
    mutationFn: async (input: {
      day: number;
      weekIndex: number;
      start: number;
      end: number;
      employerId: string | null;
      title: string;
      notes: string;
    }) => {
      const existing = shifts.find(
        (x) => x.day === input.day && (x.weekIndex ?? 0) === input.weekIndex,
      );
      if (existing) {
        await updateShiftRemote(existing.id, input);
        return existing;
      }
      return addShiftRemote(input);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["shifts"] }),
    onError: (err) => handleAuthError(err, "Could not save shift. Please try again."),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteShiftRemote(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["shifts"] }),
    onError: (err) => handleAuthError(err, "Could not delete shift. Please try again."),
  });

  function removeShift(id: string) {
    deleteMutation.mutate(id);
  }

  const [today, setToday] = useState<Date>(() => new Date(0));
  useEffect(() => { setToday(new Date()); }, []);
  const weekday = (today.getDay() + 6) % 7;
  const monthDate = `${MONTHS[today.getMonth()]} ${today.getDate()}`;
  const rotation = useMemo(() => detectRotation(shifts), [shifts]);
  const debt = useMemo(() => circadianDebt(shifts), [shifts]);
  const todayShift = useMemo(
    () => shiftsForDate(shifts, today, prefs.cycleAnchor, prefs.cycleWeeks)[0],
    [shifts, today, prefs.cycleAnchor, prefs.cycleWeeks],
  );

  // Build week dates starting Monday
  const weekDates = useMemo(() => {
    const monday = new Date(today);
    monday.setDate(today.getDate() - weekday);
    return DAYS.map((d, i) => {
      const dt = new Date(monday);
      dt.setDate(monday.getDate() + i);
      const wi = weekIndexFor(dt, prefs.cycleAnchor, prefs.cycleWeeks);
      return { label: d, num: dt.getDate(), idx: i, date: dt, weekIndex: wi };
    });
  }, [today, weekday, prefs.cycleAnchor, prefs.cycleWeeks]);

  const currentWeekIdx = useMemo(
    () => weekIndexFor(today, prefs.cycleAnchor, prefs.cycleWeeks),
    [today, prefs.cycleAnchor, prefs.cycleWeeks],
  );

  // Next sleep window
  const nextSleep = useMemo(() => {
    if (!todayShift) return null;
    const end = endAbsolute(todayShift);
    const sleepStart = end + prefs.windDownMin;
    const sleepEnd = sleepStart + prefs.sleepHours * 60;
    return { start: sleepStart, end: sleepEnd };
  }, [todayShift, prefs.windDownMin, prefs.sleepHours]);

  const stability = Math.max(0, 100 - debt.score);
  const getWearableSummaryFn = useServerFn(getWearableSummary);
  const { data: wearableSummary } = useQuery({
    queryKey: ["wearable-summary"],
    queryFn: () => getWearableSummaryFn(),
    enabled: signedIn === true,
    staleTime: 60_000,
  });
  const insights = useMemo(
    () =>
      mounted
        ? computeInsights(shifts, prefs, today, employers, wearableSummary?.latest ?? null)
        : null,
    [shifts, prefs, today, mounted, employers, wearableSummary],
  );
  const recommendations = useMemo(
    () =>
      insights
        ? buildRecommendations(insights, prefs, today, {
            lat: prefs.lat ?? null,
            lon: prefs.lon ?? null,
          })
        : [],
    [insights, prefs, today],
  );


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

      {/* AI Coach Brief — proactive guidance every time you open the app */}
      {insights && (
        <div className="mt-4">
          <AIBriefCard insights={insights} recommendations={recommendations} />
        </div>
      )}

      {/* Contextual coach tip — refreshable, uses budgeted AI */}
      {insights && (
        <div className="mt-4">
          <CoachTipCard signedIn={signedIn === true} context={insights.contextString} />
        </div>
      )}

      <div className="mt-4">
        <LastNightStrip />
      </div>

      {/* Quick Action + Stability */}
      <div className="mt-4 grid grid-cols-5 gap-3">

        <button
          onClick={() => { if (signedIn === false) { handleAuthError(new AuthRequiredError("Sign in to save your shifts."), ""); return; } setEditing({ day: weekday, weekIndex: currentWeekIdx }); }}
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
          {weekDates.map(({ label, num, idx, weekIndex: wi }) => {
            const hasShift = !!shifts.find((s) => s.day === idx && (s.weekIndex ?? 0) === wi);
            const isToday = idx === weekday;
            const isPast = idx < weekday;
            return (
              <button
                key={label}
                onClick={() => { if (signedIn === false) { handleAuthError(new AuthRequiredError("Sign in to save your shifts."), ""); return; } setEditing({ day: idx, weekIndex: wi }); }}
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
                {prefs.cycleWeeks > 1 && (
                  <span className="mt-0.5 text-[8px] uppercase tracking-widest text-muted-foreground">
                    Wk {weekLabel(wi)}
                  </span>
                )}
                {hasShift && (() => {
                  const s = shifts.find((x) => x.day === idx && (x.weekIndex ?? 0) === wi)!;
                  const emp = employers.find((e) => e.id === s.employerId);
                  return (
                    <span
                      className="mt-1 h-1.5 w-1.5 rounded-full"
                      style={{ background: emp?.color ?? (isToday ? "white" : "var(--indigo)") }}
                    />
                  );
                })()}
              </button>
            );
          })}
          {/* Add tile */}
          <button
            onClick={() => { if (signedIn === false) { handleAuthError(new AuthRequiredError("Sign in to save your shifts."), ""); return; } setEditing({ day: weekday, weekIndex: currentWeekIdx }); }}
            aria-label="Quick add"
            className="flex aspect-square items-center justify-center rounded-2xl border border-dashed border-border bg-transparent text-muted-foreground active:scale-95"
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>
      </section>

      {/* Today shift detail (if any) */}
      {todayShift && (() => {
        const emp = employers.find((e) => e.id === todayShift.employerId);
        return (
          <section
            className="mt-6 rounded-2xl border bg-card p-4"
            style={{ borderColor: emp ? `${emp.color}55` : "var(--border)" }}
          >
            <div className="flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2">
                  {emp && (
                    <span
                      className="h-2 w-2 rounded-full"
                      style={{ background: emp.color }}
                    />
                  )}
                  <p className="text-[10px] font-medium uppercase tracking-widest text-indigo-glow">
                    {emp ? emp.name : "Tonight's shift"}
                  </p>
                </div>
                <p className="mt-1 text-lg font-semibold">
                  {fmt(todayShift.start)} – {fmt(todayShift.end)}
                </p>
                {todayShift.title && (
                  <p className="text-xs text-muted-foreground">{todayShift.title}</p>
                )}
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
        );
      })()}

      {/* Long Clock / Multi-day plan */}
      {mounted && <MultiDayPlan shifts={shifts} prefs={prefs} now={today} />}

      {/* Events & Smart Alarm entry point (Bundle 2) */}
      <Link
        to="/events"
        className="mt-4 flex items-center justify-between rounded-2xl border border-border bg-card p-4 active:scale-[0.99]"
      >
        <div>
          <p className="text-sm font-semibold">Events & Smart Alarm</p>
          <p className="text-xs text-muted-foreground">
            Calendar prep · commute leave-by · AI-optimized wake
          </p>
        </div>
        <Sparkles className="h-5 w-5 text-primary" />
      </Link>

      {editing && (
        <ShiftEditor
          day={editing.day}
          weekIndex={editing.weekIndex}
          cycleWeeks={prefs.cycleWeeks}
          existing={shifts.find(
            (s) => s.day === editing.day && (s.weekIndex ?? 0) === editing.weekIndex,
          )}
          employers={employers}
          defaultEmployerId={defaultEmployer?.id ?? null}
          onClose={() => setEditing(null)}
          onSave={(payload) => {
            saveMutation.mutate({ day: editing.day, ...payload });
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
  weekIndex,
  cycleWeeks,
  existing,
  employers,
  defaultEmployerId,
  onClose,
  onSave,
}: {
  day: number;
  weekIndex: number;
  cycleWeeks: number;
  existing?: Shift;
  employers: Employer[];
  defaultEmployerId: string | null;
  onClose: () => void;
  onSave: (payload: {
    weekIndex: number;
    start: number;
    end: number;
    employerId: string | null;
    title: string;
    notes: string;
  }) => void;
}) {
  const [start, setStart] = useState(toTimeInput(existing?.start ?? 23 * 60));
  const [end, setEnd] = useState(toTimeInput(existing?.end ?? 7 * 60));
  const [wi, setWi] = useState<number>(existing?.weekIndex ?? weekIndex);
  const [employerId, setEmployerId] = useState<string | null>(
    existing?.employerId ?? defaultEmployerId,
  );
  const [title, setTitle] = useState(existing?.title ?? "");
  const [notes, setNotes] = useState(existing?.notes ?? "");
  const showPicker = employers.length > 1;
  const showWeekPicker = cycleWeeks > 1;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-t-3xl border border-border bg-card p-6 pb-[calc(env(safe-area-inset-bottom)+1.5rem)] max-h-[90vh] overflow-y-auto">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <p className="text-[10px] uppercase tracking-widest text-indigo-glow">
              {DAYS[day]}
              {showWeekPicker ? ` · Week ${weekLabel(wi)}` : ""}
            </p>
            <h3 className="text-2xl" style={{ fontFamily: "var(--font-display)" }}>
              {existing ? "Edit shift" : "Log your shift"}
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

        {showWeekPicker && (
          <div className="mb-3">
            <p className="mb-1.5 text-xs font-medium text-muted-foreground">Rotation week</p>
            <div className="flex flex-wrap gap-2">
              {Array.from({ length: cycleWeeks }, (_, i) => i).map((i) => (
                <button
                  key={i}
                  onClick={() => setWi(i)}
                  className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                    wi === i
                      ? "border-transparent bg-primary text-primary-foreground"
                      : "border-border bg-secondary text-foreground"
                  }`}
                >
                  Week {weekLabel(i)}
                </button>
              ))}
            </div>
          </div>
        )}

        {showPicker && (
          <div className="mb-3">
            <p className="mb-1.5 text-xs font-medium text-muted-foreground">Employer</p>
            <div className="flex flex-wrap gap-2">
              {employers.map((e) => (
                <button
                  key={e.id}
                  onClick={() => setEmployerId(e.id)}
                  className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                    employerId === e.id
                      ? "border-transparent text-primary-foreground"
                      : "border-border bg-secondary text-foreground"
                  }`}
                  style={employerId === e.id ? { background: e.color } : undefined}
                >
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{ background: e.color }}
                  />
                  {e.name}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <TimeField label="Starts" value={start} onChange={setStart} />
          <TimeField label="Ends" value={end} onChange={setEnd} />
        </div>

        <label className="mt-3 flex flex-col gap-1.5">
          <span className="text-xs font-medium text-muted-foreground">
            Shift name <span className="opacity-60">(optional)</span>
          </span>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Night Shift, ER Coverage, Overtime"
            className="h-11 rounded-xl border border-border bg-input px-3 text-sm font-medium outline-none focus:border-primary"
          />
        </label>

        <label className="mt-3 flex flex-col gap-1.5">
          <span className="text-xs font-medium text-muted-foreground">
            Notes <span className="opacity-60">(optional)</span>
          </span>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            placeholder="Anything to remember about this shift"
            className="resize-none rounded-xl border border-border bg-input px-3 py-2 text-sm outline-none focus:border-primary"
          />
        </label>

        <p className="mt-3 text-xs text-muted-foreground">
          Overnight shifts are supported — set an end time earlier than start to wrap to the
          next day.
        </p>

        <button
          onClick={() =>
            onSave({
              weekIndex: wi,
              start: parseTime(start),
              end: parseTime(end),
              employerId,
              title,
              notes,
            })
          }
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
