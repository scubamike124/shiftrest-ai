import { createFileRoute, Link } from "@tanstack/react-router";
import { requireSession } from "@/lib/require-session";
import { CompanionIntroSheet } from "@/components/companion/CompanionIntroSheet";
import { CompanionHero } from "@/components/home/CompanionHero";
import { HomeCard, HomeCardHeader } from "@/components/home/HomeCard";
import { SleepSoundsCard } from "@/components/home/SleepSoundsCard";
import { HydrationCard } from "@/components/home/HydrationCard";
import { SleepStreakCard } from "@/components/home/SleepStreakCard";
import { QuickActionsCard } from "@/components/home/QuickActionsCard";
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
import { ArrivalHero } from "@/components/ArrivalHero";
import { MultiDayPlan } from "@/components/MultiDayPlan";
import { RightNowCard } from "@/components/RightNowCard";
import { CompanionWhisper } from "@/components/CompanionWhisper";
import { TomorrowPreviewCard } from "@/components/TomorrowPreviewCard";
import { DailyReviewCard } from "@/components/DailyReviewCard";
import { PatternAlerts } from "@/components/PatternAlerts";
import { LongClock } from "@/components/LongClock";
import { DecisionCenterCard } from "@/components/DecisionCenterCard";
import { AIActivityFeed } from "@/components/AIActivityFeed";
import {
  shiftsForDate,
  weekIndexFor,
  weekLabel,
} from "@/lib/schedule";

import { LastNightStrip } from "@/components/LastNightStrip";
import { OfflineBanner } from "@/components/OfflineBanner";
import { useServerFn } from "@tanstack/react-start";
import { getWearableSummary } from "@/lib/wearables/wearables.functions";
import { DEFAULT_PREFS, fetchPrefs, type Prefs, AuthRequiredError } from "@/lib/prefs";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useNavigate } from "@tanstack/react-router";
import { useOnlineTransition } from "@/hooks/use-online";
import {
  hydrateQueryCacheFromSnapshot,
  persistSnapshot,
  reconcileOnReconnect,
} from "@/lib/offline/snapshot";
import { getCachedUserIdSync } from "@/lib/offline/cache";


export const Route = createFileRoute("/dashboard")({
  ssr: false,
  beforeLoad: requireSession,
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

  // CRITICAL: hydrate the offline snapshot SYNCHRONOUSLY before the first
  // `useQuery` below subscribes/fetches. If we wait for
  // `supabase.auth.getSession().then(...)` (a microtask), the shifts query
  // has already fired `fetchShifts()` → throws offline → lands in error
  // state, and the snapshot hydration arrives too late to render.
  //
  // `useState` initializer guarantees this runs exactly once per mount,
  // before any effect, before any child render. The user id comes from a
  // sync localStorage probe (Supabase persists session synchronously).
  useState(() => {
    const uid = getCachedUserIdSync();
    hydrateQueryCacheFromSnapshot(queryClient, uid);
    return uid;
  });

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
  const [userId, setUserId] = useState<string | null>(() => getCachedUserIdSync());
  const { data: prefs = DEFAULT_PREFS } = useQuery({ queryKey: ["prefs"], queryFn: fetchPrefs, initialData: DEFAULT_PREFS });

  useEffect(() => {
    setMounted(true);
    supabase.auth.getSession().then(({ data }) => {
      setSignedIn(!!data.session);
      const id = data.session?.user.id ?? null;
      setUserId(id);
      // Re-hydrate if the live session id differs from the sync probe
      // (e.g. probe missed the key, or a different user signed in).
      hydrateQueryCacheFromSnapshot(queryClient, id);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      setSignedIn(!!session);
      setUserId(session?.user.id ?? null);
    });
    return () => sub.subscription.unsubscribe();
  }, [queryClient]);

  // Mirror plan inputs to localStorage whenever ANY of them change while
  // online. We subscribe to the React Query cache directly so a new shift
  // or employer triggers a snapshot — depending on `prefs` alone (the
  // previous shape) silently dropped shift/employer edits.
  useEffect(() => {
    const trigger = () => {
      if (typeof navigator !== "undefined" && navigator.onLine === false) return;
      persistSnapshot(queryClient, userId);
    };
    trigger(); // initial
    const unsub = queryClient.getQueryCache().subscribe((evt) => {
      // Only react to updates of the keys we actually persist.
      const key = evt.query.queryKey?.[0];
      if (key === "shifts" || key === "employers" || key === "prefs") {
        if (evt.type === "updated" && evt.action?.type === "success") trigger();
      }
    });
    return () => unsub();
  }, [queryClient, userId]);

  // Offline → online edge: reconcile tz, refresh data, and tell the user
  // what changed. The reconcile helper handles tz logging + invalidations;
  // we just translate the result into a toast in the coach voice.
  useOnlineTransition(() => {
    void (async () => {
      try {
        const result = await reconcileOnReconnect(queryClient, userId);
        if (result.tzChanged) {
          toast.success("You're back online. I detected a new time zone and rebuilt your recovery plan.");
        } else {
          toast.success("You're back online. Plan refreshed.");
        }
      } catch (e) {
        console.warn("reconcile failed", e);
      }
    })();
  });


  // Travel/tz auto-detect: when prefs.tzAuto is on, keep currentTz in sync
  // with the device's IANA zone. Seeds homeTz on first run so body-clock
  // math has an anchor. Silent — never overwrites a manual override.
  useEffect(() => {
    if (!signedIn) return;
    if (!prefs.tzAuto) return;
    let cancelled = false;
    void (async () => {
      const { detectDeviceTz, normalizeTz } = await import("@/lib/time/tz");
      const device = normalizeTz(detectDeviceTz());
      const patch: Partial<typeof prefs> = {};
      if (!prefs.homeTz) patch.homeTz = device;
      if (prefs.currentTz !== device) patch.currentTz = device;
      const tzChanged = patch.currentTz !== undefined;
      if (cancelled || Object.keys(patch).length === 0) return;
      try {
        const { savePrefs } = await import("@/lib/prefs");
        await savePrefs(patch);
        // Log the jump to tz_events so the pattern detector & jet-lag intent
        // can reason about how long ago the user crossed zones. RLS scopes it.
        if (tzChanged) {
          const { recordTzEvent } = await import("@/lib/trips.functions");
          await recordTzEvent({ data: { toTz: device, source: "device_tz" } }).catch(() => {});
        }
      } catch {
        /* non-fatal: tz will retry next mount */
      }
    })();
    return () => { cancelled = true; };
  }, [signedIn, prefs.tzAuto, prefs.homeTz, prefs.currentTz]);

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

  // Next upcoming shift start as an absolute Date (today + up to 7 days ahead).
  // Feeds the CompanionHero contextual greeting.
  const nextShiftStart = useMemo<Date | null>(() => {
    if (!mounted) return null;
    const nowMs = today.getTime();
    for (let i = 0; i < 8; i += 1) {
      const dt = new Date(today.getFullYear(), today.getMonth(), today.getDate() + i);
      const daily = shiftsForDate(shifts, dt, prefs.cycleAnchor, prefs.cycleWeeks);
      for (const s of daily) {
        const start = new Date(dt.getFullYear(), dt.getMonth(), dt.getDate(), 0, 0, 0, 0);
        start.setMinutes(s.start);
        if (start.getTime() > nowMs) return start;
      }
    }
    return null;
  }, [mounted, today, shifts, prefs.cycleAnchor, prefs.cycleWeeks]);



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


  const hour = mounted ? today.getHours() : 12;
  void hour; // greeting now lives inside <ArrivalHero />
  const dateLabel = mounted ? `${DAYS[weekday]}, ${monthDate}` : "";

  return (
    <main className="relative mx-auto flex w-full min-w-0 max-w-6xl flex-col gap-4 px-5 pt-[max(env(safe-area-inset-top),1rem)] pb-12 [padding-left:max(1.25rem,env(safe-area-inset-left))] [padding-right:max(1.25rem,env(safe-area-inset-right))] lg:px-10 lg:pt-12">
      <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
        <div className="absolute -left-20 top-0 h-[40vh] w-[40vh] rounded-full bg-primary/20 blur-[120px]" />
        <div className="absolute right-0 top-1/3 h-[30vh] w-[30vh] rounded-full bg-sky-500/10 blur-[120px]" />
      </div>

      <CompanionHero
        name={(prefs.preferredName ?? "").trim()}
        now={mounted ? today : new Date(0)}
        dateLabel={dateLabel}
        context={{
          nextShiftStart,
          debtScore: mounted ? debt.score : null,
          recoveryScore: mounted ? stability : null,
          recommendedBedtime: null,
        }}
      />


      <OfflineBanner userId={userId} />
      <CompanionIntroSheet />

      {insights && (
        <HomeCard accent className="!p-0">
          <AIBriefCard insights={insights} recommendations={recommendations} />
        </HomeCard>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <HomeCard className="!p-0">
          <LastNightStrip />
        </HomeCard>
        <HomeCard className="flex flex-col">
          <HomeCardHeader
            eyebrow="Schedule"
            title="Schedule stability"
            action={
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/20 text-indigo-glow">
                <Sparkles className="h-4 w-4" />
              </span>
            }
          />
          <div className="mt-3 flex items-baseline gap-1">
            <span className="text-5xl text-foreground" style={{ fontFamily: "var(--font-display)" }}>
              {mounted ? stability : 0}
            </span>
            <span className="text-sm text-muted-foreground">/ 100</span>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">{rotation.label}</p>
          <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
            <div
              className="h-full rounded-full transition-all duration-1000"
              style={{ width: `${mounted ? stability : 0}%`, background: "var(--gradient-cta)" }}
            />
          </div>
          <p className="mt-3 text-[11px] text-muted-foreground/80">
            Circadian debt: <span className="font-semibold text-foreground">{mounted ? debt.score : 0}/100</span>
          </p>
        </HomeCard>
      </div>

      <HomeCard accent className="!p-0">
        <RightNowCard signedIn={signedIn === true} context={insights?.contextString ?? ""} />
      </HomeCard>

      {insights && (
        <HomeCard className="!p-0">
          <CompanionWhisper
            insights={insights}
            signedIn={signedIn === true}
            context={insights.contextString}
          />
        </HomeCard>
      )}

      <div className="grid grid-cols-1 gap-4">
        <SleepSoundsCard />
      </div>

      <HomeCard accent>
        <HomeCardHeader
          eyebrow="Tonight"
          title={nextSleep ? `Sleep at ${fmt(nextSleep.start)}` : "Log a shift to forecast"}
          action={
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/20 text-indigo-glow">
              <Moon className="h-4 w-4" />
            </span>
          }
        />
        <div className="mt-4 flex items-center justify-between gap-4">
          <div className="flex flex-col gap-1">
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Next sleep</p>
            <p className="text-2xl text-foreground" style={{ fontFamily: "var(--font-display)" }}>
              {nextSleep ? `${prefs.sleepHours}h` : "—"}
            </p>
            <p className="text-[11px] text-muted-foreground/80">{nextSleep ? "predicted window" : "Add a shift to forecast"}</p>
          </div>
          <CircadianRing shift={todayShift} prefs={prefs} mounted={mounted} />
        </div>
      </HomeCard>

      <div id="schedule" className="scroll-mt-20" aria-hidden />
      <HomeCard>
        <HomeCardHeader
          eyebrow="Daily Schedule"
          title="Weekly Rhythm"
          action={
            <span className="text-[10px] italic text-muted-foreground">
              {shifts.length} shift{shifts.length === 1 ? "" : "s"}
            </span>
          }
        />

        <div className="mt-4 grid grid-cols-4 gap-2 sm:grid-cols-8">
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
                    : "border border-white/10 bg-white/5"
                } ${isPast && !isToday ? "opacity-60" : ""}`}
                style={
                  isToday
                    ? { background: "linear-gradient(180deg, var(--indigo) 0%, var(--secondary) 100%)" }
                    : undefined
                }
              >
                <span className="text-[10px] font-bold uppercase tracking-wider text-indigo-glow">{label}</span>
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
        </div>

        {todayShift && (() => {
          const emp = employers.find((e) => e.id === todayShift.employerId);
          return (
            <div className="mt-4 rounded-2xl border border-white/10 bg-white/5 p-4">
              <div className="flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    {emp && <span className="h-2 w-2 rounded-full" style={{ background: emp.color }} />}
                    <p className="text-[10px] font-medium uppercase tracking-widest text-indigo-glow">
                      {emp ? emp.name : "Today's shift"}
                    </p>
                  </div>
                  <p className="mt-1 text-base font-semibold">
                    {fmt(todayShift.start)} – {fmt(todayShift.end)}
                  </p>
                </div>
                <button
                  onClick={() => removeShift(todayShift.id)}
                  aria-label="Remove shift"
                  className="flex h-9 w-9 items-center justify-center rounded-full bg-white/5 text-muted-foreground active:scale-95"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
              <Timeline shift={todayShift} />
            </div>
          );
        })()}

        <button
          onClick={() => { if (signedIn === false) { handleAuthError(new AuthRequiredError("Sign in to save your shifts."), ""); return; } setEditing({ day: weekday, weekIndex: currentWeekIdx }); }}
          className="mt-4 flex h-12 w-full items-center justify-center gap-2 rounded-2xl text-sm font-semibold text-primary-foreground active:scale-[0.99]"
          style={{ background: "var(--gradient-cta)" }}
        >
          <Plus className="h-4 w-4" />
          {todayShift ? "Edit today's shift" : "Log today's shift"}
        </button>
      </HomeCard>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <SleepStreakCard shifts={shifts} now={mounted ? today : new Date()} />
        <HydrationCard />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <HomeCard className="!p-0">
          <DecisionCenterCard signedIn={signedIn === true} />
        </HomeCard>
        {signedIn === true && (
          <HomeCard className="!p-0">
            <AIActivityFeed max={5} />
          </HomeCard>
        )}
      </div>

      {prefs.predictiveEnabled && (
        <HomeCard className="!p-0">
          <PatternAlerts
            signedIn={signedIn === true}
            context={insights?.contextString ?? ""}
            enabled={prefs.predictiveEnabled}
          />
        </HomeCard>
      )}

      {(prefs.tomorrowPreviewEnabled || prefs.dailyReviewEnabled) && prefs.predictiveEnabled && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <HomeCard className="!p-0">
            <TomorrowPreviewCard
              signedIn={signedIn === true}
              context={insights?.contextString ?? ""}
              enabled={prefs.tomorrowPreviewEnabled}
            />
          </HomeCard>
          <HomeCard className="!p-0">
            <DailyReviewCard
              signedIn={signedIn === true}
              context={insights?.contextString ?? ""}
              enabled={prefs.dailyReviewEnabled}
            />
          </HomeCard>
        </div>
      )}

      <HomeCard className="!p-0">
        <LongClock shift={todayShift} prefs={prefs} now={mounted ? today : new Date()} />
      </HomeCard>
      {mounted && <MultiDayPlan shifts={shifts} prefs={prefs} now={today} />}

      <QuickActionsCard />

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
              {employers.map((e) => {
                const isActive = employerId === e.id;
                return (
                  <button
                    key={e.id}
                    type="button"
                    onClick={() => setEmployerId(e.id)}
                    aria-pressed={isActive}
                    className={`flex min-h-9 items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold transition active:scale-95 ${
                      isActive
                        ? "border-transparent text-primary-foreground shadow-[0_0_0_2px_var(--background),0_0_0_3px_currentColor]"
                        : "border-border bg-secondary text-foreground hover:bg-secondary/70"
                    }`}
                    style={isActive ? { background: e.color, color: e.color } : undefined}
                  >
                    <span
                      className={`h-2 w-2 rounded-full ${isActive ? "bg-white/90" : ""}`}
                      style={!isActive ? { background: e.color } : undefined}
                    />
                    <span className={isActive ? "text-primary-foreground" : ""}>{e.name}</span>
                  </button>
                );
              })}
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
