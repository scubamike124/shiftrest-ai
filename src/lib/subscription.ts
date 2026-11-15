// Subscription helpers — reads the Stripe-synced `subscriptions` table and,
// once Apple In-App Purchase is set up (VITE_REVENUECAT_IOS_API_KEY), the
// merged App Store entitlement from the server.
import { supabase } from "@/integrations/supabase/client";
import { getStripeEnvironment, isPaymentsConfigured } from "@/lib/stripe";
import { revenueCatIosKey } from "@/lib/billing-flags";
import { getEntitlementStatus } from "@/lib/entitlements/entitlement.functions";

export type SubscriptionTier = "free" | "monthly" | "annual" | "lifetime";

export interface SubscriptionState {
  tier: SubscriptionTier;
  status: string;
  expiresAt: Date | null;
  cancelAtPeriodEnd: boolean;
  isPremium: boolean;
  /** Who bills the plan shown: the website (Stripe) or Apple (App Store). */
  source: "stripe" | "apple";
  /** Stripe could not charge the card and is retrying (past_due) or gave up
   *  without canceling (unpaid). Not Premium, but still a Stripe customer
   *  who can be charged again: they must be able to open the billing portal
   *  to fix the card or cancel, and must never be offered a second plan. */
  billingIssue: boolean;
  stripeCustomerId: string | null;
}

/** Stripe statuses where the subscription still exists and can charge again. */
export const BILLING_ISSUE_STATUSES: ReadonlySet<string> = new Set(["past_due", "unpaid"]);

const TIER_BY_PRICE: Record<string, SubscriptionTier> = {
  restpilot_monthly: "monthly",
  restpilot_annual: "annual",
  restpilot_lifetime: "lifetime",
};

export async function getSubscriptionState(): Promise<SubscriptionState> {
  const empty: SubscriptionState = {
    tier: "free",
    status: "none",
    expiresAt: null,
    cancelAtPeriodEnd: false,
    isPremium: false,
    source: "stripe",
    billingIssue: false,
    stripeCustomerId: null,
  };

  const { data: session } = await supabase.auth.getSession();
  if (!session.session) return empty;
  if (!isPaymentsConfigured()) return empty;

  const env = getStripeEnvironment();
  const { data } = await supabase
    .from("subscriptions")
    .select(
      "price_id, status, current_period_end, cancel_at_period_end, stripe_customer_id",
    )
    .eq("user_id", session.session.user.id)
    .eq("environment", env)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!data) return withApple(empty);

  const tier = TIER_BY_PRICE[data.price_id] ?? "free";
  const expiresAt = data.current_period_end ? new Date(data.current_period_end) : null;
  const now = new Date();
  const isPremium =
    data.status === "lifetime" ||
    ((data.status === "active" || data.status === "trialing") &&
      (!expiresAt || expiresAt > now)) ||
    (data.status === "canceled" && !!expiresAt && expiresAt > now);

  return withApple({
    tier,
    status: data.status,
    expiresAt,
    cancelAtPeriodEnd: !!data.cancel_at_period_end,
    isPremium,
    billingIssue:
      !isPremium && BILLING_ISSUE_STATUSES.has(data.status) && !!data.stripe_customer_id,
    stripeCustomerId: data.stripe_customer_id ?? null,
    source: "stripe",
  });
}

/** A user with no Stripe Premium (and no Stripe billing problem) may be an
 *  App Store subscriber. Asked only once Apple IAP is set up for this build;
 *  any failure keeps the Stripe answer (display only: Premium itself is
 *  enforced on the server). */
async function withApple(state: SubscriptionState): Promise<SubscriptionState> {
  if (state.isPremium || state.billingIssue || !revenueCatIosKey()) return state;
  try {
    const res = await getEntitlementStatus();
    if (!("entitlement" in res)) return state;
    const e = res.entitlement;
    const apple = e.channels.find((c) => c.source === "apple");
    if (!e.active || !apple) return state;
    return {
      tier: apple.plan === "annual" ? "annual" : "monthly",
      status: apple.state === "trialing" ? "trialing" : "active",
      expiresAt: apple.expiresAt === null ? null : new Date(apple.expiresAt),
      cancelAtPeriodEnd: !apple.willRenew,
      isPremium: true,
      source: "apple",
      billingIssue: false,
      stripeCustomerId: state.stripeCustomerId,
    };
  } catch {
    return state;
  }
}

export async function restorePurchases(): Promise<SubscriptionState> {
  return getSubscriptionState();
}
