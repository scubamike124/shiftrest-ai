/**
 * useOpenAIRealtime — hidden beta client hook.
 *
 * Connects the browser directly to OpenAI Realtime over WebRTC using an
 * ephemeral client_secret minted server-side. No LiveKit, no external worker.
 *
 * - Publishes the microphone track.
 * - Attaches the assistant's remote audio track to a hidden <audio>.
 * - Parses the `oai-events` data channel to drive status
 *   (listening | thinking | speaking) and per-turn latency metrics.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { mintRealtimeSession } from "@/lib/realtime/openai.functions";

export type RealtimeStatus =
  | "idle"
  | "connecting"
  | "listening"
  | "thinking"
  | "speaking"
  | "reconnecting"
  | "disconnected"
  | "error";

export type RealtimeMetrics = {
  connectMs: number | null;
  firstAudioMs: number | null;
  lastTurnMs: number | null;
  tokenFetchMs: number | null;
  pcConnectedMs: number | null;
};

export type RealtimeTranscriptEvent = {
  id: string;
  from: "user" | "assistant";
  text: string;
  final: boolean;
  at: number;
};

const OPENAI_REALTIME_CALLS_URL = "https://api.openai.com/v1/realtime/calls";

export function useOpenAIRealtime() {
  const mint = useServerFn(mintRealtimeSession);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const connectStartRef = useRef<number | null>(null);
  const turnStartRef = useRef<number | null>(null);

  const [status, setStatus] = useState<RealtimeStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [muted, setMuted] = useState(false);
  const [transcript, setTranscript] = useState<RealtimeTranscriptEvent[]>([]);
  const [metrics, setMetrics] = useState<RealtimeMetrics>({
    connectMs: null,
    firstAudioMs: null,
    lastTurnMs: null,
  });

  const teardown = useCallback(async () => {
    try {
      dcRef.current?.close();
    } catch { /* noop */ }
    dcRef.current = null;
    try {
      pcRef.current?.getSenders().forEach((s) => s.track?.stop());
      pcRef.current?.close();
    } catch { /* noop */ }
    pcRef.current = null;
    micStreamRef.current?.getTracks().forEach((t) => t.stop());
    micStreamRef.current = null;
    if (remoteAudioRef.current) remoteAudioRef.current.srcObject = null;
    connectStartRef.current = null;
    turnStartRef.current = null;
  }, []);

  const handleEvent = useCallback((raw: string) => {
    let evt: { type?: string; transcript?: string; delta?: string } & Record<string, unknown>;
    try {
      evt = JSON.parse(raw);
    } catch {
      return;
    }
    const type = evt.type ?? "";

    // Turn-taking + latency signals.
    if (type === "input_audio_buffer.speech_started") {
      setStatus("listening");
      turnStartRef.current = performance.now();
    } else if (type === "input_audio_buffer.speech_stopped") {
      setStatus("thinking");
    } else if (type === "response.created") {
      if (turnStartRef.current == null) turnStartRef.current = performance.now();
      setStatus("thinking");
    } else if (
      type === "response.output_audio.delta" ||
      type === "response.audio.delta"
    ) {
      const now = performance.now();
      setStatus("speaking");
      setMetrics((m) => {
        const next: RealtimeMetrics = { ...m };
        if (m.firstAudioMs == null && connectStartRef.current != null) {
          next.firstAudioMs = now - connectStartRef.current;
        }
        if (turnStartRef.current != null && m.lastTurnMs !== now - turnStartRef.current) {
          next.lastTurnMs = now - turnStartRef.current;
          turnStartRef.current = null;
        }
        return next;
      });
    } else if (type === "response.done" || type === "response.completed") {
      setStatus("listening");
    }

    // Transcript events (best-effort — OpenAI event names vary by model version).
    if (
      type === "conversation.item.input_audio_transcription.completed" &&
      typeof evt.transcript === "string"
    ) {
      setTranscript((prev) => [
        ...prev,
        {
          id: `${Date.now()}-u`,
          from: "user",
          text: evt.transcript!,
          final: true,
          at: Date.now(),
        },
      ]);
    } else if (
      (type === "response.output_audio_transcript.done" ||
        type === "response.audio_transcript.done") &&
      typeof evt.transcript === "string"
    ) {
      setTranscript((prev) => [
        ...prev,
        {
          id: `${Date.now()}-a`,
          from: "assistant",
          text: evt.transcript!,
          final: true,
          at: Date.now(),
        },
      ]);
    }
  }, []);

  const connect = useCallback(async () => {
    if (pcRef.current) return;
    setError(null);
    setStatus("connecting");
    setTranscript([]);
    setMetrics({
      connectMs: null,
      firstAudioMs: null,
      lastTurnMs: null,
      tokenFetchMs: null,
      pcConnectedMs: null,
    });
    connectStartRef.current = performance.now();

    try {
      // 1) Mic FIRST — the ephemeral token is short-lived (~60s). If we
      //    minted it before requesting mic permission, the iOS Safari
      //    permission prompt could easily expire the token.
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      micStreamRef.current = stream;

      // 2) Mint ephemeral client_secret.
      const tTokenStart = performance.now();
      console.info("[realtime] token-fetch-start", { at: tTokenStart });
      const session = await mint();
      const tTokenEnd = performance.now();
      const tokenFetchMs = tTokenEnd - tTokenStart;
      console.info("[realtime] token-received", {
        at: tTokenEnd,
        tokenFetchMs: Math.round(tokenFetchMs),
        expiresInMs: session.expiresAt - Date.now(),
      });
      setMetrics((m) => ({ ...m, tokenFetchMs }));

      // 3) Peer connection.
      const pc = new RTCPeerConnection();
      pcRef.current = pc;

      pc.ontrack = (e) => {
        const el = remoteAudioRef.current;
        if (el && e.streams[0]) {
          el.srcObject = e.streams[0];
          el.play().catch(() => {
            /* user gesture already satisfied by click */
          });
        }
      };

      pc.onconnectionstatechange = () => {
        const s = pc.connectionState;
        if (s === "connected") {
          const now = performance.now();
          console.info("[realtime] peer-connection-established", {
            at: now,
            connectMs:
              connectStartRef.current != null
                ? Math.round(now - connectStartRef.current)
                : null,
          });
          setStatus("listening");
          setMetrics((m) => ({
            ...m,
            pcConnectedMs:
              connectStartRef.current != null
                ? now - connectStartRef.current
                : m.pcConnectedMs,
            connectMs:
              connectStartRef.current != null
                ? now - connectStartRef.current
                : m.connectMs,
          }));
        } else if (s === "disconnected" || s === "failed") {
          setStatus(s === "failed" ? "error" : "disconnected");
        }
      };

      const dc = pc.createDataChannel("oai-events");
      dcRef.current = dc;
      dc.onmessage = (e) => handleEvent(typeof e.data === "string" ? e.data : "");

      stream.getTracks().forEach((track) => pc.addTrack(track, stream));

      // 4) SDP handshake with OpenAI Realtime (new /v1/realtime/calls endpoint).
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      const sdpRes = await fetch(
        `${OPENAI_REALTIME_CALLS_URL}?model=${encodeURIComponent(session.model)}`,
        {
          method: "POST",
          body: offer.sdp,
          headers: {
            Authorization: `Bearer ${session.clientSecret}`,
            "Content-Type": "application/sdp",
          },
        },
      );
      if (!sdpRes.ok) {
        const detail = await sdpRes.text().catch(() => "");
        throw new Error(
          `OpenAI SDP exchange failed (${sdpRes.status}): ${detail.slice(0, 160)}`,
        );
      }
      const answerSdp = await sdpRes.text();
      await pc.setRemoteDescription({ type: "answer", sdp: answerSdp });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStatus("error");
      await teardown();
    }
  }, [mint, handleEvent, teardown]);

  const disconnect = useCallback(async () => {
    await teardown();
    setStatus("idle");
  }, [teardown]);

  const toggleMute = useCallback(() => {
    const next = !muted;
    micStreamRef.current?.getAudioTracks().forEach((t) => (t.enabled = !next));
    setMuted(next);
  }, [muted]);

  useEffect(() => {
    return () => {
      void teardown();
    };
  }, [teardown]);

  return {
    status,
    error,
    muted,
    transcript,
    metrics,
    connect,
    disconnect,
    toggleMute,
    remoteAudioRef,
  };
}
