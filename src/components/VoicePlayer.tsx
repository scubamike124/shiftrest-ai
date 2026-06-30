import { useEffect, useRef, useState } from "react";
import { Volume2, Loader2, Square } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { expandForSpeech } from "@/lib/voice-rewriter";
import {
  speakQueued,
  stopSpeaking,
  prepareVoicePlayback,
} from "@/lib/companion/speak";

type Props = {
  // Returns the raw plan text. We call /api/brief to rewrite it, then route
  // the conversational script through the shared Companion speech pipeline
  // so the first greeting sounds identical to every other AI response
  // (same TTS provider, voice preset, normalization, gain, and soft-clip).
  buildPlanText: () => string | null;
  className?: string;
};

export function VoicePlayer({ buildPlanText, className }: Props) {
  const [loading, setLoading] = useState(false);
  const [speaking, setSpeaking] = useState(false);

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
      const briefRes = await fetch("/api/brief", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan, localTime, timezone }),
      });
      let briefData: { script?: string; fallback?: boolean; message?: string; error?: string } = {};
      try {
        briefData = await briefRes.json();
      } catch {
        /* non-JSON */
      }
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
    <div className={`rounded-2xl border border-border bg-card ${className ?? ""}`}>
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
  );
}
