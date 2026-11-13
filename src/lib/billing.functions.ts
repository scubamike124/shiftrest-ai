import { createServerFn } from "@tanstack/react-start";
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
const CHECKOUT_PRICES = new Set(["restpilot_monthly", "restpilot_annual", "restpilot_lifetime"]);

function validateEnvironment(environment: unknown): StripeEnv {
  if (environment !== "sandbox" && environment !== "live") {
    throw new Error("Invalid payment environment");
  }
  return environment;
}

function validateReturnUrl(value: unknown, environment: StripeEnv): string {
  if (typeof value !== "string") throw new Error("Invalid return URL");
  let url: URL;
  try { url = new URL(value); } catch { throw new Error("Invalid return URL"); }
  const allowedOrigins = new Set(["https://restpilotai.com"]);
  // Explicit server configuration supports the existing preview/deployment host.
  // Never trust a forwarded header or an origin supplied by the caller.
  if (process.env.PUBLIC_APP_URL) {
    const configured = new URL(process.env.PUBLIC_APP_URL);
    if (configured.protocol === "https:" && !configured.username && !configured.password) {
      allowedOrigins.add(configured.origin);
    }
  }
  const localSandbox = environment === "sandbox" && process.env.NODE_ENV !== "production"
    && url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.username || url.password || (!allowedOrigins.has(url.origin) && !localSandbox)) {
    throw new Error("Invalid return URL origin");
  }
  return value;
}

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
  if (found.data.length) {
    const customer = found.data[0];
    if (customer.metadata?.userId !== options.userId) throw new Error("Customer ownership mismatch");
    return customer.id;
  }
  // Email is contact information, never an ownership key. Shared/reused email
  // addresses must not adopt or rewrite another account's Stripe customer.
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
      if (!data || !CHECKOUT_PRICES.has(data.priceId)) throw new Error("Invalid priceId");
      const environment = validateEnvironment(data.environment);
      return { priceId: data.priceId, returnUrl: validateReturnUrl(data.returnUrl, environment), environment };
    },
  )
  .handler(async ({ data, context }): Promise<CheckoutResult> => {
    try {
      const { supabase, userId } = context;
      const { data: userRes } = await supabase.auth.getUser();
      const email = userRes.user?.email ?? undefined;

      const stripe = createStripeClient(data.environment);
      const prices = await stripe.prices.list({ lookup_keys: [data.priceId], active: true });
      if (!prices.data.length) throw new Error("Price not found");
      const stripePrice = prices.data[0];
      if (stripePrice.lookup_key !== data.priceId || !stripePrice.active) {
        throw new Error("Price is not available");
      }
      // Hard guard: a known one-time price MUST be one-time in Stripe. If it
      // ever syncs as recurring, fail loudly instead of opening a subscription
      // checkout with a trial.
      const forcedOneTime = ONE_TIME_PRICES.has(data.priceId);
      if (forcedOneTime && stripePrice.type !== "one_time") {
        throw new Error(
          `Price "${data.priceId}" must be a one-time Stripe price but is configured as recurring. Fix it in Stripe and retry.`,
        );
      }
      if (!forcedOneTime && (stripePrice.type !== "recurring"
        || stripePrice.recurring?.interval !== (data.priceId === "restpilot_monthly" ? "month" : "year")
        || stripePrice.recurring.interval_count !== 1)) {
        throw new Error("Subscription price is not configured for the selected plan");
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
  .inputValidator((data: { returnUrl?: string; environment: StripeEnv }) => {
    if (!data) throw new Error("Invalid payment request");
    const environment = validateEnvironment(data.environment);
    return { environment, ...(data.returnUrl !== undefined && { returnUrl: validateReturnUrl(data.returnUrl, environment) }) };
  })
  .handler(async ({ data, context }): Promise<PortalResult> => {
    try {
      const { supabase, userId } = context;
      const { data: sub, error: lookupError } = await supabase
        .from("subscriptions")
        .select("stripe_customer_id")
        .eq("user_id", userId)
        .eq("environment", data.environment)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (lookupError) return { error: "Unable to look up your subscription. Please try again." };

      if (!sub?.stripe_customer_id) {
        return { error: "No subscription found for your account." };
      }

      const stripe = createStripeClient(data.environment);
      const customer = await stripe.customers.retrieve(sub.stripe_customer_id);
      if (customer.deleted || customer.metadata?.userId !== userId) {
        return { error: "Unable to verify billing ownership. Please contact support." };
      }
      const portal = await stripe.billingPortal.sessions.create({
        customer: sub.stripe_customer_id,
        ...(data.returnUrl && { return_url: data.returnUrl }),
      });
      return { url: portal.url };
    } catch (error) {
      return { error: getStripeErrorMessage(error) };
    }
  });
