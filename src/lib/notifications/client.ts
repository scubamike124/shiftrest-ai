// Browser-side helpers: register the service worker, subscribe to push,
// and load/save the current user's notification_prefs row.

import { supabase } from "@/integrations/supabase/client";
import { urlBase64ToUint8Array, VAPID_PUBLIC_KEY } from "@/lib/push/vapid";

export type NotifPrefsRow = {
  enabled: boolean;
  wind_down: boolean;
  caffeine_cutoff: boolean;
  bright_light: boolean;
  shift_start: boolean;
  shift_end_recovery: boolean;
  quiet_start: string;
  quiet_end: string;
  daily_cap: number;
  timezone: string;
};

export const DEFAULT_NOTIF_PREFS: NotifPrefsRow = {
  enabled: false,
  wind_down: true,
  caffeine_cutoff: true,
  bright_light: true,
  shift_start: true,
  shift_end_recovery: true,
  quiet_start: "22:00:00",
  quiet_end: "07:00:00",
  daily_cap: 4,
  timezone:
    (typeof Intl !== "undefined" && Intl.DateTimeFormat().resolvedOptions().timeZone) || "UTC",
};

export function pushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

export async function ensureServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!pushSupported()) return null;
  try {
    const existing = await navigator.serviceWorker.getRegistration("/sw.js");
    if (existing) return existing;
    return await navigator.serviceWorker.register("/sw.js", { scope: "/" });
  } catch (err) {
    console.error("SW register failed", err);
    return null;
  }
}

export async function ensurePushSubscription(): Promise<PushSubscription | null> {
  const reg = await ensureServiceWorker();
  if (!reg) return null;
  await navigator.serviceWorker.ready;

  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    const key = urlBase64ToUint8Array(VAPID_PUBLIC_KEY);
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: key.buffer.slice(key.byteOffset, key.byteOffset + key.byteLength) as ArrayBuffer,
    });
  }
  return sub;
}

export function subscriptionPayload(sub: PushSubscription) {
  const json = sub.toJSON();
  return {
    endpoint: sub.endpoint,
    p256dh: json.keys?.p256dh ?? "",
    auth: json.keys?.auth ?? "",
    userAgent: navigator.userAgent,
  };
}

export async function fetchNotifPrefs(): Promise<NotifPrefsRow> {
  const { data: u } = await supabase.auth.getSession();
  const uid = u.session?.user.id;
  if (!uid) return DEFAULT_NOTIF_PREFS;
  const { data } = await supabase
    .from("notification_prefs")
    .select(
      "enabled, wind_down, caffeine_cutoff, bright_light, shift_start, shift_end_recovery, quiet_start, quiet_end, daily_cap, timezone",
    )
    .eq("user_id", uid)
    .maybeSingle();
  if (!data) return DEFAULT_NOTIF_PREFS;
  return { ...DEFAULT_NOTIF_PREFS, ...(data as Partial<NotifPrefsRow>) };
}

export async function saveNotifPrefs(partial: Partial<NotifPrefsRow>): Promise<void> {
  const { data: u } = await supabase.auth.getSession();
  const uid = u.session?.user.id;
  if (!uid) throw new Error("Sign in to save reminder preferences.");
  const { error } = await supabase
    .from("notification_prefs")
    .upsert({ user_id: uid, ...partial }, { onConflict: "user_id" });
  if (error) throw error;
}

export type LogEntry = {
  id: string;
  kind: string;
  scheduled_for: string;
  sent_at: string | null;
  suppressed_reason: string | null;
  title: string | null;
  body: string | null;
};

export async function fetchRecentLog(limit = 10): Promise<LogEntry[]> {
  const { data: u } = await supabase.auth.getSession();
  const uid = u.session?.user.id;
  if (!uid) return [];
  const { data } = await supabase
    .from("notification_log")
    .select("id, kind, scheduled_for, sent_at, suppressed_reason, title, body")
    .eq("user_id", uid)
    .order("scheduled_for", { ascending: false })
    .limit(limit);
  return (data ?? []) as LogEntry[];
}
