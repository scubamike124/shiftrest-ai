import { useCallback, useEffect, useRef, useState } from "react";
import { encodeWav } from "./wav-encoder";

export type MicState = "idle" | "requesting" | "listening" | "encoding" | "denied" | "error";

type Options = {
  /** Auto-stop after this many ms of trailing silence (RMS < threshold). */
  silenceMs?: number;
  silenceThreshold?: number;
  /** Hard ceiling so a forgotten tab can't record forever. */
  maxMs?: number;
};

/**
 * Web Audio mic capture → WAV blob. iOS-safe: no MediaRecorder, no timeslice,
 * a single complete file per turn. Auto-stops on trailing silence.
 *
 * Call `start()` inside a user gesture. `stop()` returns the encoded WAV Blob
 * (or null if nothing usable was captured).
 */
export function useMicRecorder(opts: Options = {}) {
  const { silenceMs = 1400, silenceThreshold = 0.012, maxMs = 30_000 } = opts;
  const [state, setState] = useState<MicState>("idle");
  const [level, setLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const stateRef = useRef<MicState>("idle");

  const streamRef = useRef<MediaStream | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const procRef = useRef<ScriptProcessorNode | null>(null);
  const srcRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const chunksRef = useRef<Float32Array[]>([]);
  const lastVoiceRef = useRef<number>(0);
  const startedRef = useRef<number>(0);
  const onStopRef = useRef<((blob: Blob | null) => void) | null>(null);

  const setMicState = useCallback((next: MicState) => {
    stateRef.current = next;
    setState(next);
  }, []);

  const teardown = useCallback(() => {
    try { procRef.current?.disconnect(); } catch { /* noop */ }
    try { srcRef.current?.disconnect(); } catch { /* noop */ }
    try { streamRef.current?.getTracks().forEach((t) => t.stop()); } catch { /* noop */ }
    try { ctxRef.current?.close(); } catch { /* noop */ }
    procRef.current = null;
    srcRef.current = null;
    streamRef.current = null;
    ctxRef.current = null;
  }, []);

  useEffect(() => () => teardown(), [teardown]);

  const finalize = useCallback((): Blob | null => {
    const ctx = ctxRef.current;
    const rate = ctx?.sampleRate ?? 48000;
    const all = chunksRef.current;
    chunksRef.current = [];
    teardown();
    if (!all.length) return null;
    const blob = encodeWav(all, rate, 16000);
    return blob.size > 2048 ? blob : null;
  }, [teardown]);

  const stop = useCallback(async (): Promise<Blob | null> => {
    if (stateRef.current !== "listening") return null;
    setMicState("encoding");
    const blob = finalize();
    setMicState("idle");
    setLevel(0);
    const cb = onStopRef.current;
    onStopRef.current = null;
    if (cb) cb(blob);
    return blob;
  }, [finalize, setMicState]);

  const start = useCallback(
    async (onAutoStop?: (blob: Blob | null) => void): Promise<void> => {
      if (stateRef.current === "listening" || stateRef.current === "requesting" || stateRef.current === "encoding") return;
      setError(null);
      setMicState("requesting");
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        streamRef.current = stream;
        const Ctx: typeof AudioContext =
          window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        const ctx = new Ctx();
        if (ctx.state === "suspended") await ctx.resume().catch(() => {});
        ctxRef.current = ctx;

        const src = ctx.createMediaStreamSource(stream);
        srcRef.current = src;
        const proc = ctx.createScriptProcessor(4096, 1, 1);
        procRef.current = proc;

        chunksRef.current = [];
        startedRef.current = performance.now();
        lastVoiceRef.current = performance.now();
        onStopRef.current = onAutoStop ?? null;

        proc.onaudioprocess = (e) => {
          const data = e.inputBuffer.getChannelData(0);
          // copy because the underlying buffer is reused
          const copy = new Float32Array(data.length);
          copy.set(data);
          chunksRef.current.push(copy);

          // RMS level
          let sum = 0;
          for (let i = 0; i < copy.length; i++) sum += copy[i] * copy[i];
          const rms = Math.sqrt(sum / copy.length);
          setLevel(rms);

          const now = performance.now();
          if (rms > silenceThreshold) lastVoiceRef.current = now;

          const elapsed = now - startedRef.current;
          const sinceVoice = now - lastVoiceRef.current;
          // Auto-stop: trailing silence after at least 600ms of capture,
          // or hard maxMs cap.
          if ((elapsed > 600 && sinceVoice > silenceMs) || elapsed > maxMs) {
            const blob = finalize();
            setMicState("idle");
            setLevel(0);
            const cb = onStopRef.current;
            onStopRef.current = null;
            if (cb) cb(blob);
          }
        };

        src.connect(proc);
        proc.connect(ctx.destination);
        setMicState("listening");
      } catch (e) {
        const name = e instanceof DOMException ? e.name : "";
        teardown();
        if (name === "NotAllowedError" || name === "SecurityError") {
          setMicState("denied");
          setError("Microphone permission denied.");
        } else {
          setMicState("error");
          setError(e instanceof Error ? e.message : "Couldn't open the microphone.");
        }
      }
    },
    [silenceMs, silenceThreshold, maxMs, finalize, teardown, setMicState],
  );

  return { state, level, error, start, stop };
}
