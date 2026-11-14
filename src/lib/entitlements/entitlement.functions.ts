import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";
import {
  appleEnvironmentsFrom,
  mergeEntitlements,
  statusStripeEnvironment,
  type Entitlement,
  type StoreEntitlementRow,
  type StripeSubscriptionRow,
} from "./merge";

export type EntitlementStatus =
  { entitlement: Entitlement; appleManagementUrl: string | null } | { error: string };

const APPLE_SUBSCRIPTIONS_URL = "https://apps.apple.com/account/subscriptions";

function serverEnv(): Record<string, string | undefined> {
  return process.env as Record<string, string | undefined>;
}

async function readStatus(
  supabase: SupabaseClient<Database>,
  userId: string,
): Promise<EntitlementStatus> {
  const env = serverEnv();
  const stripe = await supabase
    .from("subscriptions")
    .select("status, price_id, current_period_end, cancel_at_period_end, environment")
    .eq("user_id", userId);
  // Fail closed: an unreadable status must never turn into a buy button.
  if (stripe.error || !Array.isArray(stripe.data))
    return { error: "Subscription status is unavailable. Please try again." };
  let storeRows: (StoreEntitlementRow & { management_url: string | null })[] = [];
  const apple = appleEnvironmentsFrom(env);
  if (apple.length) {
    const store = await supabase
      .from("store_entitlements")
      .select(
        "environment, plan, period_type, expires_at, grace_expires_at, will_renew, management_url",
      )
      .eq("user_id", userId);
    if (store.error || !Array.isArray(store.data))
      return { error: "Subscription status is unavailable. Please try again." };
    storeRows = store.data;
  }
  const entitlement = mergeEntitlements(stripe.data satisfies StripeSubscriptionRow[], storeRows, {
    stripeEnvironment: statusStripeEnvironment(env),
    appleEnvironments: apple,
  });
  const appleManagementUrl = entitlement.hasApple
    ? (storeRows.find((r) => typeof r.management_url === "string")?.management_url ??
      APPLE_SUBSCRIPTIONS_URL)
    : null;
  return { entitlement, appleManagementUrl };
}

/** The signed-in user's merged entitlement across Stripe and the App Store. */
export const getEntitlementStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<EntitlementStatus> => {
    try {
      return await readStatus(context.supabase, context.userId);
    } catch {
      return { error: "Subscription status is unavailable. Please try again." };
    }
  });

// Per-instance throttle: a restore button cannot be used to hammer RevenueCat.
const lastSync = new Map<string, number>();
const SYNC_INTERVAL_MS = 10_000;

/** Refresh the signed-in user's App Store entitlement from RevenueCat
 *  (after a purchase or "Restore purchases"), then return the merged status.
 *  The user ID comes from the verified session, never from the client. */
export const syncMyStoreEntitlement = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<EntitlementStatus> => {
    const env = serverEnv();
    if (env.IAP_ENABLED !== "true") return { error: "In-app purchases are not available yet." };
    const now = Date.now();
    const previous = lastSync.get(context.userId) ?? 0;
    if (now - previous < SYNC_INTERVAL_MS) {
      return { error: "Still checking with the App Store. Please try again in a few seconds." };
    }
    lastSync.set(context.userId, now);
    if (lastSync.size > 10_000) lastSync.clear();
    try {
      const [{ syncStoreEntitlement }, { storeSyncDeps }] = await Promise.all([
        import("./store-sync.server"),
        import("./store-db.server"),
      ]);
      await syncStoreEntitlement(context.userId, await storeSyncDeps());
    } catch {
      return {
        error:
          "Couldn't confirm your App Store purchase yet. Please try Restore again in a minute.",
      };
    }
    try {
      return await readStatus(context.supabase, context.userId);
    } catch {
      return { error: "Subscription status is unavailable. Please try again." };
    }
  });
