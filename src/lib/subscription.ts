// Subscription helpers — reads the Stripe-synced `subscriptions` table.
import { supabase } from "@/integrations/supabase/client";
import { getStripeEnvironment, isPaymentsConfigured } from "@/lib/stripe";

export type SubscriptionTier = "free" | "monthly" | "annual" | "lifetime";

export interface SubscriptionState {
  tier: SubscriptionTier;
  status: string;
  expiresAt: Date | null;
  cancelAtPeriodEnd: boolean;
  isPremium: boolean;
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

  if (!data) return empty;

  const tier = TIER_BY_PRICE[data.price_id] ?? "free";
  const expiresAt = data.current_period_end ? new Date(data.current_period_end) : null;
  const now = new Date();
  const isPremium =
    data.status === "lifetime" ||
    ((data.status === "active" || data.status === "trialing") &&
      (!expiresAt || expiresAt > now)) ||
    (data.status === "canceled" && !!expiresAt && expiresAt > now);

  return {
    tier,
    status: data.status,
    expiresAt,
    cancelAtPeriodEnd: !!data.cancel_at_period_end,
    isPremium,
    billingIssue:
      !isPremium && BILLING_ISSUE_STATUSES.has(data.status) && !!data.stripe_customer_id,
    stripeCustomerId: data.stripe_customer_id ?? null,
  };
}

export async function restorePurchases(): Promise<SubscriptionState> {
  return getSubscriptionState();
}
