import { useCallback, useEffect, useRef, useState } from "react";
import { encodeWav } from "./wav-encoder";

export type MicState = "idle" | "requesting" | "listening" | "encoding" | "denied" | "error";

type Options = {
  silenceMs?: number;
  silenceThreshold?: number;
  noSpeechMs?: number;
  maxMs?: number;
};

/**
 * Persistent Web Audio mic capture → WAV blob.
 *
 * Permission model: the MediaStream and AudioContext are acquired once and
 * reused across every conversation turn for the lifetime of the hook. We
 * never call `track.stop()` between turns — instead the track is muted
 * (`enabled = false`) and the ScriptProcessor is disconnected, so the
 * browser does not re-prompt and the OS mic indicator does not re-arm
 * every conversation.
 *
 * Full teardown (`release()`) happens on hook unmount or on explicit user
 * "Release microphone" action. On page hide we also disconnect the audio
 * graph but keep the track alive so returning to the tab is instant.
 */
export function useMicRecorder(opts: Options = {}) {
  const { silenceMs = 1400, silenceThreshold = 0.012, noSpeechMs = 8_000, maxMs = 30_000 } = opts;
  const [state, setState] = useState<MicState>("idle");
  const [level, setLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [reserved, setReserved] = useState(false);
  const stateRef = useRef<MicState>("idle");

  const streamRef = useRef<MediaStream | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const procRef = useRef<ScriptProcessorNode | null>(null);
  const srcRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const chunksRef = useRef<Float32Array[]>([]);
  const lastVoiceRef = useRef<number>(0);
  const hasVoiceRef = useRef(false);
  const startedRef = useRef<number>(0);
  const onStopRef = useRef<((blob: Blob | null) => void) | null>(null);

  const setMicState = useCallback((next: MicState) => {
    stateRef.current = next;
    setState(next);
  }, []);

  /** Disconnect the audio graph but KEEP the MediaStream and AudioContext. */
  const pauseGraph = useCallback(() => {
    try { procRef.current?.disconnect(); } catch { /* noop */ }
    try { srcRef.current?.disconnect(); } catch { /* noop */ }
    procRef.current = null;
    srcRef.current = null;
    // Mute the track so the OS mic indicator turns off between turns.
    try {
      streamRef.current?.getAudioTracks().forEach((t) => { t.enabled = false; });
    } catch { /* noop */ }
  }, []);

  /** Full release — stops tracks, closes context. Call on unmount/explicit release. */
  const release = useCallback(() => {
    pauseGraph();
    try { streamRef.current?.getTracks().forEach((t) => t.stop()); } catch { /* noop */ }
    try { ctxRef.current?.close(); } catch { /* noop */ }
    streamRef.current = null;
    ctxRef.current = null;
    setReserved(false);
  }, [pauseGraph]);

  useEffect(() => () => release(), [release]);

  const finalize = useCallback((): Blob | null => {
    const ctx = ctxRef.current;
    const rate = ctx?.sampleRate ?? 48000;
    const all = chunksRef.current;
    chunksRef.current = [];
    pauseGraph();
    if (!all.length) return null;
    const blob = encodeWav(all, rate, 16000);
    return blob.size > 2048 ? blob : null;
  }, [pauseGraph]);

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

  /** Acquire mic once; subsequent calls just resume the existing graph. */
  const ensureStream = useCallback(async (): Promise<MediaStream> => {
    if (streamRef.current && streamRef.current.getAudioTracks().some((t) => t.readyState === "live")) {
      streamRef.current.getAudioTracks().forEach((t) => { t.enabled = true; });
      return streamRef.current;
    }
    // iOS Safari (including PWA / Home Screen) requires getUserMedia to be
    // invoked synchronously inside the tap gesture. Any prior `await` — even
    // an innocuous `navigator.permissions.query` — can consume the gesture
    // and cause getUserMedia to silently open a muted / non-functional track
    // on the first tap. So on Safari/iOS we skip the pre-check entirely and
    // call getUserMedia first; NotAllowedError is handled by the caller.
    const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
    const isAppleWebKit = /iP(hone|ad|od)/.test(ua) || (/Safari/.test(ua) && !/Chrome|CriOS|Android/.test(ua));
    if (!isAppleWebKit) {
      try {
        const permsApi = (navigator as Navigator & {
          permissions?: { query: (d: PermissionDescriptor) => Promise<PermissionStatus> };
        }).permissions;
        if (permsApi?.query) {
          const status = await permsApi
            .query({ name: "microphone" as PermissionName })
            .catch(() => null);
          if (status?.state === "denied") {
            setError("Microphone access is blocked in browser settings.");
            setMicState("denied");
            throw new Error("mic_permission_denied");
          }
        }
      } catch (err) {
        if ((err as Error)?.message === "mic_permission_denied") throw err;
      }
    }
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
    streamRef.current = stream;
    setReserved(true);
    return stream;
  }, [setMicState]);


  const ensureContext = useCallback(async (): Promise<AudioContext> => {
    if (ctxRef.current && ctxRef.current.state !== "closed") {
      if (ctxRef.current.state === "suspended") {
        await ctxRef.current.resume().catch(() => {});
      }
      return ctxRef.current;
    }
    const Ctx: typeof AudioContext =
      window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    if (ctx.state === "suspended") await ctx.resume().catch(() => {});
    ctxRef.current = ctx;
    return ctx;
  }, []);

  const start = useCallback(
    async (onAutoStop?: (blob: Blob | null) => void): Promise<void> => {
      if (stateRef.current === "listening" || stateRef.current === "requesting" || stateRef.current === "encoding") return;
      setError(null);
      setMicState("requesting");
      try {
        const stream = await ensureStream();
        const ctx = await ensureContext();

        const src = ctx.createMediaStreamSource(stream);
        srcRef.current = src;
        const proc = ctx.createScriptProcessor(4096, 1, 1);
        procRef.current = proc;

        chunksRef.current = [];
        startedRef.current = performance.now();
        lastVoiceRef.current = performance.now();
        hasVoiceRef.current = false;
        onStopRef.current = onAutoStop ?? null;

        proc.onaudioprocess = (e) => {
          const data = e.inputBuffer.getChannelData(0);
          const copy = new Float32Array(data.length);
          copy.set(data);
          chunksRef.current.push(copy);

          let sum = 0;
          for (let i = 0; i < copy.length; i++) sum += copy[i] * copy[i];
          const rms = Math.sqrt(sum / copy.length);
          setLevel(rms);

          const now = performance.now();
          if (rms > silenceThreshold) {
            hasVoiceRef.current = true;
            lastVoiceRef.current = now;
          }
          const elapsed = now - startedRef.current;
          const sinceVoice = now - lastVoiceRef.current;
          if (
            (hasVoiceRef.current && elapsed > 600 && sinceVoice > silenceMs) ||
            (!hasVoiceRef.current && elapsed > noSpeechMs) ||
            elapsed > maxMs
          ) {
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
        pauseGraph();
        if (name === "NotAllowedError" || name === "SecurityError") {
          setMicState("denied");
          setError("Microphone permission denied.");
        } else {
          setMicState("error");
          setError(e instanceof Error ? e.message : "Couldn't open the microphone.");
        }
      }
    },
    [silenceMs, silenceThreshold, noSpeechMs, maxMs, finalize, pauseGraph, ensureStream, ensureContext, setMicState],
  );

  return { state, level, error, reserved, start, stop, release };
}
