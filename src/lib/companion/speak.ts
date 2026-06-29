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
      levelCtx.resume().catch(() => undefined);
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
let levelCtx: AudioContext | null = null;
let levelAnalyser: AnalyserNode | null = null;
let levelGain: GainNode | null = null;
let levelCompressor: DynamicsCompressorNode | null = null;
let graphWired = false;
let levelRaf = 0;
const sourcedAudios = new WeakSet<HTMLAudioElement>();

const VOICE_GAIN = 2.2;

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
    if (!levelCompressor) {
      levelCompressor = levelCtx.createDynamicsCompressor();
      try {
        // Softer compressor — only catches true peaks, no pumping.
        levelCompressor.threshold.value = -12;
        levelCompressor.knee.value = 18;
        levelCompressor.ratio.value = 2;
        levelCompressor.attack.value = 0.006;
        levelCompressor.release.value = 0.22;
      } catch { /* noop */ }
    }
    if (!levelAnalyser) {
      levelAnalyser = levelCtx.createAnalyser();
      levelAnalyser.fftSize = 256;
      levelAnalyser.smoothingTimeConstant = 0.25;
    }
    if (!graphWired) {
      // Wire once. Subsequent calls are no-ops so we never tear down the
      // graph mid-playback (which caused pumping / quieter replies).
      levelGain.connect(levelCompressor);
      levelCompressor.connect(levelCtx.destination);
      levelCompressor.connect(levelAnalyser);
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
  const resp = await fetch("/api/tts", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ text: spoken, voice: opts.voice ?? undefined, mode }),
  });
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
    audio.play().then(() => {
      markAudioUnlocked();
      startLevelMeter(audio);
    }).catch(() => {
      if (audioUnlocked) {
        // Already past the iOS unlock — treat as transient and don't re-warn.
        emitStatus("failed", "playback_error");
      } else {
        emitStatus("failed", "autoplay_blocked");
      }
      resolve();
    });
  });
}
