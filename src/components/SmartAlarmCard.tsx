import { useEffect, useMemo, useState } from "react";
import { SafetyNote } from "@/components/legal/SafetyNote";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlarmClock, Sparkles, ChevronDown, BellRing, Square, Play, Check, Volume2, Vibrate, Settings2 } from "lucide-react";
import { toast } from "sonner";
import { createEvent, deleteEvent, fetchEvents } from "@/lib/events";
import { aiSmartAlarm, type SmartAlarmResponse } from "@/lib/ai-client";
import { ConfidenceBadge, WhyButton } from "./ai/trust";
import { RecommendationActions } from "./ai/trust/RecommendationActions";
import { addAlarm, syncAlarms, stopRinging, testAlarm, previewAlarmSound } from "@/lib/alarm/foreground";
import { ALARM_SOUNDS, type AlarmSoundId } from "@/lib/alarm/sounds";
import { loadAlarmPrefs, saveAlarmPrefs, vibrateSupported, type FadeInSec, type SnoozeMin } from "@/lib/alarm/prefs";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger, SheetClose } from "@/components/ui/sheet";
import { SmartAlarmCoach } from "./SmartAlarmCoach";

type AdjustmentMode = "exact" | "smart";

const ADAPTIVE_WINDOW_MIN = 60;
const PREFS_KEY = "restpilot:smart-alarm:prefs";

const ADJUSTMENT_OPTIONS = [
  { value: 5, label: "5 min" },
  { value: 10, label: "10 min" },
  { value: 15, label: "15 min" },
  { value: 20, label: "20 min" },
  { value: 30, label: "30 min" },
  { value: ADAPTIVE_WINDOW_MIN, label: "Full" },
] as const;

const SMART_ALARM_CARD_VERSION = "v2";


type AdjustmentValue = (typeof ADJUSTMENT_OPTIONS)[number]["value"];


const CYCLE_LABEL: Record<NonNullable<SmartAlarmResponse["cyclePosition"]>, string> = {
  rem_end: "End of REM cycle",
  light_sleep: "Light sleep phase",
  deep_avoid: "Avoiding deep sleep",
  natural: "Natural wake window",
};

/**
 * SmartAlarmCard — schedules exact-time alarms by default. AI adjustment is
 * opt-in only, with an explicit maximum movement selected by the user.
 * Stored as a "personal" user_event with title prefix "Alarm:" so the
 * notification scheduler treats it as a critical alarm.
 */
export function SmartAlarmCard({ signedIn }: { signedIn: boolean }) {
  const qc = useQueryClient();
  const tomorrow = useMemo(() => defaultTomorrowWake(), []);
  const [targetLocal, setTargetLocal] = useState(tomorrow);
  const [adjustmentMode, setAdjustmentMode] = useState<AdjustmentMode>("exact");
  const [maxAdjustmentMin, setMaxAdjustmentMin] = useState<AdjustmentValue>(5);

  // Rehydrate the user's last Smart Alarm picker preference (local-only).
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(PREFS_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as { adjustmentMode?: AdjustmentMode; maxAdjustmentMin?: number };
      if (parsed.adjustmentMode === "exact" || parsed.adjustmentMode === "smart") {
        setAdjustmentMode(parsed.adjustmentMode);
      }
      const allowed = ADJUSTMENT_OPTIONS.map((o) => o.value);
      if (typeof parsed.maxAdjustmentMin === "number" && allowed.includes(parsed.maxAdjustmentMin as AdjustmentValue)) {
        setMaxAdjustmentMin(parsed.maxAdjustmentMin as AdjustmentValue);
      }
    } catch {}
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(PREFS_KEY, JSON.stringify({ adjustmentMode, maxAdjustmentMin }));
    } catch {}
  }, [adjustmentMode, maxAdjustmentMin]);

  const [busy, setBusy] = useState(false);
  const [lastResult, setLastResult] = useState<{
    res: SmartAlarmResponse;
    targetIso: string;
    adjusted: boolean;
    maxAdjustmentMin: number;
  } | null>(null);
  const [expanded, setExpanded] = useState(false);

  const { data: events = [] } = useQuery({
    queryKey: ["events", "alarms"],
    queryFn: () =>
      fetchEvents({
        fromIso: new Date().toISOString(),
        untilIso: new Date(Date.now() + 7 * 86_400_000).toISOString(),
      }),
    enabled: signedIn,
  });

  const alarms = useMemo(
    () => events.filter((e) => e.kind === "personal" && /^alarm:/i.test(e.title)),
    [events],
  );

  // Foreground fallback: while the tab is open, ring locally when each
  // upcoming alarm hits. Re-syncs whenever the alarm list changes.
  useEffect(() => {
    syncAlarms(
      alarms.map((a) => ({
        id: a.id,
        firesAt: new Date(a.startsAt).getTime(),
        label: a.title.replace(/^alarm:\s*/i, ""),
      })),
    );
  }, [alarms]);

  // Refresh the alarm list when any surface (Companion, Pilot) creates or
  // deletes an alarm so the user sees it appear immediately without a reload.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onChanged = () => qc.invalidateQueries({ queryKey: ["events"] });
    window.addEventListener("companion:alarms-changed", onChanged);
    return () => window.removeEventListener("companion:alarms-changed", onChanged);
  }, [qc]);

  const notifGranted =
    typeof window !== "undefined" &&
    "Notification" in window &&
    Notification.permission === "granted";

  const del = useMutation({
    mutationFn: (id: string) => deleteEvent(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["events"] }),
  });

  async function schedule() {
    if (!signedIn) {
      toast.error("Sign in to schedule a smart alarm.");
      return;
    }
    setBusy(true);
    try {
      const target = new Date(targetLocal);
      if (isNaN(target.getTime()) || target.getTime() < Date.now()) {
        toast.error("Pick a future wake time.");
        return;
      }
      const exactLabel = target.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
      const isSmart = adjustmentMode === "smart";
      const isAdaptive = isSmart && maxAdjustmentMin === ADAPTIVE_WINDOW_MIN;
      const canAdjust = isSmart; // all valid options now move the alarm
      let res: SmartAlarmResponse;
      if (canAdjust) {
        res = await aiSmartAlarm({
          targetWakeIso: target.toISOString(),
          windowMin: isAdaptive ? ADAPTIVE_WINDOW_MIN : maxAdjustmentMin,
        });
      } else {
        res = {
          wakeAt: target.toISOString(),
          reason: "Exact Time is on, so RestPilot will ring at the time you selected.",
          cyclePosition: "natural",
          confidence: "high",
          confidenceReason: "No smart adjustment was permitted for this alarm.",
          message: `Your ${exactLabel} alarm is ringing.`,
          recommendationId: null,
        };
      }
      let wake = new Date(res.wakeAt);
      if (isNaN(wake.getTime())) throw new Error("AI returned an invalid time.");
      if (canAdjust) {
        const cap = isAdaptive ? ADAPTIVE_WINDOW_MIN : maxAdjustmentMin;
        const delta = Math.abs(wake.getTime() - target.getTime());
        if (delta > cap * 60_000 + 999) {
          wake = target;
          res = {
            ...res,
            wakeAt: target.toISOString(),
            reason: `Smart Adjustment stayed at your selected time because the AI result exceeded your ${cap}-minute limit.`,
          };
        }
      }
      const labelTime = wake.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
      const notePayload = [
        isAdaptive
          ? "Full Smart Mode (Adaptive)"
          : canAdjust
          ? `Smart Adjustment up to ${maxAdjustmentMin} min`
          : "Exact Time",
        res.cyclePosition ? CYCLE_LABEL[res.cyclePosition] : null,
        res.confidence ? `${res.confidence} confidence` : null,
        res.reason,
      ]
        .filter(Boolean)
        .join(" · ");
      const saved = await createEvent({
        kind: "personal",
        title: `Alarm: ${labelTime}`,
        startsAt: wake.toISOString(),
        reminderMin: 0,
        notes: notePayload,
      });
      addAlarm({ id: saved.id, firesAt: new Date(saved.startsAt).getTime(), label: labelTime });
      qc.invalidateQueries({ queryKey: ["events"] });
      setLastResult({
        res,
        targetIso: target.toISOString(),
        adjusted: canAdjust,
        maxAdjustmentMin: isAdaptive ? ADAPTIVE_WINDOW_MIN : maxAdjustmentMin,
      });
      toast.success(
        canAdjust
          ? `Smart alarm set for ${labelTime}${isAdaptive ? " (Adaptive)" : ""}`
          : `Alarm set for exactly ${labelTime}`,
      );

    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't schedule alarm.");
    } finally {
      setBusy(false);
    }
  }

  const wakeTime = lastResult ? new Date(lastResult.res.wakeAt) : null;
  const wakeLabel = wakeTime
    ? wakeTime.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : null;
  const deltaMin = lastResult && wakeTime
    ? Math.round((wakeTime.getTime() - new Date(lastResult.targetIso).getTime()) / 60_000)
    : null;

  return (
    <div className="space-y-3" data-smart-alarm-card-version={SMART_ALARM_CARD_VERSION}>
      <span className="sr-only" data-testid="smart-alarm-card-version">SmartAlarmCard {SMART_ALARM_CARD_VERSION}</span>

    <SmartAlarmCoach />
    <section className="rounded-2xl border border-border bg-card p-4">
      <header className="flex items-center gap-2">
        <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-primary/15 text-primary">
          <AlarmClock className="h-4 w-4" />
        </span>
        <div>
          <h3 className="text-sm font-semibold">Smart alarm</h3>
          <p className="text-[11px] text-muted-foreground">
            Rings at your exact time unless you allow adjustment.
          </p>
        </div>
      </header>

      <div className="mt-3 grid gap-3">
        <label className="block text-xs font-semibold text-muted-foreground">
          Target wake
          <input
            type="datetime-local"
            value={targetLocal}
            onChange={(e) => setTargetLocal(e.target.value)}
            className="mt-1 h-11 w-full rounded-xl border border-border bg-background px-3 text-sm"
          />
        </label>
        <div className="grid grid-cols-2 gap-2" aria-label="Alarm timing mode">
          <button
            type="button"
            onClick={() => setAdjustmentMode("exact")}
            className={`rounded-xl border px-3 py-2 text-left text-xs font-semibold ${
              adjustmentMode === "exact"
                ? "border-primary bg-primary/15 text-primary"
                : "border-border bg-background text-muted-foreground"
            }`}
            aria-pressed={adjustmentMode === "exact"}
          >
            Exact Time
            <span className="mt-0.5 block text-[10px] font-normal text-muted-foreground">Default</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setAdjustmentMode("smart");
            }}
            className={`rounded-xl border px-3 py-2 text-left text-xs font-semibold ${
              adjustmentMode === "smart"
                ? "border-primary bg-primary/15 text-primary"
                : "border-border bg-background text-muted-foreground"
            }`}
            aria-pressed={adjustmentMode === "smart"}
          >
            Smart Adjustment
            <span className="mt-0.5 block text-[10px] font-normal text-muted-foreground">Optional</span>
          </button>
        </div>
        {adjustmentMode === "smart" && (
          <div>
            <p className="mb-1 text-xs font-semibold text-muted-foreground">Adjustment window (earlier or later)</p>
            <div className="grid grid-cols-5 gap-1.5" role="radiogroup" aria-label="Adjustment window">
              {ADJUSTMENT_OPTIONS.map((opt) => {
                const selected = maxAdjustmentMin === opt.value;
                const isFull = opt.value === ADAPTIVE_WINDOW_MIN;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    aria-label={isFull ? "Full smart window" : `Up to ${opt.value} minutes earlier or later`}
                    onClick={() => setMaxAdjustmentMin(opt.value as AdjustmentValue)}
                    className={`flex h-11 flex-col items-center justify-center rounded-xl border text-[11px] font-semibold leading-tight ${
                      selected
                        ? "border-primary bg-primary/15 text-primary"
                        : "border-border bg-background text-muted-foreground"
                    }`}
                  >
                    <span>{isFull ? "Full" : `${opt.value} min`}</span>
                    {!isFull && <span className="text-[9px] font-normal opacity-80">± earlier/later</span>}
                  </button>
                );
              })}
            </div>
          </div>
        )}
        <div className="rounded-xl border border-border bg-background/60 px-3 py-2 text-[11px] leading-snug text-muted-foreground">
          {adjustmentMode === "exact"
            ? "RestPilot will ring at the exact time you selected."
            : maxAdjustmentMin === ADAPTIVE_WINDOW_MIN
            ? `Full Smart Mode — AI may move your alarm by up to ~${ADAPTIVE_WINDOW_MIN} minutes to find the optimal wake moment in your sleep cycle.`
            : `AI may move your alarm by up to ${maxAdjustmentMin} minutes earlier or later to land on a better sleep moment.`}
        </div>
        <button
          onClick={schedule}
          disabled={busy || !signedIn}
          className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-primary text-sm font-semibold text-primary-foreground disabled:opacity-60"
        >
          <Sparkles className="h-4 w-4" />{" "}
          {busy
            ? "Setting…"
            : adjustmentMode === "smart"
              ? maxAdjustmentMin === ADAPTIVE_WINDOW_MIN
                ? "Set adaptive alarm"
                : "Set smart alarm"
              : "Set exact alarm"}
        </button>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              testAlarm(10);
              toast.message("Test alarm in 10s", { description: "Keep this tab open." });
            }}
            className="flex h-10 flex-1 items-center justify-center gap-1.5 rounded-xl border border-border bg-background text-xs font-semibold"
          >
            <BellRing className="h-3.5 w-3.5" /> Test 10s
          </button>
          <button
            type="button"
            onClick={stopRinging}
            className="flex h-10 items-center justify-center gap-1.5 rounded-xl border border-border bg-background px-3 text-xs font-semibold"
            aria-label="Stop ringing"
          >
            <Square className="h-3.5 w-3.5" /> Stop
          </button>
          <Sheet>
            <SheetTrigger asChild>
              <button
                type="button"
                className="flex h-10 items-center justify-center gap-1.5 rounded-xl border border-border bg-background px-3 text-xs font-semibold"
                aria-label="Alarm settings"
              >
                <Settings2 className="h-3.5 w-3.5" /> Settings
              </button>
            </SheetTrigger>
            <SheetContent side="bottom" className="max-h-[85vh] overflow-y-auto rounded-t-2xl">
              <SheetHeader className="text-left">
                <SheetTitle>Alarm settings</SheetTitle>
              </SheetHeader>
              <div className="mt-3">
                <AlarmAudioSettings />
              </div>
              <SheetClose asChild>
                <button
                  type="button"
                  className="mt-4 h-11 w-full rounded-xl bg-primary text-sm font-semibold text-primary-foreground"
                >
                  Done
                </button>
              </SheetClose>
            </SheetContent>
          </Sheet>
        </div>
      </div>

      {lastResult && wakeLabel && (
        <div className="mt-4 rounded-2xl border border-primary/30 bg-primary/5 p-4">
          <p className="text-[10px] font-semibold uppercase tracking-[0.25em] text-indigo-glow">
            {lastResult.adjusted ? (lastResult.maxAdjustmentMin === ADAPTIVE_WINDOW_MIN ? "AI chose (Adaptive)" : "AI chose") : "Exact time"}
          </p>
          <p className="mt-1 text-3xl font-semibold" style={{ fontFamily: "var(--font-display)" }}>
            {wakeLabel}
          </p>
          <p className="mt-1 text-xs leading-snug text-foreground/90">
            {deltaMin && deltaMin !== 0
              ? `Moved ${Math.abs(deltaMin)} min ${deltaMin > 0 ? "later" : "earlier"} — `
              : ""}
            {lastResult.res.reason}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {lastResult.res.cyclePosition && (
              <span className="rounded-full bg-secondary px-2 py-0.5 text-[10px] font-semibold">
                {CYCLE_LABEL[lastResult.res.cyclePosition]}
              </span>
            )}
            {lastResult.res.confidence && (
              <ConfidenceBadge value={lastResult.res.confidence} />
            )}
            <button
              onClick={() => setExpanded((v) => !v)}
              className="inline-flex items-center gap-1 text-[11px] font-semibold text-indigo-glow hover:underline"
            >
              How it's picked <ChevronDown className={`h-3 w-3 transition ${expanded ? "rotate-180" : ""}`} />
            </button>
            <WhyButton
              variant="inline"
              label="Why this time?"
              headline={`Wake at ${wakeLabel}`}
              why={lastResult.res.reason}
              confidence={lastResult.res.confidence}
              sources={lastResult.adjusted ? ["Your allowed adjustment", "Sleep-cycle model", "Connected wearable"] : ["Your selected wake time", "Exact Time setting"]}
              expectedOutcome={lastResult.adjusted ? "You'll wake closer to a cycle boundary while staying inside your chosen limit." : "You'll wake at the time you explicitly selected."}
            />
          </div>
          {expanded && (
            <div className="mt-2 space-y-2">
              {lastResult.res.confidenceReason && (
                <p className="rounded-lg border border-primary/20 bg-background/60 p-2 text-[11px] leading-snug text-foreground/90">
                  <span className="font-semibold text-indigo-glow">Confidence: </span>
                  {lastResult.res.confidenceReason}
                </p>
              )}
              <p className="rounded-lg bg-background/60 p-2 text-[11px] leading-snug text-muted-foreground">
                {lastResult.adjusted
                  ? `Sleep happens in roughly 90-minute cycles. RestPilot scanned only the ${lastResult.maxAdjustmentMin}-minute limit you allowed and will never move the alarm outside that permission.`
                  : "Exact Time is the default. RestPilot did not optimize, nudge, or move this alarm."}
              </p>
            </div>
          )}
          {lastResult.res.recommendationId && (
            <div className="mt-3 border-t border-primary/15 pt-3">
              <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                Feedback on this suggestion
              </p>
              <RecommendationActions
                recommendationId={lastResult.res.recommendationId}
                signedIn={signedIn}
              />
            </div>
          )}
        </div>
      )}

      {alarms.length > 0 && (
        <ul className="mt-4 space-y-2 border-t border-border pt-3">
          {alarms.map((a) => {
            const ms = new Date(a.startsAt).getTime() - Date.now();
            const hours = ms / 3_600_000;
            const longHorizon = hours > 6;
            const status =
              ms <= 0
                ? "Past"
                : longHorizon && !notifGranted
                ? `Rings in ~${Math.round(hours)}h — keep app open or enable notifications`
                : longHorizon
                ? `Rings in ~${Math.round(hours)}h — background notification ready`
                : "Will ring in this tab";
            return (
              <li key={a.id} className="flex items-center justify-between gap-3 rounded-xl bg-secondary/60 p-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{a.title}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {new Date(a.startsAt).toLocaleString([], {
                      weekday: "short",
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                    {a.notes ? ` · ${a.notes}` : ""}
                  </p>
                  <p className="mt-0.5 text-[10px] font-semibold uppercase tracking-wide text-indigo-glow">
                    {status}
                  </p>
                </div>
                <button
                  onClick={() => del.mutate(a.id)}
                  className="rounded-lg px-2 py-1 text-xs font-semibold text-destructive hover:bg-destructive/10"
                >
                  Cancel
                </button>
              </li>
            );
          })}
        </ul>
      )}
    <div className="mt-3 flex justify-end"><SafetyNote /></div>
    </section>
    <p className="px-1 text-[11px] leading-snug text-muted-foreground">
      Foreground alarms ring while RestPilot is open. Background alarms on iPhone require
      Home Screen installation and notification permission. Due to Apple platform limits,
      web alarms may not be as reliable as the native Clock app — RestPilot uses the best
      capabilities currently available on iPhone web apps.
    </p>
    </div>
  );
}

function defaultTomorrowWake(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(7, 0, 0, 0);
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// ─────────────────────────────────────────────────────────────────────
// Alarm audio settings: sound picker, volume slider, fade-in, vibrate, snooze.
// All preferences persist to localStorage and feed the foreground alarm path.
// ─────────────────────────────────────────────────────────────────────
function AlarmAudioSettings() {
  const [prefs, setPrefs] = useState(() => loadAlarmPrefs());
  const [previewing, setPreviewing] = useState<AlarmSoundId | null>(null);
  const [stopPreview, setStopPreview] = useState<(() => void) | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => () => { if (stopPreview) stopPreview(); }, [stopPreview]);

  function update<K extends keyof typeof prefs>(key: K, value: (typeof prefs)[K]) {
    const next = saveAlarmPrefs({ [key]: value } as Partial<typeof prefs>);
    setPrefs(next);
  }

  function preview(id: AlarmSoundId) {
    if (stopPreview) { stopPreview(); }
    if (previewing === id) {
      setPreviewing(null);
      setStopPreview(null);
      return;
    }
    const stop = previewAlarmSound(id, prefs.volume);
    setPreviewing(id);
    setStopPreview(() => () => { stop(); setPreviewing(null); });
    // Auto-clear after preview ends
    setTimeout(() => setPreviewing((curr) => (curr === id ? null : curr)), 6200);
  }

  return (
    <div className="mt-2 space-y-3 rounded-2xl border border-border bg-background/40 p-3">
      <header className="flex items-center gap-2">
        <Volume2 className="h-4 w-4 text-primary" />
        <h4 className="text-xs font-semibold uppercase tracking-wide">Alarm sound &amp; volume</h4>
      </header>

      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-[11px] text-muted-foreground">
          <span>Volume</span>
          <span className="font-semibold tabular-nums text-foreground">{prefs.volume}%</span>
        </div>
        <Slider
          value={[prefs.volume]}
          min={0}
          max={100}
          step={1}
          onValueChange={(v) => update("volume", v[0] ?? prefs.volume)}
        />
      </div>

      <div className="space-y-1.5">
        <p className="text-[11px] font-semibold text-muted-foreground">Sound</p>
        <ul className="grid gap-1.5">
          {ALARM_SOUNDS.map((s) => {
            const selected = prefs.sound === s.id;
            const isPreviewing = previewing === s.id;
            return (
              <li
                key={s.id}
                className={`flex items-center gap-2 rounded-xl border px-2.5 py-2 text-sm transition ${
                  selected ? "border-primary bg-primary/10" : "border-border bg-background/60"
                }`}
              >
                <button
                  type="button"
                  onClick={() => update("sound", s.id)}
                  className="flex min-w-0 flex-1 items-center gap-2 text-left"
                  aria-pressed={selected}
                >
                  <span className="text-base">{s.emoji}</span>
                  <span className="min-w-0">
                    <span className="block truncate text-xs font-semibold">{s.label}</span>
                    <span className="block truncate text-[10px] text-muted-foreground">{s.description}</span>
                  </span>
                </button>
                {selected && <Check className="h-3.5 w-3.5 shrink-0 text-primary" />}
                <button
                  type="button"
                  onClick={() => preview(s.id)}
                  className="ml-auto flex h-7 shrink-0 items-center gap-1 rounded-lg border border-border bg-background px-2 text-[10px] font-semibold"
                  aria-label={isPreviewing ? `Stop preview of ${s.label}` : `Preview ${s.label}`}
                >
                  {isPreviewing ? <Square className="h-3 w-3" /> : <Play className="h-3 w-3" />}
                  {isPreviewing ? "Stop" : "Preview"}
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between rounded-xl border border-border bg-background/60 px-3 py-2 text-[11px] font-semibold"
      >
        Advanced
        <ChevronDown className={`h-3 w-3 transition ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="space-y-3">
          <div>
            <p className="text-[11px] font-semibold text-muted-foreground">Fade-in</p>
            <div className="mt-1 grid grid-cols-4 gap-1.5">
              {([0, 15, 30, 60] as FadeInSec[]).map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => update("fadeInSec", v)}
                  className={`h-9 rounded-lg border text-[11px] font-semibold ${
                    prefs.fadeInSec === v
                      ? "border-primary bg-primary/15 text-primary"
                      : "border-border bg-background text-muted-foreground"
                  }`}
                >
                  {v === 0 ? "Off" : `${v}s`}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-between rounded-xl border border-border bg-background/60 px-3 py-2">
            <div className="flex items-center gap-2 text-xs font-semibold">
              <Vibrate className="h-3.5 w-3.5 text-primary" />
              Vibrate
              {!vibrateSupported() && (
                <span className="text-[10px] font-normal text-muted-foreground">(not supported)</span>
              )}
            </div>
            <Switch
              checked={prefs.vibrate && vibrateSupported()}
              disabled={!vibrateSupported()}
              onCheckedChange={(c) => update("vibrate", c)}
            />
          </div>

          <div>
            <p className="text-[11px] font-semibold text-muted-foreground">Snooze length</p>
            <div className="mt-1 grid grid-cols-4 gap-1.5">
              {([5, 9, 10, 15] as SnoozeMin[]).map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => update("snoozeMin", v)}
                  className={`h-9 rounded-lg border text-[11px] font-semibold ${
                    prefs.snoozeMin === v
                      ? "border-primary bg-primary/15 text-primary"
                      : "border-border bg-background text-muted-foreground"
                  }`}
                >
                  {v} min
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
