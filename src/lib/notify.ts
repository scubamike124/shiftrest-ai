import { fetchShifts, endAbsolute, type Shift } from "./shifts";
import { fetchPrefs } from "./prefs";

export type NotifyPermission = "default" | "granted" | "denied" | "unsupported";

/** Reason a permission request should be skipped on this platform. */
export type NotifyBlockReason =
  | "ssr"
  | "no-notification-api"
  | "insecure-context"
  | "ios-needs-standalone"
  | "denied";

/**
 * Detect whether `Notification.requestPermission()` is safe to invoke here.
 * iOS Safari throws `NotAllowedError` ("not allowed by the user agent…")
 * when called from a non-standalone tab or an insecure context — we must
 * detect those cases BEFORE asking, and route the user to friendly UI.
 */
export function canRequestNotificationPermission():
  | { ok: true }
  | { ok: false; reason: NotifyBlockReason } {
  if (typeof window === "undefined") return { ok: false, reason: "ssr" };
  if (!("Notification" in window)) return { ok: false, reason: "no-notification-api" };
  if (!window.isSecureContext) return { ok: false, reason: "insecure-context" };
  const nav = window.navigator as Navigator & { standalone?: boolean };
  const ua = nav.userAgent ?? "";
  const isIos = /iPad|iPhone|iPod/.test(ua) && !("MSStream" in window);
  const standalone =
    window.matchMedia?.("(display-mode: standalone)").matches || nav.standalone === true;
  if (isIos && !standalone) return { ok: false, reason: "ios-needs-standalone" };
  if (Notification.permission === "denied") return { ok: false, reason: "denied" };
  return { ok: true };
}

export function getPermission(): NotifyPermission {
  if (typeof window === "undefined" || !("Notification" in window)) return "unsupported";
  return Notification.permission as NotifyPermission;
}

export async function requestPermission(): Promise<NotifyPermission> {
  const gate = canRequestNotificationPermission();
  if (!gate.ok) {
    // Never throw — callers expect a value they can branch on.
    if (gate.reason === "no-notification-api" || gate.reason === "ssr") return "unsupported";
    if (gate.reason === "denied") return "denied";
    return "unsupported"; // ios-needs-standalone, insecure-context
  }
  try {
    const res = await Notification.requestPermission();
    return res as NotifyPermission;
  } catch (err) {
    console.error("Notification.requestPermission failed", err);
    return "unsupported";
  }
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

export async function nextWindDownAt(
  now = new Date(),
): Promise<{ at: Date; shift: Shift } | null> {
  const shifts = await fetchShifts();
  if (!shifts.length) return null;
  const prefs = await fetchPrefs();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const nowDay = (now.getDay() + 6) % 7;

  let best: { deltaMin: number; shift: Shift } | null = null;
  for (let offset = 0; offset < 7; offset++) {
    const day = (nowDay + offset) % 7;
    for (const s of shifts.filter((x: Shift) => x.day === day)) {
      const end = endAbsolute(s);
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

export async function scheduleNextWindDown() {
  if (typeof window === "undefined") return;
  if (timer !== null) {
    window.clearTimeout(timer);
    timer = null;
  }
  const prefs = await fetchPrefs();
  if (!prefs.notifications) return;
  if (getPermission() !== "granted") return;
  const next = await nextWindDownAt();
  if (!next) return;
  const ms = Math.max(1000, next.at.getTime() - Date.now());
  timer = window.setTimeout(() => {
    showNotification(
      "Wind-down time 🌙",
      `Dim lights, no caffeine. Sleep window starts in ${prefs.windDownMin} min.`,
    );
    scheduleNextWindDown();
  }, ms);
}
