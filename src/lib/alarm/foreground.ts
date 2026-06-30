// Foreground alarm fallback.
//
// Background push notifications require an installed PWA + granted
// permission. As a reliable last-mile fallback, while the app tab is
// open we schedule setTimeout()s for upcoming alarms and ring an
// audible chime + speak the alarm label at fire time.
//
// All scheduling is local to the tab. Safe to call repeatedly — the
// scheduler de-dupes by alarm id.

import { speakQueued, prepareVoicePlayback } from "@/lib/companion/speak";
import { loadAlarmPrefs, vibrateSupported } from "./prefs";
import { startAlarmSound, type AlarmSoundId } from "./sounds";

type AlarmInput = { id: string; firesAt: number; label?: string };

const timers = new Map<string, ReturnType<typeof setTimeout>>();
let ringingCtx: AudioContext | null = null;
let ringingStop: (() => void) | null = null;
let ringingVibrate: ReturnType<typeof setInterval> | null = null;

// setTimeout in browsers clamps to ~24.8 days; keep ours conservative.
const MAX_DELAY_MS = 6 * 60 * 60 * 1000; // 6h
const MIN_FIRE_LEAD_MS = 250;

export function syncAlarms(alarms: AlarmInput[]): void {
  const wanted = new Set<string>();
  for (const a of alarms) {
    wanted.add(a.id);
    const existing = timers.get(a.id);
    const delay = Math.max(MIN_FIRE_LEAD_MS, a.firesAt - Date.now());
    if (delay > MAX_DELAY_MS) {
      if (existing) {
        clearTimeout(existing);
        timers.delete(a.id);
      }
      continue;
    }
    if (existing) clearTimeout(existing);
    const t = setTimeout(() => {
      timers.delete(a.id);
      fireAlarm(a.label);
    }, delay);
    timers.set(a.id, t);
  }
  for (const [id, t] of timers) {
    if (!wanted.has(id)) {
      clearTimeout(t);
      timers.delete(id);
    }
  }
}

export function addAlarm(alarm: AlarmInput): void {
  const existing = timers.get(alarm.id);
  const delay = Math.max(MIN_FIRE_LEAD_MS, alarm.firesAt - Date.now());
  if (delay > MAX_DELAY_MS) {
    if (existing) {
      clearTimeout(existing);
      timers.delete(alarm.id);
    }
    return;
  }
  if (existing) clearTimeout(existing);
  const t = setTimeout(() => {
    timers.delete(alarm.id);
    fireAlarm(alarm.label);
  }, delay);
  timers.set(alarm.id, t);
}

export function cancelAlarm(id: string): void {
  const t = timers.get(id);
  if (t) {
    clearTimeout(t);
    timers.delete(id);
  }
}

export function stopRinging(): void {
  if (ringingStop) {
    try { ringingStop(); } catch { /* noop */ }
    ringingStop = null;
  }
  if (ringingCtx) {
    try { void ringingCtx.close(); } catch { /* noop */ }
    ringingCtx = null;
  }
  if (ringingVibrate) {
    clearInterval(ringingVibrate);
    ringingVibrate = null;
  }
  if (vibrateSupported()) {
    try { navigator.vibrate(0); } catch { /* noop */ }
  }
}

export function testAlarm(seconds = 10, label = "Test alarm"): void {
  prepareVoicePlayback();
  const id = `__test_${Date.now()}`;
  const t = setTimeout(() => {
    timers.delete(id);
    fireAlarm(label);
  }, seconds * 1000);
  timers.set(id, t);
}

/** Preview a single alarm sound at the given volume (0–100). Returns a stop fn. */
export function previewAlarmSound(soundId: AlarmSoundId, volume: number): () => void {
  stopRinging();
  try {
    const AC: typeof AudioContext =
      (window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext ??
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new AC();
    ringingCtx = ctx;
    if (ctx.state === "suspended") void ctx.resume();
    const master = ctx.createGain();
    master.gain.value = Math.max(0, Math.min(1, volume / 100));
    master.connect(ctx.destination);
    const stop = startAlarmSound(soundId, ctx, master);
    ringingStop = stop;
    // Auto-stop preview after 6s.
    const auto = setTimeout(stopRinging, 6000);
    return () => { clearTimeout(auto); stopRinging(); };
  } catch {
    return () => { /* noop */ };
  }
}

function fireAlarm(label?: string): void {
  const prefs = loadAlarmPrefs();
  startChime(prefs.sound, prefs.volume, prefs.fadeInSec);
  if (prefs.vibrate && vibrateSupported()) {
    try {
      const pattern = [400, 200, 400, 200, 600];
      navigator.vibrate(pattern);
      // Re-fire vibration every 2s while ringing.
      ringingVibrate = setInterval(() => {
        try { navigator.vibrate(pattern); } catch { /* noop */ }
      }, 2200);
    } catch { /* noop */ }
  }
  try {
    const msg = label ? `Alarm. ${label}.` : "Alarm.";
    speakQueued(msg, { mode: "normal" });
  } catch {
    /* noop */
  }
  // Auto-stop after 60s so it never rings forever.
  setTimeout(stopRinging, 60_000);
}

function startChime(soundId: AlarmSoundId, volume: number, fadeInSec: number): void {
  stopRinging();
  try {
    const AC: typeof AudioContext =
      (window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext ??
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new AC();
    ringingCtx = ctx;
    if (ctx.state === "suspended") void ctx.resume();

    const target = Math.max(0, Math.min(1, volume / 100));
    const master = ctx.createGain();
    master.connect(ctx.destination);

    if (fadeInSec > 0) {
      master.gain.setValueAtTime(0.0001, ctx.currentTime);
      master.gain.linearRampToValueAtTime(target, ctx.currentTime + fadeInSec);
    } else {
      master.gain.setValueAtTime(target, ctx.currentTime);
    }

    const stop = startAlarmSound(soundId, ctx, master);
    ringingStop = stop;
  } catch {
    ringingStop = null;
  }
}
