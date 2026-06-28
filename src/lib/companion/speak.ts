// Slice 10 — Centralized voice gate.
//
// Every Companion TTS playback funnels through speak(). It enforces:
//   1. voiceRepliesEnabled (per-device pref)
//   2. quietHours (per-device pref)
//   3. cancel-prior policy — a newer request supersedes any in-flight one so
//      narration never overlaps assistant replies.
//
// Pure best-effort — TTS failures never throw. Analytics events are emitted
// for each gate decision so we can measure voice usage.

import { supabase } from "@/integrations/supabase/client";
import { inQuietHours } from "./quiet-hours";
import { loadLocalPrefs } from "./voice-action-prefs";
import { track } from "./analytics";
import { isQuietModeOn } from "@/lib/quiet-mode";

let currentAudio: HTMLAudioElement | null = null;
let currentUrl: string | null = null;
let lastReqId = 0;

// ── Amplitude-based lip-sync ──────────────────────────────────────────────
// One shared AudioContext + AnalyserNode. We re-use a MediaElementSource per
// audio element (each element can only be source'd once). RAF dispatches a
// `companion:audio-level` CustomEvent with { rms } the Avatar listens for.
let levelCtx: AudioContext | null = null;
let levelAnalyser: AnalyserNode | null = null;
let levelRaf = 0;
const sourcedAudios = new WeakSet<HTMLAudioElement>();

function emitLevel(rms: number) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("companion:audio-level", { detail: { rms } }));
}

function startLevelMeter(audio: HTMLAudioElement) {
  if (typeof window === "undefined") return;
  try {
    const AC: typeof AudioContext | undefined =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    if (!levelCtx) levelCtx = new AC();
    if (levelCtx.state === "suspended") levelCtx.resume().catch(() => undefined);
    if (!levelAnalyser) {
      levelAnalyser = levelCtx.createAnalyser();
      levelAnalyser.fftSize = 512;
      levelAnalyser.smoothingTimeConstant = 0.6;
      levelAnalyser.connect(levelCtx.destination);
    }
    if (!sourcedAudios.has(audio)) {
      const src = levelCtx.createMediaElementSource(audio);
      src.connect(levelAnalyser);
      sourcedAudios.add(audio);
    }
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
      levelRaf = requestAnimationFrame(tick);
    };
    levelRaf = requestAnimationFrame(tick);
  } catch {
    /* lip-sync is best-effort; silently drop on failure */
  }
}

function stopLevelMeter() {
  if (levelRaf) {
    cancelAnimationFrame(levelRaf);
    levelRaf = 0;
  }
  emitLevel(0);
}

export type SpeakOptions = {
  /** Optional voice id from server-side prefs (forwarded to /api/tts). */
  voice?: string | null;
  /** Used by analytics + future per-source routing. */
  source?: "assistant_reply" | "action_narration" | "manual";
};

export function stopSpeaking(): void {
  lastReqId += 1; // invalidate any pending fetch
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
}

export async function speak(text: string, opts: SpeakOptions = {}): Promise<void> {
  if (typeof window === "undefined") return;
  const t = text?.trim();
  if (!t) {
    track({ event: "voice_skipped", reason: "empty" });
    return;
  }
  const prefs = loadLocalPrefs();
  if (!prefs.voiceRepliesEnabled) {
    track({ event: "voice_skipped", reason: "disabled" });
    return;
  }
  if (inQuietHours(prefs.quietHours) || isQuietModeOn()) {
    track({ event: "voice_skipped", reason: "quiet_hours" });
    return;
  }

  const myId = ++lastReqId;
  try {
    const { data: sess } = await supabase.auth.getSession();
    const token = sess.session?.access_token;
    const resp = await fetch("/api/tts", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ text: t, voice: opts.voice ?? undefined }),
    });
    if (!resp.ok) {
      track({ event: "voice_skipped", reason: "tts_error" });
      return;
    }
    if (myId !== lastReqId) {
      track({ event: "voice_skipped", reason: "superseded" });
      return;
    }
    const blob = await resp.blob();
    if (myId !== lastReqId) {
      track({ event: "voice_skipped", reason: "superseded" });
      return;
    }
    // Cancel anything currently playing (cancel-prior policy).
    try {
      currentAudio?.pause();
    } catch {
      /* noop */
    }
    if (currentUrl) URL.revokeObjectURL(currentUrl);

    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    currentAudio = audio;
    currentUrl = url;
    audio.onended = () => {
      if (currentUrl === url) {
        URL.revokeObjectURL(url);
        currentUrl = null;
        currentAudio = null;
      }
    };
    track({ event: "voice_played", chars: t.length });
    await audio.play().catch(() => undefined);
  } catch {
    track({ event: "voice_skipped", reason: "tts_error" });
  }
}
