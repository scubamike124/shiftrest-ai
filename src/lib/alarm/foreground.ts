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

type AlarmInput = { id: string; firesAt: number; label?: string };

const timers = new Map<string, ReturnType<typeof setTimeout>>();
let ringingCtx: AudioContext | null = null;
let ringingStop: (() => void) | null = null;

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
      // Out of foreground window — leave to push.
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
  // Clear any timers no longer wanted.
  for (const [id, t] of timers) {
    if (!wanted.has(id)) {
      clearTimeout(t);
      timers.delete(id);
    }
  }
}

/** Add or refresh a single alarm without clearing other scheduled timers. */
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

function fireAlarm(label?: string): void {
  startChime();
  try {
    const msg = label ? `Alarm. ${label}.` : "Alarm.";
    speakQueued(msg, { mode: "normal" });
  } catch {
    /* noop */
  }
  // Auto-stop after 60s so it never rings forever.
  setTimeout(stopRinging, 60_000);
}

function startChime(): void {
  stopRinging();
  try {
    const AC: typeof AudioContext =
      (window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext ??
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new AC();
    ringingCtx = ctx;
    if (ctx.state === "suspended") void ctx.resume();

    const master = ctx.createGain();
    master.gain.value = 0.0;
    master.connect(ctx.destination);

    const playBeep = (when: number, freq: number, dur: number) => {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      g.gain.setValueAtTime(0, when);
      g.gain.linearRampToValueAtTime(0.55, when + 0.02);
      g.gain.linearRampToValueAtTime(0, when + dur);
      osc.connect(g).connect(master);
      osc.start(when);
      osc.stop(when + dur + 0.05);
    };

    let stopped = false;
    const scheduleBurst = (t0: number) => {
      // Three rising beeps per burst.
      playBeep(t0 + 0.00, 880, 0.18);
      playBeep(t0 + 0.22, 988, 0.18);
      playBeep(t0 + 0.44, 1175, 0.30);
    };

    master.gain.linearRampToValueAtTime(0.9, ctx.currentTime + 0.05);
    scheduleBurst(ctx.currentTime + 0.05);
    const interval = setInterval(() => {
      if (stopped) return;
      scheduleBurst(ctx.currentTime + 0.02);
    }, 1500);

    ringingStop = () => {
      stopped = true;
      clearInterval(interval);
      try {
        master.gain.cancelScheduledValues(ctx.currentTime);
        master.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.1);
      } catch { /* noop */ }
    };
  } catch {
    ringingStop = null;
  }
}
