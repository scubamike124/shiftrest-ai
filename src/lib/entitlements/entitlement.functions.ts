import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";
import { paymentsClientToken } from "@/lib/billing-flags";
import {
  appleEnvironmentsFrom,
  mergeEntitlements,
  statusStripeEnvironment,
  type Entitlement,
  type StoreEntitlementRow,
  type StripeSubscriptionRow,
} from "./merge";
import { isMissingRelationError, isStoreNotReady } from "./store-sync.server";

export type EntitlementStatus =
  | {
      entitlement: Entitlement;
      appleManagementUrl: string | null;
      /** The whole Apple pipeline is ready on the server: IAP_ENABLED=true,
       *  RevenueCat secrets set and the store_entitlements migration applied.
       *  The app offers an App Store purchase only when this is true, so
       *  nobody is charged by Apple without an entitlement sync. */
      iapReady: boolean;
    }
  | { error: string };

const APPLE_SUBSCRIPTIONS_URL = "https://apps.apple.com/account/subscriptions";
const UNAVAILABLE = "Subscription status is unavailable. Please try again.";

function serverEnv(): Record<string, string | undefined> {
  // The build's publishable Stripe token tells which Stripe environment's rows
  // count (same as the website), when PAYMENTS_ENVIRONMENT is not set.
  return {
    ...(process.env as Record<string, string | undefined>),
    VITE_PAYMENTS_CLIENT_TOKEN: paymentsClientToken() || undefined,
  };
}

type StoreRow = StoreEntitlementRow & { management_url: string | null };
/** store_entitlements is not in the generated types until the owner applies
 *  the pending migration; read it through a narrow untyped view. */
interface StoreReader {
  from(table: "store_entitlements"): {
    select(columns: string): {
      eq(column: "user_id", value: string): PromiseLike<{ data: unknown; error: unknown }>;
    };
  };
}

let warnedMissing = false;
function warnMissingTable() {
  if (warnedMissing) return;
  warnedMissing = true;
  console.warn(
    "[iap] IAP_ENABLED=true but public.store_entitlements is missing (migration not applied): Apple entitlements are inert",
  );
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
  if (stripe.error || !Array.isArray(stripe.data)) return { error: UNAVAILABLE };
  let storeRows: StoreRow[] = [];
  let storeReady = false;
  const apple = appleEnvironmentsFrom(env);
  if (apple.length) {
    const store = await (supabase as unknown as StoreReader)
      .from("store_entitlements")
      .select(
        "environment, plan, period_type, expires_at, grace_expires_at, will_renew, management_url",
      )
      .eq("user_id", userId);
    if (store.error && isMissingRelationError(store.error)) {
      warnMissingTable(); // Table absent: Apple is inert, Stripe status still works.
    } else if (store.error || !Array.isArray(store.data)) {
      return { error: UNAVAILABLE };
    } else {
      storeRows = store.data as StoreRow[];
      storeReady = true;
    }
  }
  const entitlement = mergeEntitlements(stripe.data satisfies StripeSubscriptionRow[], storeRows, {
    stripeEnvironment: statusStripeEnvironment(env),
    appleEnvironments: storeReady ? apple : [],
  });
  const appleManagementUrl = entitlement.hasApple
    ? (storeRows.find((r) => typeof r.management_url === "string")?.management_url ??
      APPLE_SUBSCRIPTIONS_URL)
    : null;
  const iapReady =
    storeReady && !!env.REVENUECAT_SECRET_API_KEY && !!env.REVENUECAT_WEBHOOK_SECRET;
  return { entitlement, appleManagementUrl, iapReady };
}

/** The signed-in user's merged entitlement across Stripe and the App Store. */
export const getEntitlementStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<EntitlementStatus> => {
    try {
      return await readStatus(context.supabase, context.userId);
    } catch {
      return { error: UNAVAILABLE };
    }
  });

// Per-instance throttle: a restore button cannot be used to hammer RevenueCat.
const lastSync = new Map<string, number>();
const SYNC_INTERVAL_MS = 10_000;
const IAP_UNAVAILABLE = "In-app purchases are not available yet.";

/** Refresh the signed-in user's App Store entitlement from RevenueCat
 *  (after a purchase or "Restore purchases"), then return the merged status.
 *  The user ID comes from the verified session, never from the client. */
export const syncMyStoreEntitlement = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<EntitlementStatus> => {
    const env = serverEnv();
    if (env.IAP_ENABLED !== "true") return { error: IAP_UNAVAILABLE };
    const now = Date.now();
    const previous = lastSync.get(context.userId) ?? 0;
    if (now - previous < SYNC_INTERVAL_MS) {
      return { error: "Still checking with the App Store. Please try again in a few seconds." };
    }
    lastSync.set(context.userId, now);
    if (lastSync.size > 10_000) lastSync.clear();
    // Only call RevenueCat when the whole pipeline is ready (secrets set and
    // the store_entitlements migration applied); otherwise stay inert.
    try {
      const pre = await readStatus(context.supabase, context.userId);
      if ("error" in pre) return pre;
      if (!pre.iapReady) return { error: IAP_UNAVAILABLE };
    } catch {
      return { error: UNAVAILABLE };
    }
    try {
      const [{ syncStoreEntitlement }, { storeSyncDeps }] = await Promise.all([
        import("./store-sync.server"),
        import("./store-db.server"),
      ]);
      await syncStoreEntitlement(context.userId, await storeSyncDeps());
    } catch (error) {
      if (isStoreNotReady(error)) {
        warnMissingTable();
        return { error: IAP_UNAVAILABLE };
      }
      return {
        error:
          "Couldn't confirm your App Store purchase yet. Please try Restore again in a minute.",
      };
    }
    try {
      return await readStatus(context.supabase, context.userId);
    } catch {
      return { error: UNAVAILABLE };
    }
  });
