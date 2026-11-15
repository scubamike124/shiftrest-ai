import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { isNativeAppRequest, NATIVE_PURCHASE_UNAVAILABLE } from "@/lib/native-app";
import { webCheckoutEnabled, WEB_CHECKOUT_DISABLED_MESSAGE } from "@/lib/billing-flags";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  type StripeEnv,
  createStripeClient,
  getStripeErrorMessage,
} from "@/lib/stripe.server";

type CheckoutResult = { clientSecret: string } | { error: string };
type PortalResult = { url: string } | { error: string };

// Prices that should NOT get a free trial (one-time purchase)
const ONE_TIME_PRICES = new Set(["restpilot_lifetime"]);
// The $99 lifetime membership was permanently discontinued for new customers
// (owner decision, Nov 14 2026). Only the recurring plans can be bought.
// Existing lifetime entitlements are still honored by the webhook.
const CHECKOUT_PRICES = new Set(["restpilot_monthly", "restpilot_annual"]);

async function resolveOrCreateCustomer(
  stripe: ReturnType<typeof createStripeClient>,
  options: { email?: string; userId: string },
): Promise<string> {
  if (!/^[a-zA-Z0-9_-]+$/.test(options.userId)) {
    throw new Error("Invalid userId");
  }
  const found = await stripe.customers.search({
    query: `metadata['userId']:'${options.userId}'`,
    limit: 1,
  });
  if (found.data.length) return found.data[0].id;

  if (options.email) {
    const existing = await stripe.customers.list({ email: options.email, limit: 1 });
    if (existing.data.length) {
      const customer = existing.data[0];
      if (customer.metadata?.userId !== options.userId) {
        await stripe.customers.update(customer.id, {
          metadata: { ...customer.metadata, userId: options.userId },
        });
      }
      return customer.id;
    }
  }
  const created = await stripe.customers.create({
    ...(options.email && { email: options.email }),
    metadata: { userId: options.userId },
  });
  return created.id;
}

export const createCheckoutSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (data: { priceId: string; returnUrl: string; environment: StripeEnv }) => {
      if (data?.priceId === "restpilot_lifetime") {
        throw new Error("Lifetime membership is no longer offered. Choose the monthly or annual plan.");
      }
      if (!data || !CHECKOUT_PRICES.has(data.priceId)) throw new Error("Invalid priceId");
      return data;
    },
  )
  .handler(async ({ data, context }): Promise<CheckoutResult> => {
    // Defence in depth: never start a website purchase for the iPhone app shell
    // (App Store Guideline 3.1.1). The app hides every purchase button; this
    // also refuses a request that still arrives, before any Stripe call.
    // The signals can be spoofed, so this is not the only control.
    if (isNativeAppRequest(getRequest()?.headers)) return { error: NATIVE_PURCHASE_UNAVAILABLE };
    // New purchases moved to the App Store (owner decision, Nov 15 2026).
    // While VITE_WEB_CHECKOUT_ENABLED is off, refuse every new website
    // purchase here, before any Stripe or database call. Existing Stripe
    // subscribers are unaffected (portal, webhook and renewals are separate).
    if (!webCheckoutEnabled()) return { error: WEB_CHECKOUT_DISABLED_MESSAGE };
    try {
      const { supabase, userId } = context;
      const { data: userRes } = await supabase.auth.getUser();
      const email = userRes.user?.email ?? undefined;

      const stripe = createStripeClient(data.environment);
      const prices = await stripe.prices.list({ lookup_keys: [data.priceId] });
      if (!prices.data.length) throw new Error("Price not found");
      const stripePrice = prices.data[0];
      // Hard guard: a known one-time price MUST be one-time in Stripe. If it
      // ever syncs as recurring, fail loudly instead of opening a subscription
      // checkout with a trial.
      const forcedOneTime = ONE_TIME_PRICES.has(data.priceId);
      if (forcedOneTime && stripePrice.type === "recurring") {
        throw new Error(
          `Price "${data.priceId}" must be a one-time Stripe price but is configured as recurring. Fix it in Stripe and retry.`,
        );
      }
      // New one-time purchases are not sold; refuse any non-recurring price.
      if (stripePrice.type !== "recurring") {
        throw new Error("Only monthly and annual subscriptions can be purchased.");
      }
      const isRecurring = !forcedOneTime && stripePrice.type === "recurring";
      const offerTrial = isRecurring;

      const customerId = await resolveOrCreateCustomer(stripe, { email, userId });

      let productDescription: string | undefined;
      if (!isRecurring) {
        const productId =
          typeof stripePrice.product === "string"
            ? stripePrice.product
            : stripePrice.product.id;
        const product = await stripe.products.retrieve(productId);
        productDescription = product.name;
      }

      const session = await stripe.checkout.sessions.create({
        line_items: [{ price: stripePrice.id, quantity: 1 }],
        mode: isRecurring ? "subscription" : "payment",
        ui_mode: "embedded_page",
        return_url: data.returnUrl,
        customer: customerId,
        ...(!isRecurring && {
          payment_intent_data: { description: productDescription, metadata: { userId } },
        }),
        metadata: { userId, priceId: data.priceId },
        ...(isRecurring && {
          subscription_data: {
            metadata: { userId },
            ...(offerTrial && { trial_period_days: 14 }),
          },
        }),
      });

      return { clientSecret: session.client_secret ?? "" };
    } catch (error) {
      return { error: getStripeErrorMessage(error) };
    }
  });

export const createPortalSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { returnUrl?: string; environment: StripeEnv }) => data)
  .handler(async ({ data, context }): Promise<PortalResult> => {
    // The Stripe portal can switch or renew plans; keep it out of the app too.
    if (isNativeAppRequest(getRequest()?.headers)) return { error: NATIVE_PURCHASE_UNAVAILABLE };
    try {
      const { supabase, userId } = context;
      const { data: sub } = await supabase
        .from("subscriptions")
        .select("stripe_customer_id")
        .eq("user_id", userId)
        .eq("environment", data.environment)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!sub?.stripe_customer_id) {
        return { error: "No subscription found for your account." };
      }

      const stripe = createStripeClient(data.environment);
      const portal = await stripe.billingPortal.sessions.create({
        customer: sub.stripe_customer_id,
        ...(data.returnUrl && { return_url: data.returnUrl }),
      });
      return { url: portal.url };
    } catch (error) {
      return { error: getStripeErrorMessage(error) };
    }
  });
