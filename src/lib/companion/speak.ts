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
