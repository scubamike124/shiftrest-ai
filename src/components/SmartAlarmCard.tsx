import { useEffect, useMemo, useState } from "react";
import { SafetyNote } from "@/components/legal/SafetyNote";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlarmClock, Sparkles, ChevronDown, BellRing, Square, Play, Check, Volume2, Vibrate, Settings2 } from "lucide-react";
import { toast } from "sonner";
import { createEvent, deleteEvent, fetchEvents } from "@/lib/events";
import { addAlarm, syncAlarms, stopRinging, testAlarm, previewAlarmSound } from "@/lib/alarm/foreground";
import { ensureAlarmPushEnrollment } from "@/lib/alarm/push-enroll";
import { ALARM_SOUNDS, type AlarmSoundId } from "@/lib/alarm/sounds";
import { loadAlarmPrefs, saveAlarmPrefs, vibrateSupported, type FadeInSec, type SnoozeMin } from "@/lib/alarm/prefs";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger, SheetClose } from "@/components/ui/sheet";

// V1 ships exact-time-only alarms. Supporting AI code (aiSmartAlarm, the
// /api/ai smart-alarm handler, SmartAlarmCoach component) is intentionally
// preserved so a future release can reintroduce adjustment without a rewrite.

const SMART_ALARM_CARD_VERSION = "v2";

/**
 * SmartAlarmCard — schedules exact-time alarms. Stored as a "personal"
 * user_event with title prefix "Alarm:" so the notification scheduler
 * treats it as a critical alarm.
 */
export function SmartAlarmCard({ signedIn }: { signedIn: boolean }) {
  const qc = useQueryClient();
  const tomorrow = useMemo(() => defaultTomorrowWake(), []);
  const [targetLocal, setTargetLocal] = useState(tomorrow);
  const [busy, setBusy] = useState(false);

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
      const labelTime = target.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
      const saved = await createEvent({
        kind: "personal",
        title: `alarm: ${labelTime}`,
        startsAt: target.toISOString(),
        reminderMin: 0,
        notes: "Exact Time · RestPilot will ring at the time you selected.",
      });
      addAlarm({ id: saved.id, firesAt: new Date(saved.startsAt).getTime(), label: labelTime });
      qc.invalidateQueries({ queryKey: ["events"] });
      toast.success(`Alarm set for exactly ${labelTime}`);
      // Best-effort: enroll this device for Web Push so the alarm can wake
      // the phone on the lock screen. Never blocks or errors the schedule.
      void ensureAlarmPushEnrollment({ signedIn });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't schedule alarm.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3" data-smart-alarm-card-version={SMART_ALARM_CARD_VERSION}>
      <span className="sr-only" data-testid="smart-alarm-card-version">SmartAlarmCard {SMART_ALARM_CARD_VERSION}</span>

    <section className="rounded-2xl border border-border bg-card p-4">
      <header className="flex items-center gap-2">
        <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-primary/15 text-primary">
          <AlarmClock className="h-4 w-4" />
        </span>
        <div>
          <h3 className="text-sm font-semibold">Alarm</h3>
          <p className="text-[11px] text-muted-foreground">
            Rings at the exact time you select.
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
        <button
          onClick={schedule}
          disabled={busy || !signedIn}
          className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-primary text-sm font-semibold text-primary-foreground disabled:opacity-60"
        >
          <Sparkles className="h-4 w-4" /> {busy ? "Setting…" : "Set alarm"}
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
