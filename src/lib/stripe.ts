// Browser side of the direct website Stripe integration (Railway).
// Inert unless the build has a publishable key:
//   VITE_PAYMENTS_CLIENT_TOKEN       pk_test_… (staging) or pk_live_… (production)
//   VITE_STRIPE_CHECKOUT_ENABLED     "true" only after the owner approves new
//                                    website checkouts for that environment
// With only the publishable key, existing subscribers see their plan and can
// open the Stripe customer portal; new checkouts stay off.
type StripeEnv = "sandbox" | "live";

const clientToken = import.meta.env.VITE_PAYMENTS_CLIENT_TOKEN as string | undefined;
const checkoutSwitch = import.meta.env.VITE_STRIPE_CHECKOUT_ENABLED === "true";

function tokenEnvironment(): StripeEnv | null {
  if (clientToken?.startsWith("pk_test_")) return "sandbox";
  if (clientToken?.startsWith("pk_live_")) return "live";
  return null;
}

export function getStripeEnvironment(): StripeEnv {
  const env = tokenEnvironment();
  if (!env) throw new Error("Web payments are not configured for this build.");
  return env;
}

export function isPaymentsConfigured(): boolean {
  return tokenEnvironment() !== null;
}

export function isWebCheckoutEnabled(): boolean {
  return checkoutSwitch && isPaymentsConfigured();
}

// Stripe.js must be loaded from js.stripe.com (PCI). The "dahlia" release
// train matches the server API version 2026-03-25.dahlia.
const STRIPE_JS_URL = "https://js.stripe.com/dahlia/stripe.js";

export type EmbeddedCheckout = { mount(el: HTMLElement): void; destroy(): void };
type StripeJs = {
  createEmbeddedCheckoutPage(options: { clientSecret: string }): Promise<EmbeddedCheckout>;
};
type StripeFactory = (key: string) => StripeJs;
const stripeGlobal = () => (window as unknown as { Stripe?: StripeFactory }).Stripe;

let stripePromise: Promise<StripeJs> | null = null;

export function loadStripeJs(): Promise<StripeJs> {
  if (!isWebCheckoutEnabled()) return Promise.reject(new Error("Website checkout is not enabled."));
  if (stripePromise) return stripePromise;
  stripePromise = new Promise<StripeJs>((resolve, reject) => {
    const ready = () => {
      const factory = stripeGlobal();
      if (factory) resolve(factory(clientToken as string));
      else reject(new Error("Stripe.js did not load."));
    };
    if (stripeGlobal()) return ready();
    const script = document.createElement("script");
    script.src = STRIPE_JS_URL;
    script.async = true;
    script.onload = ready;
    script.onerror = () => {
      stripePromise = null;
      reject(new Error("Couldn't load secure checkout. Check your connection and try again."));
    };
    document.head.appendChild(script);
  });
  return stripePromise;
}
