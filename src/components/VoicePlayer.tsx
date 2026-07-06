import { useEffect, useRef, useState } from "react";
import { Volume2, Loader2, Square } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { expandForSpeech } from "@/lib/voice-rewriter";
import { supabase } from "@/integrations/supabase/client";
import {
  speakQueued,
  stopSpeaking,
  prepareVoicePlayback,
  TTS_PATH_DIAGNOSTIC_BUILD,
} from "@/lib/companion/speak";

type Props = {
  // Returns the raw plan text. We call /api/brief to rewrite it, then route
  // the conversational script through the shared Companion speech pipeline
  // so the first greeting sounds identical to every other AI response
  // (same TTS provider, voice preset, normalization, gain, and soft-clip).
  buildPlanText: () => string | null;
  className?: string;
};

type TimingRow = { key: string; label: string; dPrev: number; dTotal: number };
type Timing = {
  traceId: string;
  rows: TimingRow[];
  summary?: { llmMs: number; ttsPlayMs: number; totalMs: number };
  ttsPath?: {
    build: string;
    label: string;
    path: string;
    provider: string;
    endpoint: string;
    reason?: string;
  };
};

export function VoicePlayer({ buildPlanText, className }: Props) {
  const [loading, setLoading] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [timing, setTiming] = useState<Timing | null>(null);
  const [diag, setDiag] = useState<{ heard: number; gate: "pending" | "pass" | "reject"; lastLabel?: string }>({ heard: 0, gate: "pending" });


  // Reflect the shared pipeline's status so Play/Stop UI stays accurate.
  useEffect(() => {
    if (typeof window === "undefined") return;
    function onStatus(e: Event) {
      const detail = (e as CustomEvent).detail as { status: string };
      if (detail.status === "started") setSpeaking(true);
      else if (detail.status === "ended" || detail.status === "failed" || detail.status === "skipped") {
        // turn-ended will also fire; this just keeps UI responsive per-chunk.
      }
    }
    function onTurnEnded() {
      setSpeaking(false);
    }
    window.addEventListener("companion:voice-status", onStatus);
    window.addEventListener("companion:turn-ended", onTurnEnded);
    return () => {
      window.removeEventListener("companion:voice-status", onStatus);
      window.removeEventListener("companion:turn-ended", onTurnEnded);
    };
  }, []);

  // Stop any in-flight briefing speech when this component unmounts so it
  // can't leak into another screen.
  useEffect(() => {
    return () => {
      stopSpeaking();
    };
  }, []);

  async function generateAndPlay() {
    if (loading || speaking) return; // guard against double-taps
    const plan = buildPlanText();
    if (!plan) {
      toast.info("Nothing to brief yet");
      return;
    }

    // ---- Timing instrumentation (temporary; see .lovable/plan.md) ----
    const traceId = Math.random().toString(36).slice(2, 7);
    const t0 = performance.now();
    let last = t0;
    setTiming({ traceId, rows: [] });
    setDiag({ heard: 0, gate: "pending" });
    const mark = (key: string, label: string) => {
      const now = performance.now();
      const dPrev = Math.round(now - last);
      const dTotal = Math.round(now - t0);
      // eslint-disable-next-line no-console
      console.info(
        `[brief-timing #${traceId}] ${label} +${dPrev}ms (total ${dTotal}ms)`,
      );
      last = now;
      setTiming((prev) => {
        if (!prev || prev.traceId !== traceId) return prev;
        const rows = [...prev.rows, { key, label, dPrev, dTotal }];
        let summary = prev.summary;
        if (key === "t5") {
          const t2 = rows.find((r) => r.key === "t2")?.dTotal ?? 0;
          const t1 = rows.find((r) => r.key === "t1")?.dTotal ?? 0;
          const t4 = rows.find((r) => r.key === "t4")?.dTotal ?? 0;
          summary = {
            llmMs: Math.max(0, t2 - t1),
            ttsPlayMs: Math.max(0, dTotal - t4),
            totalMs: dTotal,
          };
        }
        return { ...prev, rows, summary };
      });
    };
    mark("t0", "t0 tap");

    // One-shot listener for the first "started" audio event of this tap.
    const onStarted = (e: Event) => {
      const detail = (e as CustomEvent).detail as { status?: string };
      if (detail?.status === "started") {
        mark("t5", "t5 first audio started");
        window.removeEventListener("companion:voice-status", onStarted);
      }
    };
    window.addEventListener("companion:voice-status", onStarted);
    // Safety: drop the listener after 30s in case audio never starts.
    setTimeout(
      () => window.removeEventListener("companion:voice-status", onStarted),
      30_000,
    );

    const onTtsPath = (e: Event) => {
      const detail = (e as CustomEvent).detail as Timing["ttsPath"];
      // Unconditional: count every fire and stash the label BEFORE any gate.
      setDiag((prev) => ({
        heard: prev.heard + 1,
        gate: prev.gate,
        lastLabel: detail?.label,
      }));
      if (!detail) return;
      let gated: "pass" | "reject" = "reject";
      setTiming((prev) => {
        if (!prev || prev.traceId !== traceId) return prev;
        gated = "pass";
        return { ...prev, ttsPath: detail };
      });
      setDiag((prev) => ({ ...prev, gate: gated }));
      window.removeEventListener("companion:tts-path", onTtsPath);
    };
    window.addEventListener("companion:tts-path", onTtsPath);
    setTimeout(
      () => window.removeEventListener("companion:tts-path", onTtsPath),
      30_000,
    );


    // Arm the shared audio pipeline INSIDE the user gesture (iOS Safari).
    prepareVoicePlayback();

    setLoading(true);
    try {
      // Send the user's local time + tz so the model greets with the correct
      // time of day (no UTC drift on the server).
      let localTime: string | undefined;
      let timezone: string | undefined;
      try {
        localTime = new Date().toISOString();
        timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      } catch {
        /* best effort */
      }

      // 1. Rewrite into conversational script.
      // Attach the Supabase bearer token so /api/brief (auth-guarded in Batch A)
      // accepts the request. Anonymous users get a graceful failure below.
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token;
      if (!token) {
        toast.info("Sign in to use voice briefing.");
        return;
      }
      mark("t1", "t1 /api/brief sent");
      const briefRes = await fetch("/api/brief", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ plan, localTime, timezone }),
      });
      mark("t2", "t2 /api/brief headers");
      let briefData: { script?: string; fallback?: boolean; message?: string; error?: string } = {};
      try {
        briefData = await briefRes.json();
      } catch {
        /* non-JSON */
      }
      mark("t3", "t3 /api/brief parsed");
      if (!briefRes.ok || briefData.error) {
        toast.info(briefData.error || "Voice briefing is temporarily unavailable.");
        return;
      }
      if (briefData.fallback) {
        toast.info(briefData.message || "Voice briefing is temporarily unavailable.");
        return;
      }
      const script = briefData.script;
      if (!script) {
        toast.info("Voice briefing is temporarily unavailable.");
        return;
      }

      // 2. Speak via the shared Companion pipeline — identical TTS provider,
      // voice preset, normalization, gain, and soft-clip as every other reply.
      // Prepend a soft lead-in ("… ") so ElevenLabs starts the very first
      // utterance with a half-breath instead of a cold, louder/faster opener.
      const spoken = "… " + expandForSpeech(script).slice(0, 1200);
      mark("t4", "t4 speakQueued");
      speakQueued(spoken, { source: "assistant_reply" });
    } catch (e) {
      console.error("VoicePlayer error", e);
      toast.error("Voice briefing is temporarily unavailable.");
    } finally {
      setLoading(false);
    }
  }


  function stop() {
    stopSpeaking();
    setSpeaking(false);
  }

  return (
    <div className={className ?? ""}>
      <div className="rounded-2xl border border-border bg-card">
        {!speaking && !loading && (
          <button
            onClick={generateAndPlay}
            className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-primary text-sm font-semibold text-primary-foreground shadow-[var(--shadow-glow)] active:scale-[0.99]"
          >
            <Volume2 className="h-4 w-4" /> Voice briefing
          </button>
        )}

        {loading && (
          <div className="flex h-12 items-center justify-center gap-2 rounded-2xl bg-primary text-sm font-semibold text-primary-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Preparing your briefing…
          </div>
        )}

        {speaking && !loading && (
          <div className="flex items-center gap-3 p-3">
            <button
              onClick={stop}
              className="flex h-11 flex-1 items-center justify-center gap-2 rounded-2xl border border-border bg-card text-sm font-semibold text-foreground active:scale-[0.99]"
              aria-label="Stop briefing"
            >
              <Square className="h-4 w-4" /> Stop briefing
            </button>
            <Link
              to="/profile"
              className="text-[11px] text-muted-foreground underline-offset-2 hover:underline"
            >
              Change voice
            </Link>
          </div>
        )}
      </div>

      {timing && (
        <div className="mt-2 rounded-2xl border border-border bg-black/80 p-3 font-mono text-[11px] leading-tight text-white">
          <div className="mb-1 flex items-center justify-between">
            <span className="font-semibold">brief-timing #{timing.traceId}</span>
            <button
              onClick={() => setTiming(null)}
              className="rounded px-2 py-0.5 text-white/70 hover:bg-white/10"
              aria-label="Dismiss timing panel"
            >
              ×
            </button>
          </div>
          <div className="border-t border-white/20 pt-1">
            {timing.rows.map((r) => (
              <div key={r.key} className="flex justify-between gap-2 tabular-nums">
                <span className="truncate">{r.label}</span>
                <span className="whitespace-nowrap text-white/70">
                  +{r.dPrev}ms ({r.dTotal}ms)
                </span>
              </div>
            ))}
            {timing.rows.length === 0 && (
              <div className="text-white/50">waiting…</div>
            )}
          </div>
          {timing.summary && (
            <div className="mt-2 border-t border-white/20 pt-1 tabular-nums">
              <div className="flex justify-between"><span>LLM step</span><span>{timing.summary.llmMs} ms</span></div>
              <div className="flex justify-between"><span>TTS + play</span><span>{timing.summary.ttsPlayMs} ms</span></div>
              <div className="flex justify-between font-semibold"><span>TOTAL</span><span>{timing.summary.totalMs} ms</span></div>
            </div>
          )}
          <div className="mt-2 border-t border-white/20 pt-1">
            <div className="flex justify-between gap-2">
              <span>TTS path</span>
              <span className="text-right text-white/80">
                {timing.ttsPath?.label ?? "waiting…"}
              </span>
            </div>
            <div className="mt-1 break-all text-white/50">
              build {timing.ttsPath?.build ?? TTS_PATH_DIAGNOSTIC_BUILD}
              {timing.ttsPath ? ` · ${timing.ttsPath.provider} · ${timing.ttsPath.endpoint}` : ""}
              {timing.ttsPath?.reason ? ` · ${timing.ttsPath.reason}` : ""}
            </div>
            <div className="mt-1 flex justify-between gap-2 text-white/70">
              <span>heard:</span><span>{diag.heard}</span>
            </div>
            <div className="flex justify-between gap-2 text-white/70">
              <span>gate:</span><span>{diag.gate}</span>
            </div>
            <div className="flex justify-between gap-2 text-white/70">
              <span>global:</span>
              <span className="text-right">
                {(typeof window !== "undefined" &&
                  (window as unknown as { __restpilotLastTtsPath?: { label?: string } }).__restpilotLastTtsPath?.label) ||
                  diag.lastLabel ||
                  "—"}
              </span>
            </div>
          </div>

        </div>
      )}
    </div>
  );
}

