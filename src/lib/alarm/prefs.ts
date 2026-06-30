// Local-only alarm preferences (sound, volume, fade-in, vibrate, snooze).
// Stored in localStorage; never synced — these are device-level settings.

import { DEFAULT_ALARM_SOUND, type AlarmSoundId } from "./sounds";

export type FadeInSec = 0 | 15 | 30 | 60;
export type SnoozeMin = 5 | 9 | 10 | 15;

export type AlarmAudioPrefs = {
  sound: AlarmSoundId;
  volume: number;      // 0–100
  fadeInSec: FadeInSec;
  vibrate: boolean;
  snoozeMin: SnoozeMin;
};

export const DEFAULT_ALARM_PREFS: AlarmAudioPrefs = {
  sound: DEFAULT_ALARM_SOUND,
  volume: 85,
  fadeInSec: 15,
  vibrate: true,
  snoozeMin: 9,
};

const KEY = "restpilot:alarm:audio";
let cached: AlarmAudioPrefs | null = null;

export function loadAlarmPrefs(): AlarmAudioPrefs {
  if (cached) return cached;
  if (typeof window === "undefined") return DEFAULT_ALARM_PREFS;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return (cached = DEFAULT_ALARM_PREFS);
    const parsed = JSON.parse(raw) as Partial<AlarmAudioPrefs>;
    cached = { ...DEFAULT_ALARM_PREFS, ...parsed };
    return cached;
  } catch {
    return (cached = DEFAULT_ALARM_PREFS);
  }
}

export function saveAlarmPrefs(partial: Partial<AlarmAudioPrefs>): AlarmAudioPrefs {
  const next = { ...loadAlarmPrefs(), ...partial };
  cached = next;
  if (typeof window !== "undefined") {
    try { window.localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* noop */ }
  }
  return next;
}

export function vibrateSupported(): boolean {
  return typeof navigator !== "undefined" && "vibrate" in navigator;
}
