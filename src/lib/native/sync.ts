// I/O for the iPhone app shell's native features: reminder settings, local
// notification scheduling and the offline plan. Everything is a no-op outside
// the app shell. Pure planning lives in reminders.ts and offline-plan.ts.

import {
  nativePlugin,
  type LocalNotificationsPlugin,
  type PermissionState,
  type PreferencesPlugin,
} from "@/lib/native/capacitor";
import { APP_URL_KEY, OFFLINE_PLAN_KEY, type OfflinePlan } from "@/lib/native/offline-plan";
import {
  normalizeSettings,
  type NativeReminderSettings,
  type PlannedReminder,
} from "@/lib/native/reminders";

/** Marks notifications this site scheduled, so sync never touches others. */
export const REMINDER_SOURCE = "rp-native-reminders";
const SETTINGS_PREFIX = "rp:native-reminders:v1:";

/**
 * Bumped by clearNativeUserData(). A sync or write that started before a
 * sign-out sees the change after its awaits and undoes itself, so nothing
 * comes back after the person signed out.
 */
let generation = 0;

export function localNotifications(): LocalNotificationsPlugin | null {
  return nativePlugin<LocalNotificationsPlugin>("LocalNotifications");
}

function preferences(): PreferencesPlugin | null {
  return nativePlugin<PreferencesPlugin>("Preferences");
}

/* ---------------------------------------------------------------- settings */
// Per device and per account: they decide what this phone schedules locally.

export function loadReminderSettings(userId: string | null): NativeReminderSettings {
  if (!userId || typeof window === "undefined") return normalizeSettings(null);
  try {
    const raw = window.localStorage.getItem(SETTINGS_PREFIX + userId);
    return normalizeSettings(raw ? JSON.parse(raw) : null);
  } catch {
    return normalizeSettings(null);
  }
}

export function saveReminderSettings(userId: string, settings: NativeReminderSettings): void {
  try {
    window.localStorage.setItem(
      SETTINGS_PREFIX + userId,
      JSON.stringify(normalizeSettings(settings)),
    );
  } catch {
    /* storage full or blocked: the in-memory settings still apply this session */
  }
  window.dispatchEvent(new CustomEvent("rp:native-reminders-changed"));
}

/* ------------------------------------------------------------- permission */

export async function reminderPermission(): Promise<PermissionState | "unavailable"> {
  const ln = localNotifications();
  if (!ln) return "unavailable";
  try {
    return (await ln.checkPermissions()).display;
  } catch {
    return "unavailable";
  }
}

/** Shows the iOS permission alert. Call only from a user action. */
export async function requestReminderPermission(): Promise<PermissionState | "unavailable"> {
  const ln = localNotifications();
  if (!ln) return "unavailable";
  try {
    return (await ln.requestPermissions()).display;
  } catch {
    return "unavailable";
  }
}

/* ------------------------------------------------------------------- sync */

async function pendingOwnIds(ln: LocalNotificationsPlugin): Promise<number[]> {
  const { notifications } = await ln.getPending();
  return (notifications ?? [])
    .filter((n) => n.extra && (n.extra as Record<string, unknown>).source === REMINDER_SOURCE)
    .map((n) => n.id);
}

export type SyncResult =
  | { status: "scheduled"; count: number }
  | { status: "cleared" }
  | { status: "skipped"; reason: "unavailable" | "permission" };

/**
 * Makes the pending reminders exactly `planned`: cancels every reminder this
 * site scheduled before, then schedules the new plan. Stable ids mean a
 * reminder that did not change is simply replaced.
 */
export async function syncNativeReminders(planned: PlannedReminder[]): Promise<SyncResult> {
  const ln = localNotifications();
  if (!ln) return { status: "skipped", reason: "unavailable" };
  const gen = generation;
  const own = await pendingOwnIds(ln);
  if (own.length) await ln.cancel({ notifications: own.map((id) => ({ id })) });
  if (!planned.length) return { status: "cleared" };
  const perm = await reminderPermission();
  if (perm !== "granted") return { status: "skipped", reason: "permission" };
  if (gen !== generation) return { status: "cleared" };
  await ln.schedule({
    notifications: planned.map((r) => ({
      id: r.id,
      title: r.title,
      body: r.body,
      schedule: { at: new Date(r.at.getTime()), allowWhileIdle: true },
      threadIdentifier: `rp-${r.kind}`,
      extra: { source: REMINDER_SOURCE, kind: r.kind, path: r.path },
    })),
  });
  if (gen !== generation) {
    // Signed out while scheduling: take these back.
    await ln.cancel({ notifications: planned.map((r) => ({ id: r.id })) });
    return { status: "cleared" };
  }
  return { status: "scheduled", count: planned.length };
}

/** Removes every reminder this site scheduled (sign-out, account deletion). */
export async function cancelAllNativeReminders(): Promise<void> {
  const ln = localNotifications();
  if (!ln) return;
  try {
    const own = await pendingOwnIds(ln);
    if (own.length) await ln.cancel({ notifications: own.map((id) => ({ id })) });
  } catch {
    /* nothing pending, or plugin unavailable */
  }
}

/* ----------------------------------------------------------- offline plan */

export async function writeOfflinePlan(plan: OfflinePlan): Promise<void> {
  const p = preferences();
  if (!p) return;
  const gen = generation;
  await p.set({ key: OFFLINE_PLAN_KEY, value: JSON.stringify(plan) });
  if (gen !== generation) await p.remove({ key: OFFLINE_PLAN_KEY });
}

/** Tells the shell's offline page which site to return to (production or a test host). */
export async function rememberAppUrl(origin: string): Promise<void> {
  const p = preferences();
  if (!p || !/^https:\/\//.test(origin)) return;
  await p.set({ key: APP_URL_KEY, value: origin.replace(/\/?$/, "/") });
}

/** Sign-out / account deletion: no schedule data or reminders left behind. */
export async function clearNativeUserData(): Promise<void> {
  generation++;
  await cancelAllNativeReminders();
  const p = preferences();
  if (p) {
    try {
      await p.remove({ key: OFFLINE_PLAN_KEY });
    } catch {
      /* already gone */
    }
  }
}
