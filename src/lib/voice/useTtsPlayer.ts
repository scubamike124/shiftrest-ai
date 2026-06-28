import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import type { VoiceId } from "@/lib/voice-rewriter";
import { supabase } from "@/lib/supabase";

export type TtsState = "idle" | "loading" | "ready" | "playing" | "paused" | "error";

type Options = {
  /** Optional explicit voice override. When omitted, the user's saved voice profile is used. */
  voice?: VoiceId | string;
  /** If true, also pipes the text through /api/brief to humanize it before TTS. */
  rewrite?: boolean;
};

/**
 * Shared TTS playback hook used by both Voice Briefing and the AI Coach.
 *
 * iOS Safari requirement: any HTMLAudioElement that .play() will be called on
 * must be created/touched synchronously inside the originating user gesture.
 * Call `armGesture()` from a click handler BEFORE any async work, then call
 * `play(text)` after the text is ready. If the gesture token has already
 * expired by then, `needsTap` flips true; render a button that calls
 * `playPrepared()` to start playback from a fresh tap (no re-fetch).
 */
export function useTtsPlayer(opts: Options = {}) {
  const { voice, rewrite = false } = opts;
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const urlRef = useRef<string | null>(null);
  const [state, setState] = useState<TtsState>("idle");
  const [needsTap, setNeedsTap] = useState(false);
  const [duration, setDuration] = useState(0);
  const [current, setCurrent] = useState(0);

  const cleanup = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = "";
    }
    if (urlRef.current) {
      URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
    }
    setDuration(0);
    setCurrent(0);
    setNeedsTap(false);
  }, []);

  useEffect(() => {
    return () => {
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      audioRef.current?.pause();
    };
  }, []);

  /** Call synchronously inside a user gesture (click/tap) BEFORE any await. */
  const armGesture = useCallback(() => {
    if (typeof window === "undefined") return;
    const audio = audioRef.current ?? new Audio();
    audioRef.current = audio;
    try {
      audio.load();
    } catch {
      /* no-op */
    }
  }, []);

  const stop = useCallback(() => {
    const a = audioRef.current;
    if (!a) return;
    a.pause();
    a.currentTime = 0;
    setState("idle");
  }, []);

  const pause = useCallback(() => {
    audioRef.current?.pause();
  }, []);

  const resume = useCallback(() => {
    audioRef.current?.play().catch(() => {});
  }, []);

  /** Re-play the already-prepared audio (after a needsTap fallback). */
  const playPrepared = useCallback(async () => {
    const a = audioRef.current;
    if (!a || !urlRef.current) return;
    try {
      await a.play();
      setNeedsTap(false);
    } catch (e) {
      console.error("playPrepared rejected", e);
    }
  }, []);

  const play = useCallback(
    async (text: string) => {
      if (!text || !text.trim()) return;
      // Allow caller to omit explicit armGesture; we still try a fresh element.
      armGesture();
      const audio = audioRef.current!;
      // Stop any prior playback
      try {
        audio.pause();
      } catch {
        /* no-op */
      }
      if (urlRef.current) {
        URL.revokeObjectURL(urlRef.current);
        urlRef.current = null;
      }
      setNeedsTap(false);
      setState("loading");

      try {
        let speakText = text;

        if (rewrite) {
          const briefRes = await fetch("/api/brief", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ plan: text }),
          });
          let briefData: { script?: string; fallback?: boolean; message?: string; error?: string } = {};
          try {
            briefData = await briefRes.json();
          } catch {
            /* non-JSON */
          }
          if (!briefRes.ok || briefData.error || briefData.fallback || !briefData.script) {
            toast.info(briefData.message || briefData.error || "Voice playback is temporarily unavailable.");
            setState("error");
            return;
          }
          speakText = briefData.script;
        }

        const ttsRes = await fetch("/api/tts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: speakText.slice(0, 4000), voice }),
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
          setState("error");
          return;
        }
        const blob = await ttsRes.blob();
        const url = URL.createObjectURL(blob);
        urlRef.current = url;
        audio.src = url;
        audio.onloadedmetadata = () => {
          if (isFinite(audio.duration)) setDuration(audio.duration);
        };
        audio.ontimeupdate = () => setCurrent(audio.currentTime);
        audio.onplay = () => setState("playing");
        audio.onpause = () => setState((s) => (s === "playing" ? "paused" : s));
        audio.onended = () => setState("idle");

        try {
          await audio.play();
          setState("playing");
        } catch (playErr) {
          console.error("audio.play() rejected", playErr);
          const name = playErr instanceof DOMException ? playErr.name : "";
          if (name === "NotSupportedError") {
            toast.error("Your browser can't play this audio format.");
            setState("error");
          } else {
            // Autoplay blocked — keep audio prepared, surface tap-to-play UI.
            setNeedsTap(true);
            setState("ready");
          }
        }
      } catch (e) {
        console.error("useTtsPlayer error", e);
        const name = e instanceof DOMException ? e.name : "";
        if (name === "NotAllowedError") {
          setNeedsTap(true);
          setState("ready");
        } else {
          toast.error("Voice playback is temporarily unavailable.");
          setState("error");
        }
      }
    },
    [armGesture, rewrite, voice],
  );

  return {
    state,
    needsTap,
    duration,
    current,
    audioRef,
    armGesture,
    play,
    playPrepared,
    pause,
    resume,
    stop,
    cleanup,
  };
}
