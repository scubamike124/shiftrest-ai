// Server-side duplicate-billing guard for website Stripe checkout.
//
// Called by createCheckoutSession only when IAP_ENABLED=true. It refuses to
// create a Stripe checkout session for a user who already has an active App
// Store subscription. It fails closed: if the App Store status cannot be read,
// no checkout is created. Tested in tests/subscription-lifecycle.test.mjs.

import { appleEnvironmentsFrom, mergeEntitlements, type StoreEntitlementRow } from "./merge";

export const APPLE_ACTIVE_CHECKOUT_MESSAGE =
  "You already have RestPilot Premium through the App Store. Manage it in iPhone Settings → your name → Subscriptions.";
export const APPLE_STATUS_UNAVAILABLE_MESSAGE =
  "We couldn't check your existing subscriptions. Please try again in a minute.";

interface StoreReader {
  from(table: "store_entitlements"): {
    select(columns: string): {
      eq(column: "user_id", value: string): PromiseLike<{ data: unknown; error: unknown }>;
    };
  };
}

/** Returns an error message when checkout must be refused, or null to proceed. */
export async function appleSubscriptionBlocksCheckout(
  supabase: unknown,
  userId: string,
  vars: Record<string, string | undefined>,
  now = Date.now(),
): Promise<string | null> {
  const appleEnvironments = appleEnvironmentsFrom(vars);
  if (appleEnvironments.length === 0) return null;
  let result: { data: unknown; error: unknown };
  try {
    result = await (supabase as StoreReader)
      .from("store_entitlements")
      .select("environment, plan, period_type, expires_at, grace_expires_at, will_renew")
      .eq("user_id", userId);
  } catch {
    return APPLE_STATUS_UNAVAILABLE_MESSAGE;
  }
  if (result.error || !Array.isArray(result.data)) return APPLE_STATUS_UNAVAILABLE_MESSAGE;
  const merged = mergeEntitlements([], result.data as StoreEntitlementRow[], {
    stripeEnvironment: null,
    appleEnvironments,
    now,
  });
  return merged.hasApple ? APPLE_ACTIVE_CHECKOUT_MESSAGE : null;
}
