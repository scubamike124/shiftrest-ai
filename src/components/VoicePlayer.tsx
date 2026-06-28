import { useEffect, useRef, useState } from "react";
import {
  Play,
  Pause,
  RotateCcw,
  Square,
  Loader2,
  Volume2,
} from "lucide-react";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { expandForSpeech } from "@/lib/voice-rewriter";
import { supabase } from "@/integrations/supabase/client";

type Props = {
  // Returns the raw plan text. We call /api/brief to rewrite it, then /api/tts.
  buildPlanText: () => string | null;
  className?: string;
};

const SPEEDS = [0.75, 1.0, 1.25, 1.5] as const;
type Speed = (typeof SPEEDS)[number];

const SPEED_KEY = "rp.voice.speed";

function fmtTime(s: number) {
  if (!isFinite(s) || s < 0) s = 0;
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

export function VoicePlayer({ buildPlanText, className }: Props) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const urlRef = useRef<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [ready, setReady] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [speed, setSpeed] = useState<Speed>(1.0);

  // Hydrate prefs (speed only — voice is now profile-driven from /profile).
  useEffect(() => {
    const s = Number(localStorage.getItem(SPEED_KEY));
    if (SPEEDS.includes(s as Speed)) setSpeed(s as Speed);
  }, []);

  useEffect(() => {
    return () => {
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      audioRef.current?.pause();
    };
  }, []);

  // Keep audio.playbackRate in sync
  useEffect(() => {
    if (audioRef.current) audioRef.current.playbackRate = speed;
    localStorage.setItem(SPEED_KEY, String(speed));
  }, [speed]);

  function resetAudio() {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = "";
    }
    if (urlRef.current) {
      URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
    }
    setPlaying(false);
    setReady(false);
    setCurrent(0);
    setDuration(0);
  }

  async function generateAndPlay() {
    if (loading) return; // guard against double-taps
    const plan = buildPlanText();
    if (!plan) {
      toast.info("Nothing to brief yet");
      return;
    }
    setLoading(true);
    resetAudio();

    // Pre-create the audio element under the user gesture so iOS Safari
    // keeps the gesture token alive across the async fetches below. Without
    // this, audio.play() rejects with NotAllowedError ("not allowed by the
    // user agent or the platform").
    const audio = audioRef.current ?? new Audio();
    audioRef.current = audio;
    try {
      audio.load();
    } catch {
      /* no-op */
    }

    try {
      // 1. Rewrite into conversational script
      const briefRes = await fetch("/api/brief", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan }),
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
      const spoken = expandForSpeech(script);

      // 2. Synthesize speech
      const ttsRes = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: spoken, voice }),
      });
      const ttsType = ttsRes.headers.get("content-type") || "";
      if (!ttsRes.ok || ttsType.includes("application/json")) {
        let msg = "Voice playback is temporarily unavailable.";
        try {
          const j = await ttsRes.json();
          if (j?.message) msg = j.message;
          else if (j?.error) msg = j.error;
        } catch {
          /* keep default */
        }
        toast.info(msg);
        return;
      }
      const blob = await ttsRes.blob();
      const url = URL.createObjectURL(blob);
      urlRef.current = url;

      audio.src = url;
      audio.playbackRate = speed;
      audio.onloadedmetadata = () => {
        if (!isFinite(audio.duration)) {
          audio.currentTime = 1e6;
          audio.ontimeupdate = () => {
            audio.ontimeupdate = null;
            audio.currentTime = 0;
            setDuration(audio.duration);
          };
        } else {
          setDuration(audio.duration);
        }
        setReady(true);
      };
      audio.ontimeupdate = () => setCurrent(audio.currentTime);
      audio.onplay = () => setPlaying(true);
      audio.onpause = () => setPlaying(false);
      audio.onended = () => {
        setPlaying(false);
        setCurrent(audio.duration || 0);
      };

      try {
        await audio.play();
      } catch (playErr) {
        // iOS Safari rejects play() if the original tap gesture has expired.
        // Surface a "ready to play" state — user taps play once to start.
        console.error("audio.play() rejected", playErr);
        setReady(true);
        setPlaying(false);
        const name = playErr instanceof DOMException ? playErr.name : "";
        if (name === "NotSupportedError") {
          toast.error("Your browser can't play this audio format.");
        } else {
          toast.info("Briefing ready — tap play to start.");
        }
      }
    } catch (e) {
      console.error("VoicePlayer error", e);
      const name = e instanceof DOMException ? e.name : "";
      if (name === "NotAllowedError") {
        toast.info("Briefing ready — tap play to start.");
      } else {
        toast.error("Voice briefing is temporarily unavailable.");
      }
      resetAudio();
    } finally {
      setLoading(false);
    }
  }


  function togglePlay() {
    const a = audioRef.current;
    if (!a || !ready) return;
    if (a.paused) a.play();
    else a.pause();
  }

  function stop() {
    const a = audioRef.current;
    if (!a) return;
    a.pause();
    a.currentTime = 0;
    setCurrent(0);
  }

  function restart() {
    const a = audioRef.current;
    if (!a) return;
    a.currentTime = 0;
    a.play();
  }

  function seek(v: number) {
    const a = audioRef.current;
    if (!a || !isFinite(duration)) return;
    a.currentTime = v;
    setCurrent(v);
  }

  function cycleSpeed() {
    const i = SPEEDS.indexOf(speed);
    const next = SPEEDS[(i + 1) % SPEEDS.length];
    setSpeed(next);
  }

  function pickVoice(v: VoiceId) {
    setVoice(v);
    localStorage.setItem(VOICE_KEY, v);
    setShowSettings(false);
    toast.success(`Voice set to ${VOICES.find((x) => x.id === v)?.label}`);
  }

  return (
    <div className={`rounded-2xl border border-border bg-card ${className ?? ""}`}>
      {!ready && !loading && (
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

      {ready && (
        <div className="flex flex-col gap-3 p-4">
          <div className="flex items-center gap-3">
            <button
              onClick={togglePlay}
              className="flex h-11 w-11 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-[var(--shadow-glow)] active:scale-95"
              aria-label={playing ? "Pause" : "Play"}
            >
              {playing ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5 translate-x-[1px]" />}
            </button>
            <button
              onClick={restart}
              className="flex h-9 w-9 items-center justify-center rounded-full border border-border text-muted-foreground active:scale-95"
              aria-label="Restart"
            >
              <RotateCcw className="h-4 w-4" />
            </button>
            <button
              onClick={stop}
              className="flex h-9 w-9 items-center justify-center rounded-full border border-border text-muted-foreground active:scale-95"
              aria-label="Stop"
            >
              <Square className="h-4 w-4" />
            </button>
            <button
              onClick={cycleSpeed}
              className="ml-auto flex h-9 min-w-12 items-center justify-center rounded-full border border-border px-3 text-xs font-semibold text-foreground active:scale-95"
              aria-label="Playback speed"
            >
              {speed}×
            </button>
            <button
              onClick={() => setShowSettings((s) => !s)}
              className="flex h-9 w-9 items-center justify-center rounded-full border border-border text-muted-foreground active:scale-95"
              aria-label="Voice options"
            >
              <Sparkles className="h-4 w-4" />
            </button>
          </div>

          <div>
            <input
              type="range"
              min={0}
              max={isFinite(duration) && duration > 0 ? duration : 1}
              step={0.1}
              value={current}
              onChange={(e) => seek(Number(e.target.value))}
              className="w-full accent-primary"
              aria-label="Seek"
            />
            <div className="mt-1 flex justify-between text-[11px] tabular-nums text-muted-foreground">
              <span>{fmtTime(current)}</span>
              <span>{fmtTime(duration)}</span>
            </div>
          </div>

          {showSettings && (
            <div className="flex flex-col gap-1 rounded-xl border border-border bg-secondary/40 p-2">
              <p className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Voice
              </p>
              {VOICES.map((v) => (
                <button
                  key={v.id}
                  onClick={() => pickVoice(v.id)}
                  className={`flex items-center justify-between rounded-lg px-2 py-2 text-left text-xs ${
                    voice === v.id ? "bg-primary/15 text-primary" : "text-foreground"
                  }`}
                >
                  <span className="font-semibold">{v.label}</span>
                  <span className="text-[11px] text-muted-foreground">{v.tone}</span>
                </button>
              ))}
              <button
                onClick={generateAndPlay}
                className="mt-1 rounded-lg bg-primary px-2 py-2 text-xs font-semibold text-primary-foreground"
              >
                Regenerate with selected voice
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
