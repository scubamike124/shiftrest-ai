// Best-effort push enrollment triggered after a Smart Alarm is scheduled.
// Reuses the existing notifications infrastructure — no new SW, no new tables.
// Failures never block alarm creation.

import { toast } from "sonner";
import {
  pushSupported,
  ensurePushSubscription,
  subscriptionPayload,
} from "@/lib/notifications/client";
import { subscribePush } from "@/lib/push/subscribe.functions";

const INSTALL_TOAST_KEY = "rp.alarmPush.installToast.shown.v1";
const BLOCKED_TOAST_KEY = "rp.alarmPush.blockedToast.shown.v1";

function isIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  return /iP(hone|ad|od)/.test(navigator.userAgent);
}

function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  const mm = window.matchMedia?.("(display-mode: standalone)").matches;
  const legacy = (navigator as unknown as { standalone?: boolean }).standalone;
  return Boolean(mm || legacy);
}

function showOnce(key: string, fn: () => void) {
  try {
    if (typeof window === "undefined") return;
    if (window.localStorage.getItem(key) === "1") return;
    window.localStorage.setItem(key, "1");
    fn();
  } catch {
    fn();
  }
}

function showInstallHint() {
  showOnce(INSTALL_TOAST_KEY, () =>
    toast.message("Add RestPilot to your Home Screen", {
      description:
        "iPhone requires the installed app for locked-screen alarm notifications. Tap Share → Add to Home Screen.",
    }),
  );
}

function showBlockedHint() {
  showOnce(BLOCKED_TOAST_KEY, () =>
    toast.message("Notifications are blocked", {
      description:
        "Enable them in Settings → Notifications → RestPilot to get locked-screen alarms.",
    }),
  );
}

/**
 * Ensure the current device is subscribed to Web Push so the alarm dispatcher
 * can wake it on the lock screen. Safe to call repeatedly — the underlying
 * `pushManager.subscribe` returns the existing subscription and
 * `subscribePush` upserts on (user_id, endpoint).
 */
export async function ensureAlarmPushEnrollment(opts: { signedIn: boolean }): Promise<void> {
  try {
    if (!opts.signedIn) return;

    if (!pushSupported()) {
      if (isIOS() && !isStandalone()) showInstallHint();
      return;
    }

    if (typeof Notification === "undefined") return;

    if (Notification.permission === "denied") {
      showBlockedHint();
      return;
    }

    if (Notification.permission === "default") {
      const res = await Notification.requestPermission();
      if (res !== "granted") {
        if (res === "denied") showBlockedHint();
        return;
      }
    }

    const sub = await ensurePushSubscription();
    if (!sub) return;

    await subscribePush({ data: subscriptionPayload(sub) });
  } catch (err) {
    console.warn("[alarm-push] enrollment failed", err);
  }
}
