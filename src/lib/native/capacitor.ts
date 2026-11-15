// Typed access to the native plugins of the RestPilot iPhone app shell.
//
// The shell (ios-app/, Capacitor 6) loads restpilotai.com with `server.url`, so
// this site does not bundle @capacitor/core. Capacitor injects
// `window.Capacitor` into the page, with one proxy per installed native plugin
// under `Capacitor.Plugins.<Name>` (see @capacitor/ios JSExport.swift). Every
// helper here returns null in a browser, during server render, or when the
// installed app is an older build without that plugin, so callers can hide
// the feature instead of failing.

import { isNativeApp } from "@/lib/native-app";

export type ListenerHandle = { remove: () => Promise<void> | void };

type CapacitorGlobal = {
  isNativePlatform?: () => boolean;
  isPluginAvailable?: (name: string) => boolean;
  getPlatform?: () => string;
  Plugins?: Record<string, unknown>;
};

function capacitor(): CapacitorGlobal | null {
  if (typeof window === "undefined") return null;
  return (window as unknown as { Capacitor?: CapacitorGlobal }).Capacitor ?? null;
}

/** "ios" | "android" inside the app shell, "web" everywhere else. */
export function nativePlatform(): "ios" | "android" | "web" {
  if (!isNativeApp()) return "web";
  try {
    const p = capacitor()?.getPlatform?.();
    return p === "ios" || p === "android" ? p : "web";
  } catch {
    return "web";
  }
}

/** The injected proxy for a native plugin, or null when it is not installed. */
export function nativePlugin<T>(name: string): T | null {
  if (!isNativeApp()) return null;
  const cap = capacitor();
  try {
    if (typeof cap?.isPluginAvailable === "function" && !cap.isPluginAvailable(name)) return null;
    const plugin = cap?.Plugins?.[name];
    return plugin ? (plugin as T) : null;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------ plugin shapes */
// Only the methods this site calls. Shapes follow the Capacitor 6 plugin docs.

export type PreferencesPlugin = {
  get(o: { key: string }): Promise<{ value: string | null }>;
  set(o: { key: string; value: string }): Promise<void>;
  remove(o: { key: string }): Promise<void>;
};

export type AppPlugin = {
  addListener(
    event: "appUrlOpen",
    cb: (e: { url: string }) => void,
  ): ListenerHandle | Promise<ListenerHandle>;
  addListener(event: "resume" | "pause", cb: () => void): ListenerHandle | Promise<ListenerHandle>;
};

export type SplashScreenPlugin = { hide(o?: { fadeOutDuration?: number }): Promise<void> };

export type PermissionState = "granted" | "denied" | "prompt" | "prompt-with-rationale";

export type LocalNotificationSchema = {
  id: number;
  title: string;
  body: string;
  /** `at` must be a real Date: WebKit hands it to the plugin as NSDate. */
  schedule: { at: Date; allowWhileIdle?: boolean };
  threadIdentifier?: string;
  extra?: Record<string, unknown>;
};

export type LocalNotificationsPlugin = {
  checkPermissions(): Promise<{ display: PermissionState }>;
  requestPermissions(): Promise<{ display: PermissionState }>;
  schedule(o: { notifications: LocalNotificationSchema[] }): Promise<unknown>;
  getPending(): Promise<{
    notifications: Array<{ id: number; extra?: Record<string, unknown> | null }>;
  }>;
  cancel(o: { notifications: Array<{ id: number }> }): Promise<void>;
  addListener(
    event: "localNotificationActionPerformed",
    cb: (e: { notification: { id: number; extra?: Record<string, unknown> | null } }) => void,
  ): ListenerHandle | Promise<ListenerHandle>;
};

/** Await a listener handle whichever shape the bridge returned. */
export async function asHandle(
  h: ListenerHandle | Promise<ListenerHandle>,
): Promise<ListenerHandle> {
  return await Promise.resolve(h);
}
