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
  stripeCustomerId: string | null;
}

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
    stripeCustomerId: data.stripe_customer_id ?? null,
  };
}

export async function restorePurchases(): Promise<SubscriptionState> {
  return getSubscriptionState();
}
