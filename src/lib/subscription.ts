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

  // Status is read from the database, which the webhook keeps in sync, so a
  // build without website checkout (Railway before Stripe is set up, or the
  // iOS app) still shows paid and lifetime members their plan. Without a
  // publishable key the real customers' rows are the live ones.
  const env = isPaymentsConfigured() ? getStripeEnvironment() : "live";
  const { data: rows } = await supabase
    .from("subscriptions")
    .select("price_id, status, current_period_end, cancel_at_period_end, stripe_customer_id")
    .eq("user_id", session.session.user.id)
    .eq("environment", env)
    .order("created_at", { ascending: false })
    .limit(20);

  if (!rows?.length) return empty;

  const now = new Date();
  const toState = (data: (typeof rows)[number]): SubscriptionState => {
    const tier = TIER_BY_PRICE[data.price_id] ?? "free";
    const expiresAt = data.current_period_end ? new Date(data.current_period_end) : null;
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
  };
  // A newer incomplete checkout must not hide an older paid or lifetime row.
  const states = rows.map(toState);
  return states.find((s) => s.isPremium) ?? states[0];
}

export async function restorePurchases(): Promise<SubscriptionState> {
  return getSubscriptionState();
}
