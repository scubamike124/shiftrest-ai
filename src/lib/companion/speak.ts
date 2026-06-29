// Centralized Companion TTS gate.
//
// Every Companion TTS playback funnels through speak() / speakQueued().
// They enforce:
//   1. voiceRepliesEnabled (per-device pref)
//   2. quietHours (per-device pref)
//   3. cancel-prior policy — a newer turn supersedes any in-flight one.
//
// Audio pipeline (built ONCE, never rewired):
//   <audio>  →  MediaElementSource  →  Gain (loudness boost)
//                                    →  DynamicsCompressor (soft limit)
//                                    →  destination + Analyser (lip-sync)
//
// All chunks of every turn (greeting AND replies) share this exact
// pipeline, so perceived loudness is identical across the session.

import { supabase } from "@/integrations/supabase/client";
import { inQuietHours } from "./quiet-hours";
import { loadLocalPrefs } from "./voice-action-prefs";
import { track } from "./analytics";
import { isQuietModeOn } from "@/lib/quiet-mode";
import { normalizeForSpeech } from "./speech-normalize";
import { getTtsProvider, getElevenVoice, setTtsProvider } from "./renderer-pref";

// Session-level kill switch — if ElevenLabs errors once, fall back to
// OpenAI for the rest of the session so the user is never stranded silent.
let elevenLabsBlocked = false;

// Hard env flag: only allow ElevenLabs at all when explicitly enabled.
// Default OFF — the streamless MP3 path stalls on iPhone Safari and
// produces 1-2 s gaps between sentences. Re-enable per-build via
// VITE_COMPANION_ELEVENLABS=on once true streaming is wired.
const ELEVENLABS_FLAG_ON =
  typeof import.meta !== "undefined" &&
  ((import.meta as unknown as { env?: Record<string, string | undefined> }).env
    ?.VITE_COMPANION_ELEVENLABS ?? "off") === "on";

// Per-session: warm the output device only on the first utterance.
// Re-running warmOutputDevice() before every chunk added perceptible latency
// between sentences on iOS Safari (the "stutter" symptom).
let outputWarmed = false;

let audioUnlocked = false;
function markAudioUnlocked() {
  if (audioUnlocked) return;
  audioUnlocked = true;
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("companion:voice-unlocked"));
  }
}

let currentAudio: HTMLAudioElement | null = null;
let currentUrl: string | null = null;
let lastReqId = 0;
let primedAudio: HTMLAudioElement | null = null;

const SILENT_WAV =
  "data:audio/wav;base64,UklGRkQDAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YSADAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==";

/**
 * Best-effort iOS/Safari audio unlock. Call synchronously inside a user tap
 * before the async STT → AI → TTS chain so the later assistant reply can play.
 */
export function prepareVoicePlayback(): void {
  if (typeof window === "undefined") return;
  try {
    ensureAudioGraph();
    if (levelCtx && levelCtx.state === "suspended") {
      void levelCtx.resume().catch(() => undefined);
    }
    if (!primedAudio) {
      primedAudio = new Audio();
      primedAudio.preload = "auto";
      primedAudio.setAttribute("playsinline", "true");
      primedAudio.crossOrigin = "anonymous";
    }
    // Wire the primed element into the graph ONCE under the gesture so the
    // very first reply already routes through Gain → Compressor.
    wireElementIntoGraph(primedAudio);
    const audio = primedAudio;
    audio.src = SILENT_WAV;
    audio.volume = 0;
    void audio
      .play()
      .then(() => {
        if (audio.src === SILENT_WAV || audio.currentSrc === SILENT_WAV) {
          audio.pause();
          audio.currentTime = 0;
        }
        audio.volume = 1;
        markAudioUnlocked();
      })
      .catch(() => {
        audio.volume = 1;
      });
  } catch {
    /* best effort only */
  }
}

/** Awaitable resume of the shared AudioContext. Prevents the "quiet first
 *  seconds" symptom on iOS Safari where audio.play() resolves before the
 *  context has actually resumed and the graph is still silent. */
async function ensureContextRunning(): Promise<void> {
  if (!ensureAudioGraph() || !levelCtx) return;
  if (levelCtx.state === "running") return;
  try { await levelCtx.resume(); } catch { /* best effort */ }
}

// ── Voice status events ────────────────────────────────────────────────
type VoiceStatus = "started" | "ended" | "failed" | "skipped";
function emitStatus(status: VoiceStatus, reason?: string) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent("companion:voice-status", { detail: { status, reason } }),
  );
}
function emitTurnEnded() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("companion:turn-ended"));
}

// ── Sequential turn queue ──────────────────────────────────────────────
let turnId = 0;
type QueueItem = { text: string; opts: SpeakOptions; turn: number };
const queue: QueueItem[] = [];
let draining = false;


// ── Audio graph (built ONCE, never re-wired) ─────────────────────────
// Final chain:  source → Gain → WaveShaper (stateless soft-clip) →
//               destination + Analyser (lip-sync taps off the shaper).
// We deliberately do NOT use a DynamicsCompressor in the live path: its
// internal envelope starts cold and pumps gain up over the first ~300 ms,
// which produces the "quiet greeting → loud reply" curve on iOS Safari.
// A WaveShaper is stateless, so the first sample is already at final loudness.
let levelCtx: AudioContext | null = null;
let levelAnalyser: AnalyserNode | null = null;
let levelGain: GainNode | null = null;
let levelShaper: WaveShaperNode | null = null;
let levelMakeup: GainNode | null = null;
let graphWired = false;
let levelRaf = 0;
const sourcedAudios = new WeakSet<HTMLAudioElement>();

// Pre-shaper drive — pushes the soft-clip into useful range.
const VOICE_GAIN = 2.3;
// Post-shaper makeup — recovers headroom lost to the soft-clip ceiling.
// Combined effective gain ≈ 2.3 × 1.3 = ~3.0 before tanh rounding.
const VOICE_MAKEUP = 1.3;

function buildSoftClipCurve(samples = 2048): Float32Array {
  // tanh-shaped soft clip. Linear at low levels, rounds gently toward ±1.0.
  const ab = new ArrayBuffer(samples * 4);
  const curve = new Float32Array(ab);
  const k = 1.4;
  for (let i = 0; i < samples; i++) {
    const x = (i / (samples - 1)) * 2 - 1;
    curve[i] = Math.tanh(k * x) / Math.tanh(k);
  }
  return curve;
}

async function warmOutputDevice(): Promise<void> {
  // Push ~40 ms of near-silent buffer through the graph so the OS audio
  // device is already running when the TTS blob's first sample arrives.
  // Prevents iOS Safari from swallowing the first ~100 ms.
  if (!levelCtx || !levelGain) return;
  try {
    const ctx = levelCtx;
    const frames = Math.max(1, Math.floor(ctx.sampleRate * 0.04));
    const buf = ctx.createBuffer(1, frames, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < frames; i++) data[i] = (Math.random() - 0.5) * 1e-4;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(levelGain);
    src.start();
  } catch { /* best-effort */ }
}

function ensureAudioGraph(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const AC: typeof AudioContext | undefined =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return false;
    if (!levelCtx) levelCtx = new AC();
    if (levelCtx.state === "suspended") levelCtx.resume().catch(() => undefined);
    if (!levelGain) {
      levelGain = levelCtx.createGain();
      levelGain.gain.value = VOICE_GAIN;
    }
    if (!levelShaper) {
      levelShaper = levelCtx.createWaveShaper();
      (levelShaper as unknown as { curve: Float32Array }).curve = buildSoftClipCurve();
      levelShaper.oversample = "2x";
    }
    if (!levelMakeup) {
      levelMakeup = levelCtx.createGain();
      levelMakeup.gain.value = VOICE_MAKEUP;
    }
    if (!levelAnalyser) {
      levelAnalyser = levelCtx.createAnalyser();
      levelAnalyser.fftSize = 256;
      levelAnalyser.smoothingTimeConstant = 0.25;
    }
    if (!graphWired) {
      // source → Gain → WaveShaper → MakeupGain → destination + Analyser
      levelGain.connect(levelShaper);
      levelShaper.connect(levelMakeup);
      levelMakeup.connect(levelCtx.destination);
      levelMakeup.connect(levelAnalyser);
      graphWired = true;
    }
    return true;
  } catch {
    return false;
  }
}


function wireElementIntoGraph(audio: HTMLAudioElement): void {
  if (!ensureAudioGraph() || !levelCtx || !levelGain) return;
  if (sourcedAudios.has(audio)) return;
  try {
    const src = levelCtx.createMediaElementSource(audio);
    src.connect(levelGain);
    sourcedAudios.add(audio);
  } catch {
    /* element may already be sourced in another context — best effort */
  }
}

function emitLevel(rms: number) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("companion:audio-level", { detail: { rms } }));
}

// Pass 5 — peak detector. Rolling average; emit `companion:audio-peak`
// when the current sample exceeds avg * 1.6 for ≥80ms.
let peakAvg = 0;
let peakAbove = 0;
let lastPeak = 0;
function pushPeakSample(rms: number, nowMs: number) {
  peakAvg = peakAvg * 0.92 + rms * 0.08;
  if (rms > peakAvg * 1.6 && rms > 0.04) {
    peakAbove += 16; // approx rAF tick
    if (peakAbove >= 80 && nowMs - lastPeak > 350) {
      lastPeak = nowMs;
      peakAbove = 0;
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("companion:audio-peak", { detail: { rms } }));
      }
    }
  } else {
    peakAbove = 0;
  }
}

function startLevelMeter(audio: HTMLAudioElement) {
  if (typeof window === "undefined" || !levelAnalyser) return;
  const analyser = levelAnalyser;
  const buf = new Uint8Array(analyser.fftSize);
  if (levelRaf) cancelAnimationFrame(levelRaf);
  const tick = () => {
    if (currentAudio !== audio || audio.paused || audio.ended) {
      emitLevel(0);
      levelRaf = 0;
      return;
    }
    analyser.getByteTimeDomainData(buf);
    let sum = 0;
    for (let i = 0; i < buf.length; i++) {
      const v = (buf[i] - 128) / 128;
      sum += v * v;
    }
    const rms = Math.sqrt(sum / buf.length);
    emitLevel(rms);
    pushPeakSample(rms, performance.now());
    levelRaf = requestAnimationFrame(tick);
  };
  levelRaf = requestAnimationFrame(tick);
}

function stopLevelMeter() {
  if (levelRaf) {
    cancelAnimationFrame(levelRaf);
    levelRaf = 0;
  }
  peakAvg = 0;
  peakAbove = 0;
  emitLevel(0);
}

export type SpeakOptions = {
  voice?: string | null;
  source?: "assistant_reply" | "action_narration" | "manual";
  /** Pass 2 — pacing/timbre preset. Defaults to "normal".
   *  Sleep mode picks "sleep" automatically when companionMode === "sleep". */
  mode?: "normal" | "sleep" | "encouraging" | "thinking";
};

export function stopSpeaking(): void {
  lastReqId += 1;
  turnId += 1;
  queue.length = 0;
  try {
    currentAudio?.pause();
  } catch {
    /* noop */
  }
  if (currentUrl) {
    URL.revokeObjectURL(currentUrl);
    currentUrl = null;
  }
  currentAudio = null;
  stopLevelMeter();
  emitStatus("ended");
}

export function beginSpeakTurn(): number {
  stopSpeaking();
  return ++turnId;
}

export async function speak(text: string, opts: SpeakOptions = {}): Promise<void> {
  if (typeof window === "undefined") return;
  const t = text?.trim();
  if (!t) {
    track({ event: "voice_skipped", reason: "empty" });
    emitStatus("skipped", "empty");
    emitTurnEnded();
    return;
  }
  const prefs = loadLocalPrefs();
  if (!prefs.voiceRepliesEnabled) {
    track({ event: "voice_skipped", reason: "disabled" });
    emitStatus("skipped", "disabled");
    emitTurnEnded();
    return;
  }
  if (inQuietHours(prefs.quietHours) || isQuietModeOn()) {
    track({ event: "voice_skipped", reason: "quiet_hours" });
    emitStatus("skipped", "quiet_hours");
    emitTurnEnded();
    return;
  }

  const myId = ++lastReqId;
  try {
    await playOnce(t, opts, () => myId === lastReqId);
  } catch {
    track({ event: "voice_skipped", reason: "tts_error" });
    emitStatus("failed", "tts_error");
  }
  emitTurnEnded();
}

export function speakQueued(text: string, opts: SpeakOptions = {}): void {
  if (typeof window === "undefined") return;
  const t = text?.trim();
  if (!t) return;
  const prefs = loadLocalPrefs();
  if (!prefs.voiceRepliesEnabled) {
    emitStatus("skipped", "disabled");
    return;
  }
  if (inQuietHours(prefs.quietHours) || isQuietModeOn()) {
    emitStatus("skipped", "quiet_hours");
    return;
  }
  const myTurn = turnId || ++turnId;
  queue.push({ text: t, opts, turn: myTurn });
  if (!draining) void drainQueue();
}

async function drainQueue(): Promise<void> {
  draining = true;
  try {
    while (queue.length > 0) {
      const next = queue.shift()!;
      if (next.turn !== turnId) continue;
      const prefs = loadLocalPrefs();
      if (!prefs.voiceRepliesEnabled) {
        emitStatus("skipped", "disabled");
        continue;
      }
      if (inQuietHours(prefs.quietHours) || isQuietModeOn()) {
        emitStatus("skipped", "quiet_hours");
        continue;
      }
      try {
        await playOnce(next.text, next.opts, () => next.turn === turnId);
      } catch {
        track({ event: "voice_skipped", reason: "tts_error" });
        emitStatus("failed", "tts_error");
      }
    }
  } finally {
    draining = false;
    emitTurnEnded();
  }
}

async function playOnce(
  text: string,
  opts: SpeakOptions,
  stillValid: () => boolean,
): Promise<void> {
  const prefs = loadLocalPrefs();
  const mode = opts.mode ?? (prefs.companionMode === "sleep" ? "sleep" : "normal");
  const spoken = normalizeForSpeech(text, mode === "sleep" ? "sleep" : "normal");
  // Pass 1 — let the Avatar pre-compute the viseme sequence for this chunk.
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent("companion:speaking-text", { detail: { text: spoken, mode } }),
    );
  }
  const { data: sess } = await supabase.auth.getSession();
  const token = sess.session?.access_token;
  const wantEleven =
    ELEVENLABS_FLAG_ON && !elevenLabsBlocked && getTtsProvider() === "elevenlabs";
  const provider = wantEleven ? "elevenlabs" : "openai";
  const endpoint = provider === "elevenlabs" ? "/api/tts-elevenlabs" : "/api/tts";
  const voice = provider === "elevenlabs" ? (opts.voice ?? getElevenVoice()) : (opts.voice ?? undefined);

  // 2.5 s first-byte timeout for ElevenLabs (the slow path). If headers
  // don't arrive in time, abort and fall through to OpenAI for this session.
  const ctrl = provider === "elevenlabs" ? new AbortController() : null;
  const stallTimer = ctrl
    ? setTimeout(() => { try { ctrl.abort(); } catch { /* noop */ } }, 2500)
    : null;
  let resp: Response;
  try {
    resp = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ text: spoken, voice, mode }),
      signal: ctrl?.signal,
    });
  } catch (_err) {
    if (provider === "elevenlabs") {
      console.warn("[speak] ElevenLabs stalled, falling back to OpenAI for this session");
      elevenLabsBlocked = true;
      try { setTtsProvider("openai"); } catch { /* noop */ }
      resp = await fetch("/api/tts", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ text: spoken, voice: opts.voice ?? undefined, mode }),
      });
    } else {
      throw _err;
    }
  } finally {
    if (stallTimer) clearTimeout(stallTimer);
  }
  // Provider-specific failure → fall back to OpenAI for the rest of the session.
  if (provider === "elevenlabs" && !resp.ok) {
    console.warn("[speak] ElevenLabs failed, falling back to OpenAI for this session");
    elevenLabsBlocked = true;
    try { setTtsProvider("openai"); } catch { /* noop */ }
    resp = await fetch("/api/tts", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ text: spoken, voice: opts.voice ?? undefined, mode }),
    });
  }
  if (!resp.ok) {
    track({ event: "voice_skipped", reason: "tts_error" });
    emitStatus("failed", "tts_error");
    return;
  }
  if (!stillValid()) {
    track({ event: "voice_skipped", reason: "superseded" });
    return;
  }
  const blob = await resp.blob();
  if (!stillValid()) {
    track({ event: "voice_skipped", reason: "superseded" });
    return;
  }
  try { currentAudio?.pause(); } catch { /* noop */ }
  if (currentUrl) URL.revokeObjectURL(currentUrl);

  // Always reuse the primed element so the MediaElementSource is wired
  // exactly once. This guarantees every utterance — greeting and every
  // reply chunk — flows through the same Gain + Compressor.
  ensureAudioGraph();
  if (!primedAudio) {
    primedAudio = new Audio();
    primedAudio.preload = "auto";
    primedAudio.setAttribute("playsinline", "true");
    primedAudio.crossOrigin = "anonymous";
  }
  wireElementIntoGraph(primedAudio);
  const audio = primedAudio;
  audio.preload = "auto";
  audio.setAttribute("playsinline", "true");
  audio.volume = 1;
  const url = URL.createObjectURL(blob);
  audio.src = url;
  currentAudio = audio;
  currentUrl = url;
  track({ event: "voice_played", chars: text.length });
  emitStatus("started");

  // Make sure the shared AudioContext is actually running before play()
  // resolves; on iOS Safari `audio.play()` can return while the context is
  // still "suspended", which makes the first few hundred ms silent.
  await ensureContextRunning();
  // Warm the output device ONLY for the first utterance of the session.
  // Re-warming before every chunk added ~50 ms latency between sentences,
  // which presented as stuttering on iPhone Safari.
  if (!outputWarmed) {
    await warmOutputDevice();
    outputWarmed = true;
  }

  await new Promise<void>((resolve) => {
    audio.onended = () => {
      if (currentUrl === url) {
        URL.revokeObjectURL(url);
        currentUrl = null;
        currentAudio = null;
      }
      stopLevelMeter();
      emitStatus("ended");
      resolve();
    };
    audio.onerror = () => {
      stopLevelMeter();
      emitStatus("failed", "playback_error");
      resolve();
    };
    audio.onpause = () => {
      if (currentAudio === audio) stopLevelMeter();
    };
    audio.play().then(async () => {
      markAudioUnlocked();
      // Belt-and-braces: if the context flipped back to suspended between
      // ensureContextRunning() and play(), force it back to running.
      if (levelCtx && levelCtx.state !== "running") {
        try { await levelCtx.resume(); } catch { /* noop */ }
      }
      startLevelMeter(audio);
    }).catch(() => {
      if (audioUnlocked) {
        emitStatus("failed", "playback_error");
      } else {
        emitStatus("failed", "autoplay_blocked");
      }
      resolve();
    });
  });
}
