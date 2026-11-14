// Client bridge to the RevenueCat Capacitor plugin inside the iOS app shell.
//
// The White Glove shell loads this site via Capacitor `server.url`, so the web
// bundle does not import @capacitor/core or the plugin package. The shell's
// injected bridge exposes `window.Capacitor.nativePromise(plugin, method, opts)`
// and lists installed native plugins in `PluginHeaders`. Every call here is
// inert unless ALL of these hold:
//   - VITE_IAP_ENABLED === "true" at build time (defaults off),
//   - VITE_REVENUECAT_IOS_API_KEY is a public RevenueCat Apple SDK key (appl_…),
//   - the page runs inside the iOS app shell with the "Purchases" plugin installed.
// No secret lives here: the Apple SDK key is designed to ship in apps.

import { isNativeApp } from "@/lib/native-app";
import type { Surface } from "./paywall-policy";
import { packagesByPlan, type AppStorePlan, type RevenueCatPackage } from "./revenuecat";

type NativeBridge = {
  nativePromise?: (plugin: string, method: string, options?: unknown) => Promise<unknown>;
  PluginHeaders?: { name?: string }[];
  getPlatform?: () => string;
};

const PLUGIN = "Purchases";

function nativeBridge(): NativeBridge | null {
  if (typeof window === "undefined") return null;
  return ((window as unknown as { Capacitor?: NativeBridge }).Capacitor) ?? null;
}

export function iapFlagEnabled(): boolean {
  return import.meta.env.VITE_IAP_ENABLED === "true";
}

/** Separate opt-in for the US-storefront link to website purchase/billing. */
export function usExternalLinkFlagEnabled(): boolean {
  return import.meta.env.VITE_IAP_US_EXTERNAL_LINK === "true";
}

function sdkKey(): string | null {
  const key = import.meta.env.VITE_REVENUECAT_IOS_API_KEY as string | undefined;
  return typeof key === "string" && /^appl_[A-Za-z0-9]+$/.test(key) ? key : null;
}

export function currentSurface(): Surface {
  if (!isNativeApp()) return "web";
  try {
    return nativeBridge()?.getPlatform?.() === "ios" ? "ios" : "other_native";
  } catch {
    return "other_native";
  }
}

export function purchasesPluginInstalled(): boolean {
  const cap = nativeBridge();
  return typeof cap?.nativePromise === "function"
    && Array.isArray(cap.PluginHeaders)
    && cap.PluginHeaders.some((h) => h?.name === PLUGIN);
}

/** IAP can be offered: flag on, key present, iOS shell with plugin. */
export function iapAvailable(): boolean {
  return iapFlagEnabled() && sdkKey() !== null && currentSurface() === "ios" && purchasesPluginInstalled();
}

function call<T>(method: string, options?: unknown): Promise<T> {
  const cap = nativeBridge();
  if (!iapAvailable() || typeof cap?.nativePromise !== "function") {
    return Promise.reject(new Error("In-app purchases are not available in this build."));
  }
  return cap.nativePromise(PLUGIN, method, options) as Promise<T>;
}

let configuredFor: string | null = null;

/** Identify the purchaser as the signed-in RestPilot user (Supabase UUID), so
 *  App Store purchases attach to the account, never to an anonymous ID. */
export async function identify(userId: string): Promise<void> {
  if (configuredFor === userId) return;
  if (configuredFor === null) {
    await call("configure", { apiKey: sdkKey(), appUserID: userId });
  } else {
    await call("logIn", { appUserID: userId });
  }
  configuredFor = userId;
}

export async function getStorefront(): Promise<string | null> {
  try {
    const sf = await call<{ countryCode?: unknown }>("getStorefront");
    return typeof sf?.countryCode === "string" ? sf.countryCode : null;
  } catch {
    return null; // Unknown storefront is treated as non-US by the policy.
  }
}

export async function loadPackages(): Promise<Partial<Record<AppStorePlan, RevenueCatPackage>>> {
  return packagesByPlan(await call("getOfferings"));
}

function isUserCancel(error: unknown): boolean {
  const e = error as { userCancelled?: unknown; code?: unknown; data?: { userCancelled?: unknown } } | null;
  return e?.userCancelled === true || e?.data?.userCancelled === true || String(e?.code) === "1";
}

export async function purchase(pkg: RevenueCatPackage): Promise<"purchased" | "cancelled"> {
  try {
    await call("purchasePackage", { aPackage: pkg });
    return "purchased";
  } catch (error) {
    if (isUserCancel(error)) return "cancelled";
    throw error;
  }
}

export async function restore(): Promise<void> {
  await call("restorePurchases");
}
