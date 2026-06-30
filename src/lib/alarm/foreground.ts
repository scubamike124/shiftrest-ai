// Foreground alarm fallback.
//
// Background push notifications require an installed PWA + granted
// permission. As a reliable last-mile fallback, while the app tab is
// open we schedule setTimeout()s for upcoming alarms and ring an
// audible chime + speak the alarm label at fire time.
//
// Long-horizon alarms (e.g. "tomorrow 7am" scheduled tonight at 10pm)
// exceed the browser's per-timer limit (~24.8d) AND the practical
// reliability of any single setTimeout. We chain intermediate hops so
// each individual timer stays inside MAX_HOP_MS, then arm the real
// fire timer when we land inside the safe window.
//
// All scheduling is local to the tab. Safe to call repeatedly — the
// scheduler de-dupes by alarm id.

import { speakQueued, prepareVoicePlayback } from "@/lib/companion/speak";
import { loadAlarmPrefs, vibrateSupported } from "./prefs";
import { startAlarmSound, type AlarmSoundId } from "./sounds";

type AlarmInput = { id: string; firesAt: number; label?: string };

type Entry = {
  firesAt: number;
  label?: string;
  timer: ReturnType<typeof setTimeout>;
  /** Total number of intermediate hops armed before the final fire timer. */
  rearmCount: number;
  /** When the currently-armed timer is expected to wake. */
  nextHopAt: number;
};

const entries = new Map<string, Entry>();
let ringingCtx: AudioContext | null = null;
let ringingStop: (() => void) | null = null;
let ringingVibrate: ReturnType<typeof setInterval> | null = null;

// Per-hop ceiling. Browsers clamp setTimeout to ~24.8 days; keep ours
// well under that and short enough that throttled tabs still service
// the hop within a reasonable wall-clock window.
const MAX_HOP_MS = 6 * 60 * 60 * 1000; // 6h
const HOP_LEAD_MS = 60_000; // re-arm 60s before the hop limit
const MIN_FIRE_LEAD_MS = 250;

function debugEnabled(): boolean {
  try {
    return typeof window !== "undefined" && window.localStorage.getItem("restpilot:debug-alarm") === "1";
  } catch {
    return false;
  }
}

function log(event: string, payload: Record<string, unknown>): void {
  if (!debugEnabled()) return;
  try {
    // eslint-disable-next-line no-console
    console.log(`[alarm] ${event}`, payload);
  } catch { /* noop */ }
}

function armEntry(id: string, firesAt: number, label?: string, rearmCount = 0): void {
  const existing = entries.get(id);
  if (existing) clearTimeout(existing.timer);

  const now = Date.now();
  const delay = firesAt - now;

  if (delay <= MIN_FIRE_LEAD_MS) {
    // In the past or imminent — fire ASAP.
    const timer = setTimeout(() => {
      entries.delete(id);
      log("fired", { id, label, scheduledAt: firesAt, actualAt: Date.now(), rearmCount });
      fireAlarm(label, firesAt);
    }, Math.max(0, delay));
    entries.set(id, { firesAt, label, timer, rearmCount, nextHopAt: now + Math.max(0, delay) });
    log("scheduled", { id, label, firesAt, delayMs: Math.max(0, delay), mode: "direct", rearmCount });
    return;
  }

  if (delay <= MAX_HOP_MS) {
    const timer = setTimeout(() => {
      entries.delete(id);
      log("fired", { id, label, scheduledAt: firesAt, actualAt: Date.now(), rearmCount });
      fireAlarm(label, firesAt);
    }, delay);
    entries.set(id, { firesAt, label, timer, rearmCount, nextHopAt: firesAt });
    log("scheduled", { id, label, firesAt, delayMs: delay, mode: "direct", rearmCount });
    return;
  }

  // Long-horizon: hop forward, then re-arm.
  const hopDelay = MAX_HOP_MS - HOP_LEAD_MS;
  const hopAt = now + hopDelay;
  const timer = setTimeout(() => {
    // Re-arm — entry still represents the same final firesAt.
    log("re-armed", { id, label, firesAt, hopAt: Date.now(), rearmCount: rearmCount + 1 });
    armEntry(id, firesAt, label, rearmCount + 1);
  }, hopDelay);
  entries.set(id, { firesAt, label, timer, rearmCount, nextHopAt: hopAt });
  log("scheduled", { id, label, firesAt, delayMs: hopDelay, mode: "re-arm", rearmCount, hopAt });
}

export function syncAlarms(alarms: AlarmInput[]): void {
  const wanted = new Set<string>();
  for (const a of alarms) {
    wanted.add(a.id);
    armEntry(a.id, a.firesAt, a.label);
  }
  for (const [id, e] of entries) {
    if (!wanted.has(id)) {
      clearTimeout(e.timer);
      entries.delete(id);
      log("skipped", { id, reason: "cancelled-by-sync" });
    }
  }
}

export function addAlarm(alarm: AlarmInput): void {
  armEntry(alarm.id, alarm.firesAt, alarm.label);
}

export function cancelAlarm(id: string): void {
  const e = entries.get(id);
  if (e) {
    clearTimeout(e.timer);
    entries.delete(id);
    log("skipped", { id, reason: "cancelled" });
  }
}

/** Snapshot of currently-armed alarms — for QA/debug surfaces. */
export function listScheduled(): Array<{
  id: string;
  firesAt: number;
  nextHopAt: number;
  rearmCount: number;
  label?: string;
}> {
  return Array.from(entries.entries()).map(([id, e]) => ({
    id,
    firesAt: e.firesAt,
    nextHopAt: e.nextHopAt,
    rearmCount: e.rearmCount,
    label: e.label,
  }));
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
  armEntry(id, Date.now() + seconds * 1000, label);
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

function fireAlarm(label?: string, scheduledAt?: number): void {
  const prefs = loadAlarmPrefs();
  try {
    window.dispatchEvent(new CustomEvent("alarm:fired", {
      detail: { label, at: Date.now(), scheduledAt },
    }));
  } catch { /* noop */ }
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
