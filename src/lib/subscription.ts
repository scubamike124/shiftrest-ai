// Subscription helpers — works in mock mode until RevenueCat keys are wired in
// for the native iOS build. On the web we just read/write the profile row.
import { supabase } from "@/integrations/supabase/client";

export type SubscriptionTier = "free" | "monthly" | "annual" | "lifetime";

export interface SubscriptionState {
  tier: SubscriptionTier;
  expiresAt: Date | null;
  trialEndsAt: Date | null;
  isPremium: boolean;
}

export async function getSubscriptionState(): Promise<SubscriptionState> {
  const { data: session } = await supabase.auth.getSession();
  if (!session.session) {
    return { tier: "free", expiresAt: null, trialEndsAt: null, isPremium: false };
  }
  const { data } = await supabase
    .from("profiles")
    .select("subscription_tier, subscription_expires_at, trial_ends_at")
    .eq("id", session.session.user.id)
    .maybeSingle();

  const tier = (data?.subscription_tier ?? "free") as SubscriptionTier;
  const expiresAt = data?.subscription_expires_at ? new Date(data.subscription_expires_at) : null;
  const trialEndsAt = data?.trial_ends_at ? new Date(data.trial_ends_at) : null;
  const now = new Date();
  const isPremium =
    tier === "lifetime" ||
    (!!expiresAt && expiresAt > now) ||
    (!!trialEndsAt && trialEndsAt > now);

  return { tier, expiresAt, trialEndsAt, isPremium };
}

// Called from the paywall. On the web this is a mock that starts a 7-day trial.
// On native iOS, RevenueCat's `Purchases.purchasePackage()` runs first, and on
// success this server-side write is what makes the rest of the app unlock.
export async function startTrial(tier: SubscriptionTier): Promise<void> {
  const { data: session } = await supabase.auth.getSession();
  if (!session.session) throw new Error("Sign in to start your trial.");

  const trialEnds = new Date();
  trialEnds.setDate(trialEnds.getDate() + 7);

  await supabase
    .from("profiles")
    .update({
      subscription_tier: tier,
      trial_ends_at: trialEnds.toISOString(),
    })
    .eq("id", session.session.user.id);
}

// Restore purchases — on web, refetches profile. On native, RevenueCat's
// `Purchases.restorePurchases()` is invoked first, then this re-syncs.
export async function restorePurchases(): Promise<SubscriptionState> {
  return getSubscriptionState();
}
