// Smart Alarm Self-Test harness — admin/tester only.
// Schedules a +60s foreground alarm via the production alarm path,
// listens for the global "alarm:fired" event, and reports PASS/FAIL
// with fire latency. Includes a manual checklist for on-device QA.
//
// Safe to remove pre-launch: delete this file and the dispatchEvent
// line in src/lib/alarm/foreground.ts (search "alarm:fired").
import { createFileRoute, useRouter, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { addAlarm, cancelAlarm, stopRinging, listScheduled } from "@/lib/alarm/foreground";
import { loadAlarmPrefs, vibrateSupported, type AlarmAudioPrefs } from "@/lib/alarm/prefs";
import { ALARM_SOUNDS } from "@/lib/alarm/sounds";
import { prepareVoicePlayback } from "@/lib/companion/speak";
import { aiSmartAlarm } from "@/lib/ai-client";

export const Route = createFileRoute("/qa/smart-alarm")({
  head: () => ({
    meta: [
      { title: "Smart Alarm Self-Test — RestPilot AI" },
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
  component: SmartAlarmQAPage,
  errorComponent: ({ error, reset }) => {
    const r = useRouter();
    return (
      <div className="p-6 text-sm">
        <p className="font-medium">QA harness error</p>
        <pre className="mt-2 whitespace-pre-wrap text-xs opacity-80">{String(error)}</pre>
        <button
          className="mt-3 rounded bg-foreground px-3 py-1 text-background"
          onClick={() => { reset(); void r.invalidate(); }}
        >Retry</button>
      </div>
    );
  },
  notFoundComponent: () => <div className="p-6">Not found.</div>,
});

type GateState = "loading" | "allowed" | "denied" | "signed-out";
type RunStatus = "idle" | "armed" | "passed" | "failed" | "cancelled";

// Acceptable window: alarm must fire within 60s ± 5s.
const TARGET_DELAY_MS = 60_000;
const TOLERANCE_MS = 5_000;
const HARD_FAIL_MS = TARGET_DELAY_MS + 15_000;

const CHECKLIST: Array<{ id: string; label: string; hint: string }> = [
  { id: "exact", label: "Exact Time", hint: "Schedule +5 min with no smart adjustment. Verify ring at the exact second." },
  { id: "smart5", label: "Smart Adjustment ±5", hint: "Enable smart ±5. Verify the scheduled time differs from requested by 1–5 min." },
  { id: "smart10", label: "Smart Adjustment ±10", hint: "Same as above with ±10 window." },
  { id: "smart15", label: "Smart Adjustment ±15", hint: "Same as above with ±15 window." },
  { id: "smartFull", label: "Full Smart Mode", hint: "Adaptive (±60). Confirm AI picks a non-zero delta and rings then." },
  { id: "background", label: "Background app", hint: "Arm self-test, swipe to home screen, wait. Alarm should ring." },
  { id: "locked", label: "Locked phone", hint: "Arm self-test, lock phone with side button, wait. Alarm should ring." },
  { id: "refresh", label: "Refresh + reopen", hint: "Create a real Smart Alarm, refresh tab, reopen. Alarm persists and fires." },
];

const CHECKLIST_STORAGE = "restpilot:qa:smart-alarm:checklist";

function SmartAlarmQAPage() {
  const [gate, setGate] = useState<GateState>("loading");
  const [prefs, setPrefs] = useState<AlarmAudioPrefs | null>(null);
  const [status, setStatus] = useState<RunStatus>("idle");
  const [requestedAt, setRequestedAt] = useState<number | null>(null);
  const [scheduledAt, setScheduledAt] = useState<number | null>(null);
  const [firedAt, setFiredAt] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  const [checks, setChecks] = useState<Record<string, boolean>>(() => {
    if (typeof window === "undefined") return {};
    try { return JSON.parse(localStorage.getItem(CHECKLIST_STORAGE) ?? "{}") as Record<string, boolean>; }
    catch { return {}; }
  });
  const alarmIdRef = useRef<string | null>(null);
  const hardFailTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Gate: signed-in + admin or tester
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (cancelled) return;
      if (!user) { setGate("signed-out"); return; }
      const { data } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user.id)
        .in("role", ["admin", "tester"]);
      if (cancelled) return;
      setGate((data?.length ?? 0) > 0 ? "allowed" : "denied");
    })();
    return () => { cancelled = true; };
  }, []);

  // Load prefs on mount and on storage change.
  useEffect(() => {
    setPrefs(loadAlarmPrefs());
    const refresh = () => setPrefs(loadAlarmPrefs());
    window.addEventListener("storage", refresh);
    return () => window.removeEventListener("storage", refresh);
  }, []);

  // Ticking clock for live countdown.
  useEffect(() => {
    if (status !== "armed") return;
    const t = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(t);
  }, [status]);

  // Listen for fire event.
  useEffect(() => {
    function onFired(e: Event) {
      const detail = (e as CustomEvent<{ label?: string; at?: number }>).detail ?? {};
      const at = typeof detail.at === "number" ? detail.at : Date.now();
      if (alarmIdRef.current == null) return; // not our run
      if (hardFailTimerRef.current) { clearTimeout(hardFailTimerRef.current); hardFailTimerRef.current = null; }
      setFiredAt(at);
      const requested = requestedAt;
      if (!requested) { setStatus("failed"); return; }
      const latency = at - requested;
      const drift = Math.abs(latency - TARGET_DELAY_MS);
      setStatus(drift <= TOLERANCE_MS ? "passed" : "failed");
      alarmIdRef.current = null;
    }
    window.addEventListener("alarm:fired", onFired as EventListener);
    return () => window.removeEventListener("alarm:fired", onFired as EventListener);
  }, [requestedAt]);

  // Persist checklist.
  useEffect(() => {
    try { localStorage.setItem(CHECKLIST_STORAGE, JSON.stringify(checks)); } catch { /* noop */ }
  }, [checks]);

  const arm = useCallback(() => {
    prepareVoicePlayback();
    stopRinging();
    if (hardFailTimerRef.current) clearTimeout(hardFailTimerRef.current);
    const id = `__qa_${Date.now()}`;
    alarmIdRef.current = id;
    const reqAt = Date.now();
    const fireAt = reqAt + TARGET_DELAY_MS;
    setRequestedAt(reqAt);
    setScheduledAt(fireAt);
    setFiredAt(null);
    setStatus("armed");
    setNow(reqAt);
    addAlarm({ id, firesAt: fireAt, label: "Self-test alarm" });
    // Hard fail safety net.
    hardFailTimerRef.current = setTimeout(() => {
      if (alarmIdRef.current === id) {
        setStatus("failed");
        alarmIdRef.current = null;
      }
    }, HARD_FAIL_MS);
  }, []);

  const cancel = useCallback(() => {
    if (alarmIdRef.current) cancelAlarm(alarmIdRef.current);
    alarmIdRef.current = null;
    if (hardFailTimerRef.current) { clearTimeout(hardFailTimerRef.current); hardFailTimerRef.current = null; }
    stopRinging();
    setStatus("cancelled");
  }, []);

  const ack = useCallback(() => {
    stopRinging();
  }, []);

  const countdown = useMemo(() => {
    if (!scheduledAt) return null;
    return Math.max(0, scheduledAt - now);
  }, [scheduledAt, now]);

  const latencyText = useMemo(() => {
    if (!firedAt || !requestedAt) return null;
    const ms = firedAt - requestedAt;
    const drift = ms - TARGET_DELAY_MS;
    const sec = (ms / 1000).toFixed(2);
    const driftSec = (drift / 1000).toFixed(2);
    return `${sec}s (drift ${drift >= 0 ? "+" : ""}${driftSec}s)`;
  }, [firedAt, requestedAt]);

  if (gate === "loading") {
    return <Shell><p className="text-sm text-muted-foreground">Checking access…</p></Shell>;
  }
  if (gate === "signed-out") {
    return (
      <Shell>
        <p className="text-sm">Sign in required.</p>
        <Link to="/auth" className="mt-3 inline-block rounded bg-primary px-3 py-1.5 text-sm font-semibold text-primary-foreground">Sign in</Link>
      </Shell>
    );
  }
  if (gate === "denied") {
    return (
      <Shell>
        <p className="text-sm">This page is restricted to admin and tester accounts.</p>
      </Shell>
    );
  }

  const soundLabel = prefs ? (ALARM_SOUNDS.find((s) => s.id === prefs.sound)?.label ?? prefs.sound) : "—";

  return (
    <Shell>
      <header className="space-y-1">
        <p className="text-[11px] font-semibold uppercase tracking-widest text-primary">Smart Alarm</p>
        <h1 className="text-xl font-semibold">Self-Test</h1>
        <p className="text-xs text-muted-foreground">
          Arms a +60 second foreground alarm using the production audio pipeline and current
          settings. PASS if it fires within ±5 s of the scheduled time.
        </p>
      </header>

      <section className="rounded-2xl border border-border bg-background/60 p-4 space-y-3">
        <h2 className="text-xs font-semibold uppercase tracking-wide">Current alarm settings</h2>
        <dl className="grid grid-cols-2 gap-y-1.5 text-xs">
          <dt className="text-muted-foreground">Sound</dt><dd className="text-right">{soundLabel}</dd>
          <dt className="text-muted-foreground">Volume</dt><dd className="text-right">{prefs?.volume ?? "—"}%</dd>
          <dt className="text-muted-foreground">Fade-in</dt><dd className="text-right">{prefs?.fadeInSec ?? 0}s</dd>
          <dt className="text-muted-foreground">Vibrate</dt><dd className="text-right">{prefs?.vibrate ? (vibrateSupported() ? "On" : "On (unsupported)") : "Off"}</dd>
          <dt className="text-muted-foreground">Snooze</dt><dd className="text-right">{prefs?.snoozeMin ?? "—"} min</dd>
        </dl>
      </section>

      <section className="rounded-2xl border border-border bg-background/60 p-4 space-y-3">
        <h2 className="text-xs font-semibold uppercase tracking-wide">Run</h2>
        <dl className="grid grid-cols-2 gap-y-1.5 text-xs">
          <dt className="text-muted-foreground">Requested at</dt>
          <dd className="text-right tabular-nums">{requestedAt ? formatTime(requestedAt) : "—"}</dd>
          <dt className="text-muted-foreground">Scheduled fire</dt>
          <dd className="text-right tabular-nums">{scheduledAt ? formatTime(scheduledAt) : "—"}</dd>
          <dt className="text-muted-foreground">Fired at</dt>
          <dd className="text-right tabular-nums">{firedAt ? formatTime(firedAt) : "—"}</dd>
          <dt className="text-muted-foreground">Latency</dt>
          <dd className="text-right tabular-nums">{latencyText ?? "—"}</dd>
        </dl>

        {status === "armed" && countdown != null && (
          <p className="text-center text-2xl font-bold tabular-nums">
            T-{Math.ceil(countdown / 1000)}s
          </p>
        )}

        <StatusBadge status={status} />

        <div className="flex gap-2">
          {status !== "armed" ? (
            <button
              type="button"
              onClick={arm}
              className="h-11 flex-1 rounded-xl bg-primary text-sm font-semibold text-primary-foreground"
            >
              Arm +60s self-test
            </button>
          ) : (
            <button
              type="button"
              onClick={cancel}
              className="h-11 flex-1 rounded-xl border border-border bg-background text-sm font-semibold"
            >
              Cancel
            </button>
          )}
          <button
            type="button"
            onClick={ack}
            className="h-11 rounded-xl border border-border bg-background px-4 text-sm font-semibold"
          >
            Stop ringing
          </button>
        </div>

        <p className="text-[11px] leading-snug text-muted-foreground">
          Keep this tab in the foreground or installed as a PWA. iOS Safari throttles background
          timers; if the alarm fires late after backgrounding, the FAIL is a platform limit, not a
          regression. Note it in the checklist.
        </p>
      </section>

      <LongHorizonTester />

      <SmartAdjustmentTester />

      <section className="rounded-2xl border border-border bg-background/60 p-4 space-y-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide">Manual checklist</h2>
        <p className="text-[11px] text-muted-foreground">Persists across reloads. Use after the +60s test passes.</p>
        <ul className="mt-2 space-y-1.5">
          {CHECKLIST.map((c) => (
            <li key={c.id} className="rounded-xl border border-border bg-background/60 p-2.5">
              <label className="flex items-start gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={!!checks[c.id]}
                  onChange={(e) => setChecks((prev) => ({ ...prev, [c.id]: e.target.checked }))}
                  className="mt-0.5 h-4 w-4"
                />
                <span className="flex-1">
                  <span className="block font-semibold">{c.label}</span>
                  <span className="block text-[11px] text-muted-foreground">{c.hint}</span>
                </span>
              </label>
            </li>
          ))}
        </ul>
        <button
          type="button"
          onClick={() => setChecks({})}
          className="mt-2 h-9 w-full rounded-xl border border-border bg-background text-xs font-semibold text-muted-foreground"
        >
          Reset checklist
        </button>
      </section>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto w-full max-w-[480px] space-y-4 p-4 pb-24">{children}</div>;
}

type SmartTestRow = {
  windowMin: number;
  label: string;
  status: "pending" | "running" | "pass" | "fail";
  deltaMin?: number;
  reason?: string;
  error?: string;
};

function SmartAdjustmentTester() {
  const [rows, setRows] = useState<SmartTestRow[]>([
    { windowMin: 5, label: "±5", status: "pending" },
    { windowMin: 10, label: "±10", status: "pending" },
    { windowMin: 15, label: "±15", status: "pending" },
    { windowMin: 60, label: "Full ±60", status: "pending" },
  ]);
  const [busy, setBusy] = useState(false);

  async function runAll() {
    setBusy(true);
    const target = new Date(Date.now() + 8 * 3600 * 1000); // +8h
    const targetIso = target.toISOString();
    setRows((prev) => prev.map((r) => ({ ...r, status: "running", deltaMin: undefined, reason: undefined, error: undefined })));
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      try {
        const res = await aiSmartAlarm({ targetWakeIso: targetIso, windowMin: r.windowMin });
        const wake = Date.parse(res.wakeAt);
        const deltaMin = Math.round((wake - target.getTime()) / 60_000);
        const inWindow = Math.abs(deltaMin) <= r.windowMin;
        const moved = Math.abs(deltaMin) >= 1;
        const pass = inWindow && moved;
        setRows((prev) => prev.map((x, idx) =>
          idx === i ? { ...x, status: pass ? "pass" : "fail", deltaMin, reason: res.reason } : x,
        ));
      } catch (e) {
        setRows((prev) => prev.map((x, idx) =>
          idx === i ? { ...x, status: "fail", error: e instanceof Error ? e.message : "request failed" } : x,
        ));
      }
    }
    setBusy(false);
  }

  return (
    <section className="rounded-2xl border border-border bg-background/60 p-4 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="text-xs font-semibold uppercase tracking-wide">Smart Adjustment</h2>
          <p className="text-[11px] text-muted-foreground">
            Calls the real AI endpoint with a target 8h out. PASS = returned wake is ≥1 min
            from target and within the requested window.
          </p>
        </div>
        <button
          type="button"
          onClick={runAll}
          disabled={busy}
          className="h-9 shrink-0 rounded-xl bg-primary px-3 text-xs font-semibold text-primary-foreground disabled:opacity-60"
        >
          {busy ? "Running…" : "Run all"}
        </button>
      </div>
      <ul className="space-y-1.5">
        {rows.map((r) => (
          <li key={r.windowMin} className="rounded-xl border border-border bg-background/60 p-2.5 text-xs">
            <div className="flex items-center justify-between">
              <span className="font-semibold">{r.label}</span>
              <span className={
                r.status === "pass" ? "text-emerald-500 font-semibold" :
                r.status === "fail" ? "text-rose-500 font-semibold" :
                r.status === "running" ? "text-primary" : "text-muted-foreground"
              }>
                {r.status === "pass" ? "PASS" :
                 r.status === "fail" ? "FAIL" :
                 r.status === "running" ? "…" : "—"}
                {r.deltaMin != null && (
                  <span className="ml-2 tabular-nums text-muted-foreground">
                    Δ {r.deltaMin >= 0 ? "+" : ""}{r.deltaMin} min
                  </span>
                )}
              </span>
            </div>
            {r.reason && <p className="mt-1 text-[11px] text-muted-foreground">{r.reason}</p>}
            {r.error && <p className="mt-1 text-[11px] text-rose-500">{r.error}</p>}
          </li>
        ))}
      </ul>
    </section>
  );
}

function StatusBadge({ status }: { status: RunStatus }) {
  const map: Record<RunStatus, { label: string; cls: string }> = {
    idle: { label: "Idle", cls: "bg-muted text-muted-foreground" },
    armed: { label: "Armed", cls: "bg-primary/15 text-primary" },
    passed: { label: "PASS", cls: "bg-emerald-500/15 text-emerald-500" },
    failed: { label: "FAIL", cls: "bg-rose-500/15 text-rose-500" },
    cancelled: { label: "Cancelled", cls: "bg-muted text-muted-foreground" },
  };
  const { label, cls } = map[status];
  return (
    <div className={`mx-auto inline-flex rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-wide ${cls}`}>
      {label}
    </div>
  );
}

function formatTime(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${(d.getMilliseconds()).toString().padStart(3, "0")}`;
}
