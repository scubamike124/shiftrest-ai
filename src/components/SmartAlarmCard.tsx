import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlarmClock, Sparkles, ChevronDown } from "lucide-react";
import { toast } from "sonner";
import { createEvent, deleteEvent, fetchEvents } from "@/lib/events";
import { aiSmartAlarm, type SmartAlarmResponse } from "@/lib/ai-client";
import { ConfidenceBadge, WhyButton } from "./ai/trust";
import { RecommendationActions } from "./ai/trust/RecommendationActions";
import { SafetyNote } from "@/components/legal/SafetyNote";

const CYCLE_LABEL: Record<NonNullable<SmartAlarmResponse["cyclePosition"]>, string> = {
  rem_end: "End of REM cycle",
  light_sleep: "Light sleep phase",
  deep_avoid: "Avoiding deep sleep",
  natural: "Natural wake window",
};

/**
 * SmartAlarmCard — schedule an AI-optimized wake inside a ±window.
 * Stored as a "personal" user_event with title prefix "Alarm:" so the
 * notification scheduler treats it as a critical alarm.
 */
export function SmartAlarmCard({ signedIn }: { signedIn: boolean }) {
  const qc = useQueryClient();
  const tomorrow = useMemo(() => defaultTomorrowWake(), []);
  const [targetLocal, setTargetLocal] = useState(tomorrow);
  const [windowMin, setWindowMin] = useState(30);
  const [busy, setBusy] = useState(false);
  const [lastResult, setLastResult] = useState<{ res: SmartAlarmResponse; targetIso: string } | null>(null);
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
      const res = await aiSmartAlarm({
        targetWakeIso: target.toISOString(),
        windowMin,
      });
      const wake = new Date(res.wakeAt);
      if (isNaN(wake.getTime())) throw new Error("AI returned an invalid time.");
      const labelTime = wake.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
      const notePayload = [
        res.cyclePosition ? CYCLE_LABEL[res.cyclePosition] : null,
        res.confidence ? `${res.confidence} confidence` : null,
        res.reason,
      ]
        .filter(Boolean)
        .join(" · ");
      await createEvent({
        kind: "personal",
        title: `Alarm: ${labelTime}`,
        startsAt: wake.toISOString(),
        reminderMin: 0,
        notes: notePayload,
      });
      qc.invalidateQueries({ queryKey: ["events"] });
      setLastResult({ res, targetIso: target.toISOString() });
      toast.success(`Smart alarm set for ${labelTime}`);
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
    <section className="rounded-2xl border border-border bg-card p-4">
      <header className="flex items-center gap-2">
        <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-primary/15 text-primary">
          <AlarmClock className="h-4 w-4" />
        </span>
        <div>
          <h3 className="text-sm font-semibold">Smart alarm</h3>
          <p className="text-[11px] text-muted-foreground">
            AI picks the lightest sleep moment inside your window.
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
        <div>
          <div className="flex items-center justify-between text-xs font-semibold text-muted-foreground">
            <span>Window</span>
            <span>± {windowMin} min</span>
          </div>
          <input
            type="range"
            min={10}
            max={45}
            step={5}
            value={windowMin}
            onChange={(e) => setWindowMin(Number(e.target.value))}
            className="mt-2 w-full"
          />
        </div>
        <button
          onClick={schedule}
          disabled={busy || !signedIn}
          className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-primary text-sm font-semibold text-primary-foreground disabled:opacity-60"
        >
          <Sparkles className="h-4 w-4" /> {busy ? "Optimizing…" : "Set smart alarm"}
        </button>
      </div>

      {lastResult && wakeLabel && (
        <div className="mt-4 rounded-2xl border border-primary/30 bg-primary/5 p-4">
          <p className="text-[10px] font-semibold uppercase tracking-[0.25em] text-indigo-glow">
            AI chose
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
              sources={["Your wake window", "Sleep-cycle model", "Connected wearable"]}
              expectedOutcome="You'll wake closer to a cycle boundary, lowering grogginess."
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
                Sleep happens in roughly 90-minute cycles. Waking near the end of a cycle — when REM
                naturally tapers — leaves you alert instead of groggy. RestPilot scans your ±{windowMin}
                -min window for the moment most likely to land at a cycle boundary using your wake-up
                time and recent wearable data.
              </p>
            </div>
          )}
          {lastResult.res.recommendationId && (
            <div className="mt-3 border-t border-primary/15 pt-3">
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
          {alarms.map((a) => (
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
              </div>
              <button
                onClick={() => del.mutate(a.id)}
                className="rounded-lg px-2 py-1 text-xs font-semibold text-destructive hover:bg-destructive/10"
              >
                Cancel
              </button>
            </li>
          ))}
        </ul>
      )}
    <div className="mt-3 flex justify-end"><SafetyNote /></div>
    </section>
  );
}

function defaultTomorrowWake(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(7, 0, 0, 0);
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
