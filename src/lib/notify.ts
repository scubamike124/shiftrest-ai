import { loadShifts, endAbsolute, type Shift } from "./shifts";
import { loadPrefs } from "./prefs";

export type NotifyPermission = "default" | "granted" | "denied" | "unsupported";

export function getPermission(): NotifyPermission {
  if (typeof window === "undefined" || !("Notification" in window)) return "unsupported";
  return Notification.permission as NotifyPermission;
}

export async function requestPermission(): Promise<NotifyPermission> {
  if (getPermission() === "unsupported") return "unsupported";
  const res = await Notification.requestPermission();
  return res as NotifyPermission;
}

export function showNotification(title: string, body: string) {
  if (getPermission() !== "granted") return;
  try {
    new Notification(title, {
      body,
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      tag: "shiftrest-winddown",
    });
  } catch {}
}

/** Next wind-down moment in ms-from-now, or null. Wind-down = shift end + a recovery beat, minus windDown minutes before sleep start. We treat sleep start as right after shift ends. */
export function nextWindDownAt(now = new Date()): { at: Date; shift: Shift } | null {
  const shifts = loadShifts();
  if (!shifts.length) return null;
  const prefs = loadPrefs();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const nowDay = (now.getDay() + 6) % 7; // Mon=0

  let best: { deltaMin: number; shift: Shift } | null = null;
  for (let offset = 0; offset < 7; offset++) {
    const day = (nowDay + offset) % 7;
    for (const s of shifts.filter((x) => x.day === day)) {
      const end = endAbsolute(s); // minutes since shift's day start
      // sleep start ~= end; wind-down ping = end - windDownMin
      const ping = end - prefs.windDownMin;
      const absolute = offset * 1440 + ping;
      const deltaMin = absolute - nowMin;
      if (deltaMin > 0 && (!best || deltaMin < best.deltaMin)) {
        best = { deltaMin, shift: s };
      }
    }
  }
  if (!best) return null;
  return { at: new Date(now.getTime() + best.deltaMin * 60_000), shift: best.shift };
}

let timer: number | null = null;

export function scheduleNextWindDown() {
  if (typeof window === "undefined") return;
  if (timer !== null) {
    window.clearTimeout(timer);
    timer = null;
  }
  const prefs = loadPrefs();
  if (!prefs.notifications) return;
  if (getPermission() !== "granted") return;
  const next = nextWindDownAt();
  if (!next) return;
  const ms = Math.max(1000, next.at.getTime() - Date.now());
  // setTimeout caps at ~24.8 days; our window is <= 7d so we're fine
  timer = window.setTimeout(() => {
    showNotification(
      "Wind-down time 🌙",
      `Dim lights, no caffeine. Sleep window starts in ${prefs.windDownMin} min.`,
    );
    scheduleNextWindDown();
  }, ms);
}
