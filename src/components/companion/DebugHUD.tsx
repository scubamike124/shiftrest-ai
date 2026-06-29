// On-device Companion pipeline HUD. Visible only with ?debug=1 or
// localStorage.companion_debug=1, or after Ctrl/Cmd+Shift+D.
//
// Read-only mirror of the live voice/AI/TTS state so the user can screenshot
// from their phone and tell us exactly where the loop stops.

import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  BUILD_STAMP,
  getLastHttpStatus,
  installDebugNetworkProbe,
  isDebugEnabled,
  onDebug,
  onHttpStatus,
  setDebugEnabled,
  type DebugStep,
} from "@/lib/companion/debug-bus";

export type DebugHUDProps = {
  signedIn: boolean | null;
  companionOn?: boolean;
  prefsLoaded?: boolean;
  micState?: string;
  voiceStatus?: string;
  orbState?: string;
  greetShown?: boolean;
  companionMode?: string;
  onReset?: () => void;
};


type StepRow = { step: DebugStep; at: number; info?: string };

export function DebugHUD(props: DebugHUDProps) {
  const [enabled, setEnabled] = useState<boolean>(() => isDebugEnabled());
  const [audioLevel, setAudioLevel] = useState(0);
  const [permission, setPermission] = useState<string>("unknown");
  const [steps, setSteps] = useState<StepRow[]>([]);
  const [ttsCtx, setTtsCtx] = useState<string>("?");
  // QA-pass additions
  const [fps, setFps] = useState(0);
  const [heap, setHeap] = useState<string>("—");
  const [viseme, setViseme] = useState<string>("REST");
  const [emotion, setEmotion] = useState<string>("—");
  const [acState, setAcState] = useState<string>("—");
  const [micTrack, setMicTrack] = useState<string>("—");
  const [auth, setAuth] = useState<{ hasSession: boolean; hasToken: boolean; userId: string | null; source: string }>(
    { hasSession: false, hasToken: false, userId: null, source: "—" },
  );
  const [http, setHttp] = useState<{ endpoint: string; status: number } | null>(() => {
    const last = getLastHttpStatus();
    return last ? { endpoint: last.endpoint, status: last.status } : null;
  });
  const lastTapRef = useRef<number>(0);
  const [, force] = useState(0);


  // Toggle with Cmd/Ctrl+Shift+D
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === "D" || e.key === "d")) {
        e.preventDefault();
        const next = !isDebugEnabled();
        setDebugEnabled(next);
        setEnabled(next);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!enabled) return;
    installDebugNetworkProbe();
  }, [enabled]);

  // Local auth snapshot. This makes the HUD useful before the first protected
  // server call has a chance to run the bearer attacher.
  useEffect(() => {
    if (!enabled) return;
    let mounted = true;
    const update = (session: { access_token?: string; user?: { id?: string } } | null | undefined, source = "session-local") => {
      if (!mounted) return;
      setAuth({
        hasSession: Boolean(session?.user?.id),
        hasToken: Boolean(session?.access_token),
        userId: session?.user?.id ?? null,
        source,
      });
    };
    supabase.auth.getSession().then(({ data }) => update(data.session, "session-local"));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => update(session, "auth-event"));
    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, [enabled]);

  // Audio level meter
  useEffect(() => {
    if (!enabled) return;
    const onLvl = (e: Event) => {
      const rms = (e as CustomEvent<{ rms: number }>).detail?.rms ?? 0;
      setAudioLevel(rms);
    };
    window.addEventListener("companion:audio-level", onLvl as EventListener);
    return () => window.removeEventListener("companion:audio-level", onLvl as EventListener);
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    const last = getLastHttpStatus();
    if (last) setHttp({ endpoint: last.endpoint, status: last.status });
    return onHttpStatus((p) => setHttp({ endpoint: p.endpoint, status: p.status }));
  }, [enabled]);

  // Auth status from the hardened bearer attacher
  useEffect(() => {
    if (!enabled) return;
    const onAuth = (e: Event) => {
      const d = (e as CustomEvent<{ hasSession: boolean; hasToken: boolean; userId: string | null; source: string }>).detail;
      if (d) setAuth(d);
    };
    window.addEventListener("companion:auth-status", onAuth as EventListener);
    return () => window.removeEventListener("companion:auth-status", onAuth as EventListener);
  }, [enabled]);

  // Pipeline step log
  useEffect(() => {
    if (!enabled) return;
    return onDebug((p) => {
      if (p.step === "tap") lastTapRef.current = p.at;
      setSteps((cur) => {
        const next = [...cur, p];
        return next.length > 12 ? next.slice(-12) : next;
      });
    });
  }, [enabled]);

  // Tick the "lastTap" elapsed display
  useEffect(() => {
    if (!enabled) return;
    const id = window.setInterval(() => force((n) => n + 1), 500);
    return () => window.clearInterval(id);
  }, [enabled]);

  // Best-effort mic permission probe
  useEffect(() => {
    if (!enabled) return;
    try {
      const perms = (navigator as Navigator & { permissions?: { query: (q: { name: PermissionName }) => Promise<PermissionStatus> } }).permissions;
      perms
        ?.query({ name: "microphone" as PermissionName })
        .then((p) => {
          setPermission(p.state);
          p.onchange = () => setPermission(p.state);
        })
        .catch(() => setPermission("unsupported"));
    } catch {
      setPermission("unsupported");
    }
  }, [enabled]);

  // Best-effort AudioContext state probe
  useEffect(() => {
    if (!enabled) return;
    const id = window.setInterval(() => {
      try {
        // Probe by reading whether any AudioContext has run.
        // We can't get the singleton from speak.ts without exporting it,
        // so we approximate with a tiny ephemeral check.
        const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!AC) { setTtsCtx("no-AC"); return; }
        // Just report "ok" — we don't want to allocate contexts here.
        setTtsCtx("ok");
      } catch { setTtsCtx("err"); }
    }, 2000);
    return () => window.clearInterval(id);
  }, [enabled]);

  if (!enabled) return null;

  const lastTapAgo = lastTapRef.current ? `${Math.round((Date.now() - lastTapRef.current) / 100) / 10}s` : "—";

  const row = (k: string, v: string | number | boolean | null) => (
    <div className="flex justify-between gap-2">
      <span className="text-[10px] uppercase tracking-wider text-white/50">{k}</span>
      <span className="text-[11px] font-mono text-white/95 truncate max-w-[55%] text-right">{String(v)}</span>
    </div>
  );

  return (
    <div
      className="fixed left-2 bottom-2 z-[9999] w-[260px] rounded-lg border border-white/15 bg-black/80 p-2 text-[11px] text-white shadow-2xl backdrop-blur"
      style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}
      aria-label="Companion debug HUD"
    >
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-[0.2em] text-emerald-300">Nova · debug</span>
        <button
          type="button"
          onClick={() => { setDebugEnabled(false); setEnabled(false); }}
          className="rounded px-1.5 py-0.5 text-[10px] text-white/70 hover:bg-white/10"
        >hide</button>
      </div>

      <div className="mb-1 rounded bg-white/5 px-1.5 py-1 text-[10px] text-amber-200">
        build {BUILD_STAMP}
      </div>

      <div className="space-y-0.5">
        {row("Authenticated", auth.hasSession ? "YES" : "NO")}
        {row("User Session", auth.hasSession ? "Present" : "Missing")}
        {row("Auth Header", auth.hasToken ? `Attached (${auth.source})` : "Missing")}
        {row("userId", auth.userId ? `${auth.userId.slice(0, 8)}…` : "—")}
        {row("Last failing endpoint", http?.endpoint ?? "—")}
        {row("Last HTTP status", http?.status ?? "—")}
        {row("signedIn", props.signedIn ?? "—")}
        {row("companionOn", props.companionOn ?? "—")}
        {row("prefsLoaded", props.prefsLoaded ?? "—")}
        {row("micPerm", permission)}
        {row("micState", props.micState ?? "—")}
        {row("voiceStatus", props.voiceStatus ?? "—")}
        {row("orbState", props.orbState ?? "—")}
        {row("audioLevel", audioLevel.toFixed(2))}
        {row("ttsCtx", ttsCtx)}
        {row("greetShown", props.greetShown ?? "—")}
        {row("lastTap", lastTapAgo)}
      </div>

      <div className="mt-2 max-h-[140px] overflow-y-auto rounded bg-white/5 p-1">
        {steps.length === 0 ? (
          <div className="text-[10px] text-white/40">no events yet — tap Nova</div>
        ) : (
          steps.map((s, i) => (
            <div key={i} className="flex justify-between gap-2 text-[10px]">
              <span className="text-emerald-200">{s.step}</span>
              {s.info && <span className="truncate text-white/60">{s.info}</span>}
            </div>
          ))
        )}
      </div>

      <button
        type="button"
        onClick={() => props.onReset?.()}
        className="mt-2 w-full rounded bg-red-500/80 px-2 py-1 text-[11px] font-medium text-white hover:bg-red-500"
      >Reset Nova</button>
    </div>
  );
}
