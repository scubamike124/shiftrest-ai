import type { EntitlementStatus } from "./entitlement.functions";

// Re-sync the App Store entitlement when the iPhone app opens or returns to the
// foreground. Renewals and refunds normally arrive through the RevenueCat
// webhook; this is the safety net for a missed or late webhook and for a
// purchase made on another device. It reuses syncMyStoreEntitlement (server
// throttle included) and never renders anything or starts a purchase.

/** Apple access ending within this window (or already ended) is re-checked. */
export const NEAR_EXPIRY_MS = 3 * 24 * 60 * 60 * 1000;
/** Client-side minimum gap between re-syncs per user. */
export const RESYNC_MIN_GAP_MS = 30 * 60 * 1000;
/** Gap when there is no Apple access at all (missing or long-expired row). */
export const RESYNC_NO_APPLE_GAP_MS = 6 * 60 * 60 * 1000;

export type ResyncOutcome =
  | "skipped-web"
  | "skipped-not-ready"
  | "skipped-signed-out"
  | "skipped-not-needed"
  | "skipped-recent"
  | "synced"
  | "failed";

export interface ResyncDeps {
  isNativeApp(): boolean;
  /** Client side: App Store key and native plugin are present. */
  iapAvailable(): boolean;
  userId: string | null;
  getStatus(): Promise<EntitlementStatus>;
  sync(): Promise<EntitlementStatus>;
  now(): number;
  /** Per-user epoch ms of the last attempt. */
  lastAttempt: Map<string, number>;
}

/** Pure decision from a status: should we ask RevenueCat again? */
export function needsResync(
  status: EntitlementStatus,
  now: number,
): "no-apple" | "near-expiry" | null {
  if (!("entitlement" in status) || !status.iapReady) return null;
  const e = status.entitlement;
  const apple = e.channels.find((c) => c.source === "apple");
  if (apple) {
    return apple.expiresAt !== null && apple.expiresAt - now <= NEAR_EXPIRY_MS ? "near-expiry" : null;
  }
  // No Apple access. A website subscriber (or legacy lifetime) has no need to ask.
  if (e.active) return null;
  return "no-apple";
}

export async function resyncStoreEntitlement(deps: ResyncDeps): Promise<ResyncOutcome> {
  try {
    if (!deps.isNativeApp()) return "skipped-web";
    if (!deps.iapAvailable()) return "skipped-not-ready";
    const userId = deps.userId;
    if (!userId) return "skipped-signed-out";
    const now = deps.now();
    const last = deps.lastAttempt.get(userId) ?? 0;
    if (now - last < RESYNC_MIN_GAP_MS) return "skipped-recent";
    const status = await deps.getStatus();
    if (!("entitlement" in status) || !status.iapReady) return "skipped-not-ready";
    const why = needsResync(status, now);
    if (!why) return "skipped-not-needed";
    if (why === "no-apple" && now - last < RESYNC_NO_APPLE_GAP_MS) return "skipped-recent";
    deps.lastAttempt.set(userId, now);
    const next = await deps.sync();
    return "entitlement" in next ? "synced" : "failed";
  } catch {
    return "failed";
  }
}
