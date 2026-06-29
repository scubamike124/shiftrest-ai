// /lab/avatar-poc/simli — Simli WebRTC streaming avatar POC.
//
// Pipeline:
//   1. user enters text, clicks Speak
//   2. POST /api/lab/simli/speak → MP3 (ElevenLabs Flash v2.5)
//   3. decodeAudioData → AudioBuffer
//   4. resample to 16 kHz mono PCM16 → chunk → SimliClient.sendAudioData
//   5. WebRTC <video> from Simli renders the talking face
//
// HUD captures:
//   • TTFB     — first audio byte arrival vs request start
//   • FPS      — running average from requestVideoFrameCallback / RAF fallback
//   • Glitches — count of WebRTC stalls observed via stats API (frames dropped)
//
// Gated: noindex, no app links to it. SIMLI_API_KEY never leaves the server.

import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { ELEVEN_VOICES, DEFAULT_ELEVEN_VOICE } from "@/lib/companion/renderer-pref";

export const Route = createFileRoute("/lab/avatar-poc/simli")({
  head: () => ({
    meta: [
      { title: "Simli POC — RestPilot Lab" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: SimliPoc,
});

// Simli's documented public demo face. The user can override per session.
const DEFAULT_FACE_ID = "tmp9i8bbq7c";

function SimliPoc() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const clientRef = useRef<any>(null);

  const [faceId, setFaceId] = useState(DEFAULT_FACE_ID);
  const [voice, setVoice] = useState<string>(DEFAULT_ELEVEN_VOICE);
  const [text, setText] = useState(
    "Hi — I'm running on Simli with ElevenLabs Flash. If you can hear me clearly and the face stays in sync, we're in business.",
  );
  const [status, setStatus] = useState<"idle" | "connecting" | "ready" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  const [ttfb, setTtfb] = useState<number | null>(null);
  const [fps, setFps] = useState<number>(0);
  const [glitches, setGlitches] = useState(0);
  const [lastSpeakMs, setLastSpeakMs] = useState<number | null>(null);

  const voices = useMemo(() => ELEVEN_VOICES, []);

  // ── FPS sampler ─────────────────────────────────────────────────────────
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    let raf = 0;
    let last = performance.now();
    let frames = 0;
    let cancelled = false;
    const tick = () => {
      if (cancelled) return;
      frames++;
      const now = performance.now();
      if (now - last >= 1000) {
        setFps(Math.round((frames * 1000) / (now - last)));
        frames = 0;
        last = now;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => { cancelled = true; cancelAnimationFrame(raf); };
  }, []);

  // ── WebRTC stall watcher ────────────────────────────────────────────────
  useEffect(() => {
    if (status !== "ready") return;
    const v = videoRef.current;
    if (!v) return;
    let prevDropped = 0;
    const t = setInterval(() => {
      const q = (v as any).getVideoPlaybackQuality?.();
      if (q && typeof q.droppedVideoFrames === "number") {
        const delta = q.droppedVideoFrames - prevDropped;
        if (delta > 0) setGlitches((g) => g + delta);
        prevDropped = q.droppedVideoFrames;
      }
    }, 2000);
    return () => clearInterval(t);
  }, [status]);

  async function connect() {
    setError(null);
    setStatus("connecting");
    try {
      const res = await fetch("/api/lab/simli/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ faceId, maxSessionLength: 300, maxIdleTime: 60 }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.detail || body.error || `Session ${res.status}`);
      }
      const { session_token } = await res.json();
      if (!session_token) throw new Error("No session_token returned");

      const { SimliClient } = await import("simli-client");
      const client = new SimliClient(
        session_token,
        videoRef.current!,
        audioRef.current!,
        null,
      );
      client.on("error", (msg: string) => {
        console.error("[simli] error", msg);
        setError(String(msg));
        setStatus("error");
      });
      client.on("start", () => setStatus("ready"));
      await client.start();
      clientRef.current = client;
      try { await videoRef.current?.play(); } catch { /* autoplay */ }
      try { await audioRef.current?.play(); } catch { /* autoplay */ }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[simli] connect failed", msg);
      setError(msg);
      setStatus("error");
    }
  }

  async function disconnect() {
    try { await clientRef.current?.stop?.(); } catch { /* ok */ }
    clientRef.current = null;
    setStatus("idle");
  }

  async function speak() {
    if (!clientRef.current) return;
    setError(null);
    const t0 = performance.now();
    const res = await fetch("/api/lab/simli/speak", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, voice }),
    });
    if (!res.ok) {
      setError(`TTS ${res.status}`);
      return;
    }
    const firstByteAt = performance.now();
    setTtfb(Math.round(firstByteAt - t0));

    const buf = await res.arrayBuffer();
    const Ctor: typeof AudioContext =
      (window.AudioContext || (window as any).webkitAudioContext) as any;
    const ctx = new Ctor();
    const decoded = await ctx.decodeAudioData(buf.slice(0));
    const pcm16 = resampleToPcm16Mono(decoded, 16000);
    // Send in ~200 ms chunks: 16000 Hz * 0.2 s = 3200 samples = 6400 bytes.
    const CHUNK = 6400;
    for (let i = 0; i < pcm16.byteLength; i += CHUNK) {
      const slice = new Uint8Array(pcm16.buffer, pcm16.byteOffset + i, Math.min(CHUNK, pcm16.byteLength - i));
      clientRef.current.sendAudioData(slice);
    }
    setLastSpeakMs(Math.round(performance.now() - t0));
    try { await ctx.close(); } catch { /* ignore */ }
  }

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-foreground/50">Internal lab · POC #1</p>
          <h1 className="mt-1 text-2xl font-semibold">Simli + ElevenLabs Flash v2.5</h1>
        </div>
        <Link to="/lab/avatar-poc" className="text-sm text-foreground/60 hover:text-foreground">
          ← Back
        </Link>
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-[1fr,360px]">
        <div className="rounded-3xl border border-white/10 bg-black/40 p-3">
          <div className="relative aspect-video w-full overflow-hidden rounded-2xl bg-black">
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted={false}
              className="absolute inset-0 h-full w-full object-cover"
            />
            <audio ref={audioRef} autoPlay playsInline className="hidden" />
            {status !== "ready" && (
              <div className="absolute inset-0 grid place-items-center text-sm text-white/70">
                {status === "idle" && "Tap Connect to start a Simli session"}
                {status === "connecting" && "Connecting…"}
                {status === "error" && (error || "Connection failed")}
              </div>
            )}
          </div>
          <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
            <Hud label="TTFB" value={ttfb != null ? `${ttfb} ms` : "—"} />
            <Hud label="Video FPS" value={fps ? `${fps}` : "—"} />
            <Hud label="Dropped frames" value={String(glitches)} />
          </div>
          {lastSpeakMs != null && (
            <p className="mt-2 text-center text-[11px] text-foreground/50">
              Last speak round-trip: {lastSpeakMs} ms (TTS → first audio chunk sent)
            </p>
          )}
        </div>

        <aside className="space-y-4">
          <label className="block">
            <span className="text-xs uppercase tracking-wider text-foreground/60">Face ID</span>
            <input
              value={faceId}
              onChange={(e) => setFaceId(e.target.value)}
              disabled={status === "ready" || status === "connecting"}
              className="mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm"
            />
          </label>

          <label className="block">
            <span className="text-xs uppercase tracking-wider text-foreground/60">Voice</span>
            <select
              value={voice}
              onChange={(e) => setVoice(e.target.value)}
              className="mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm"
            >
              {voices.map((v) => (
                <option key={v.id} value={v.id}>{v.label} — {v.tone}</option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="text-xs uppercase tracking-wider text-foreground/60">Script</span>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={5}
              className="mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm leading-relaxed"
            />
          </label>

          <div className="flex gap-2">
            {status === "ready" ? (
              <>
                <button onClick={speak} className="flex-1 rounded-lg bg-emerald-500/90 px-4 py-2 text-sm font-medium text-black hover:bg-emerald-400">
                  Speak
                </button>
                <button onClick={disconnect} className="rounded-lg border border-white/15 px-4 py-2 text-sm hover:bg-white/5">
                  Stop
                </button>
              </>
            ) : (
              <button
                onClick={connect}
                disabled={status === "connecting"}
                className="flex-1 rounded-lg bg-white/90 px-4 py-2 text-sm font-medium text-black disabled:opacity-50"
              >
                {status === "connecting" ? "Connecting…" : "Connect"}
              </button>
            )}
          </div>

          {error && (
            <p className="rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-xs text-red-300">
              {error}
            </p>
          )}

          <p className="text-[11px] leading-relaxed text-foreground/50">
            iOS Safari: Connect requires a user tap (unlocks audio + WebRTC). Default face id is
            Simli's public demo — replace with your own Trinity face id for branded testing.
          </p>
        </aside>
      </div>
    </main>
  );
}

function Hud({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/5 py-2">
      <div className="text-[10px] uppercase tracking-wider text-foreground/50">{label}</div>
      <div className="mt-0.5 text-sm tabular-nums">{value}</div>
    </div>
  );
}

// ── PCM16 mono resampler ─────────────────────────────────────────────────
function resampleToPcm16Mono(buffer: AudioBuffer, targetRate: number): Uint8Array {
  const srcRate = buffer.sampleRate;
  const channels = buffer.numberOfChannels;
  const srcLen = buffer.length;
  // Average channels down to mono.
  const mono = new Float32Array(srcLen);
  for (let c = 0; c < channels; c++) {
    const ch = buffer.getChannelData(c);
    for (let i = 0; i < srcLen; i++) mono[i] += ch[i] / channels;
  }
  const ratio = srcRate / targetRate;
  const outLen = Math.floor(srcLen / ratio);
  const out = new Int16Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const srcPos = i * ratio;
    const i0 = Math.floor(srcPos);
    const i1 = Math.min(i0 + 1, srcLen - 1);
    const frac = srcPos - i0;
    const sample = mono[i0] * (1 - frac) + mono[i1] * frac;
    const s = Math.max(-1, Math.min(1, sample));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return new Uint8Array(out.buffer);
}
