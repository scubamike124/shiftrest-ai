/**
 * useRealtimePilot — hidden beta client hook.
 *
 * Connects the browser to LiveKit using a token minted by
 * `mintRealtimePilotToken` (Phase 1 server fn), publishes the microphone,
 * plays remote assistant audio, and exposes minimal telemetry
 * (connection state, transcript events, time-to-first-audio).
 *
 * This hook is only used by /lab/pilot-realtime, which is itself gated by
 * VITE_ENABLE_REALTIME_PILOT. Nothing here touches the production voice
 * pipeline.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ConnectionState,
  RemoteTrack,
  RemoteTrackPublication,
  Room,
  RoomEvent,
  Track,
  createLocalAudioTrack,
  type RemoteParticipant,
} from "livekit-client";
import { useServerFn } from "@tanstack/react-start";
import { mintRealtimePilotToken } from "@/lib/realtime.functions";

export type RealtimeStatus =
  | "idle"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "disconnected"
  | "error";

export type RealtimeMetrics = {
  connectedAtMs: number | null;
  firstAudioAtMs: number | null;
  timeToFirstAudioMs: number | null;
};

export type RealtimeTranscriptEvent = {
  id: string;
  from: "user" | "assistant";
  text: string;
  final: boolean;
  at: number;
};

const TOKEN_REFRESH_LEEWAY_MS = 15_000;

export function useRealtimePilot() {
  const mint = useServerFn(mintRealtimePilotToken);
  const roomRef = useRef<Room | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const connectStartRef = useRef<number | null>(null);

  const [status, setStatus] = useState<RealtimeStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [muted, setMuted] = useState(false);
  const [remoteSpeaking, setRemoteSpeaking] = useState(false);
  const [transcript, setTranscript] = useState<RealtimeTranscriptEvent[]>([]);
  const [metrics, setMetrics] = useState<RealtimeMetrics>({
    connectedAtMs: null,
    firstAudioAtMs: null,
    timeToFirstAudioMs: null,
  });

  const teardown = useCallback(async () => {
    const room = roomRef.current;
    roomRef.current = null;
    if (room) {
      try {
        await room.disconnect(true);
      } catch {
        /* noop */
      }
    }
    if (remoteAudioRef.current) {
      remoteAudioRef.current.srcObject = null;
    }
    connectStartRef.current = null;
  }, []);

  const connect = useCallback(async () => {
    if (roomRef.current) return;
    setError(null);
    setStatus("connecting");
    setTranscript([]);
    setMetrics({ connectedAtMs: null, firstAudioAtMs: null, timeToFirstAudioMs: null });
    connectStartRef.current = performance.now();

    try {
      const token = await mint();
      const ttlLeft = token.expiresAt - Date.now();
      if (ttlLeft < TOKEN_REFRESH_LEEWAY_MS) {
        throw new Error("Token expired before use");
      }

      const room = new Room({
        adaptiveStream: true,
        dynacast: true,
        publishDefaults: { dtx: true, red: true, stopMicTrackOnMute: false },
      });
      roomRef.current = room;

      room.on(RoomEvent.ConnectionStateChanged, (state) => {
        if (state === ConnectionState.Connected) {
          setStatus("connected");
          setMetrics((m) => ({ ...m, connectedAtMs: performance.now() }));
        } else if (state === ConnectionState.Reconnecting) {
          setStatus("reconnecting");
        } else if (state === ConnectionState.Disconnected) {
          setStatus("disconnected");
        }
      });

      room.on(RoomEvent.Disconnected, () => {
        setStatus("disconnected");
      });

      room.on(RoomEvent.TrackSubscribed, (track: RemoteTrack, _pub: RemoteTrackPublication, participant: RemoteParticipant) => {
        if (track.kind !== Track.Kind.Audio) return;
        // Attach to hidden <audio> element; the useEffect below mounts it.
        const el = remoteAudioRef.current;
        if (el) {
          track.attach(el);
          el.play().catch(() => {
            /* browsers may require user gesture; the click that called
               connect() satisfies that */
          });
        }
        // First audio timing: capture on first packet.
        const start = connectStartRef.current;
        if (start != null) {
          const now = performance.now();
          setMetrics((m) =>
            m.firstAudioAtMs != null
              ? m
              : { ...m, firstAudioAtMs: now, timeToFirstAudioMs: now - start },
          );
        }
        void participant; // reserved for future multi-participant use
      });

      room.on(RoomEvent.ActiveSpeakersChanged, (speakers) => {
        const remoteActive = speakers.some((p) => p.identity !== room.localParticipant.identity);
        setRemoteSpeaking(remoteActive);
      });

      // Transcript / structured events from the agent worker (if it
      // publishes them on the data channel).
      room.on(RoomEvent.DataReceived, (payload, participant) => {
        try {
          const decoded = new TextDecoder().decode(payload);
          const evt = JSON.parse(decoded) as {
            type?: string;
            from?: "user" | "assistant";
            text?: string;
            final?: boolean;
          };
          if (evt.type === "transcript" && typeof evt.text === "string") {
            setTranscript((prev) => [
              ...prev,
              {
                id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                from: evt.from ?? (participant?.identity ? "assistant" : "user"),
                text: evt.text!,
                final: evt.final ?? true,
                at: Date.now(),
              },
            ]);
          }
        } catch {
          /* non-JSON data — ignore */
        }
      });

      await room.connect(token.url, token.token);

      await room.localParticipant.setMicrophoneEnabled(true, {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      });

    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStatus("error");
      await teardown();
    }
  }, [mint, teardown]);

  const disconnect = useCallback(async () => {
    await teardown();
    setStatus("idle");
    setRemoteSpeaking(false);
  }, [teardown]);

  const toggleMute = useCallback(async () => {
    const room = roomRef.current;
    if (!room) return;
    const next = !muted;
    await room.localParticipant.setMicrophoneEnabled(!next);
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
    remoteSpeaking,
    transcript,
    metrics,
    connect,
    disconnect,
    toggleMute,
    remoteAudioRef,
  };
}
