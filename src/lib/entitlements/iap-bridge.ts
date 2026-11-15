// Client bridge to the RevenueCat Capacitor plugin inside the iOS app shell.
//
// The iOS shell (ios-app/, bundle com.restpilotai.app) loads this site via
// Capacitor `server.url`, so the web bundle does not import @capacitor/core or
// the plugin package (@revenuecat/purchases-capacitor, installed natively).
// The shell's injected bridge exposes
// `window.Capacitor.nativePromise(plugin, method, opts)` and lists installed
// native plugins in `PluginHeaders`. Every call here is inert unless ALL hold:
//   - VITE_REVENUECAT_IOS_API_KEY is a public RevenueCat Apple SDK key (appl_…),
//   - the page runs inside the iOS app shell with the "Purchases" plugin installed.
// The paywall additionally requires the server to report IAP ready
// (IAP_ENABLED=true, RevenueCat secrets set, store_entitlements migration
// applied), so nobody can be charged by Apple without an entitlement sync.
// No secret lives here: the Apple SDK key is designed to ship in apps.

import { isNativeApp } from "@/lib/native-app";
import { revenueCatIosKey } from "@/lib/billing-flags";
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
  return (window as unknown as { Capacitor?: NativeBridge }).Capacitor ?? null;
}

const sdkKey = revenueCatIosKey;

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
  return (
    typeof cap?.nativePromise === "function" &&
    Array.isArray(cap.PluginHeaders) &&
    cap.PluginHeaders.some((h) => h?.name === PLUGIN)
  );
}

/** The client side of IAP is present: key set, iOS shell with the plugin.
 *  (The server's readiness is checked separately, see NativeSubscription.) */
export function iapAvailable(): boolean {
  return (
    sdkKey() !== null &&
    currentSurface() === "ios" &&
    purchasesPluginInstalled()
  );
}

function call<T>(method: string, options?: unknown): Promise<T> {
  const cap = nativeBridge();
  if (!iapAvailable() || typeof cap?.nativePromise !== "function") {
    return Promise.reject(new Error("In-app purchases are not available in this build."));
  }
  return cap.nativePromise(PLUGIN, method, options) as Promise<T>;
}

let configuredFor: string | null = null;
let identifyQueue: Promise<void> = Promise.resolve();

/** Identify the purchaser as the signed-in RestPilot user (Supabase UUID), so
 *  App Store purchases attach to the account, never to an anonymous ID or a
 *  previously signed-in user. Calls are serialized: a later sign-in always
 *  wins, and a caller awaiting identify(x) resumes only once the SDK is x. */
export function identify(userId: string): Promise<void> {
  const run = identifyQueue.then(async () => {
    if (configuredFor === userId) return;
    // The native SDK outlives page reloads; configure once, then switch users.
    const state =
      configuredFor === null
        ? await call<{ isConfigured?: unknown }>("isConfigured")
        : { isConfigured: true };
    if (state?.isConfigured === true) {
      await call("logIn", { appUserID: userId });
    } else {
      await call("configure", { apiKey: sdkKey(), appUserID: userId });
    }
    configuredFor = userId;
  });
  identifyQueue = run.catch(() => undefined);
  return run;
}

/** Storefront country. getStorefront exists only in newer plugin releases;
 *  where it rejects the storefront is unknown, which the policy treats as
 *  non-US (no links). Main never renders a purchase link anyway. */
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
  const e = error as {
    userCancelled?: unknown;
    code?: unknown;
    data?: { userCancelled?: unknown };
  } | null;
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

/** Apple's own subscription management page (opens the App Store sheet). */
export const APPLE_SUBSCRIPTIONS_URL = "https://apps.apple.com/account/subscriptions";
