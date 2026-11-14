import Stripe from "stripe";

const getEnv = (key: string): string => {
  const value = process.env[key];
  if (!value) throw new Error(`${key} is not configured`);
  return value;
};

export type StripeEnv = "sandbox" | "live";

// Direct Stripe on Railway (replaces Lovable's connector gateway, which only
// exists on Lovable hosting). Keyed only by environment variables and inert
// without them:
//   STRIPE_SECRET_KEY      RESTRICTED key of RestPilot's own Stripe account:
//                          rk_test_… on staging, rk_live_… on production
//   STRIPE_WEBHOOK_SECRET  signing secret (whsec_…) of that mode's endpoint
//   PAYMENTS_ENVIRONMENT   sandbox | live: the mode this deployment serves
//   VITE_STRIPE_CHECKOUT_ENABLED=true  owner-approved switch for NEW website
//                          checkouts; without it checkout stays off
// Mode lock: the key's mode, PAYMENTS_ENVIRONMENT, the publishable key
// (VITE_PAYMENTS_CLIENT_TOKEN, if set) and the requested environment must
// all agree, or nothing talks to Stripe.
// "sync" (webhook subscription sync, account-deletion cancellation) and
// "portal" (existing subscribers managing or cancelling) only need the key.
export type StripePurpose = "checkout" | "portal" | "sync";

function keyMode(key: string): StripeEnv {
  if (key.startsWith("rk_test_")) return "sandbox";
  if (key.startsWith("rk_live_")) return "live";
  if (key.startsWith("sk_")) {
    throw new Error("STRIPE_SECRET_KEY must be a restricted key (rk_…), not a full secret key.");
  }
  throw new Error("STRIPE_SECRET_KEY is not a Stripe restricted key.");
}

// The single mode this deployment serves, after checking every input agrees.
export function deploymentMode(): StripeEnv {
  const configured = process.env.PAYMENTS_ENVIRONMENT;
  if (configured !== "sandbox" && configured !== "live") {
    throw new Error("Stripe is not configured on this host (PAYMENTS_ENVIRONMENT is not set).");
  }
  const key = process.env.STRIPE_SECRET_KEY;
  if (key && keyMode(key) !== configured) {
    throw new Error("Stripe mode mismatch: STRIPE_SECRET_KEY does not match PAYMENTS_ENVIRONMENT.");
  }
  const token = process.env.VITE_PAYMENTS_CLIENT_TOKEN;
  const tokenMode = token?.startsWith("pk_test_") ? "sandbox" : token?.startsWith("pk_live_") ? "live" : null;
  if (token && tokenMode !== configured) {
    throw new Error("Stripe mode mismatch: VITE_PAYMENTS_CLIENT_TOKEN does not match PAYMENTS_ENVIRONMENT.");
  }
  return configured;
}

export function isStripeConfigured(env: StripeEnv): boolean {
  try {
    return Boolean(process.env.STRIPE_SECRET_KEY) && deploymentMode() === env;
  } catch {
    return false;
  }
}

export function isWebCheckoutEnabled(): boolean {
  return process.env.VITE_STRIPE_CHECKOUT_ENABLED === "true";
}

export function getConnectionApiKey(env: StripeEnv): string {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("Stripe is not configured on this host (STRIPE_SECRET_KEY is not set).");
  if (deploymentMode() !== env) {
    throw new Error(`Stripe mode mismatch: this host serves ${deploymentMode()}, not ${env}.`);
  }
  return key;
}

export function createStripeClient(env: StripeEnv, purpose: StripePurpose = "checkout"): Stripe {
  if (purpose === "checkout" && !isWebCheckoutEnabled()) {
    throw new Error("Website checkout is not enabled on this host.");
  }
  return new Stripe(getConnectionApiKey(env), {
    apiVersion: "2026-03-25.dahlia",
    httpClient: Stripe.createFetchHttpClient(),
    timeout: 20_000,
    maxNetworkRetries: 2,
  });
}

export function getStripeErrorMessage(error: unknown): string {
  if (error && typeof error === "object") {
    const stripeError = error as {
      message?: string;
      type?: string;
      code?: string;
      raw?: { message?: string; type?: string; code?: string };
    };
    const message = stripeError.raw?.message ?? stripeError.message;
    if (message) {
      const details = [
        stripeError.raw?.type ?? stripeError.type,
        stripeError.raw?.code ?? stripeError.code,
      ].filter(Boolean);
      return details.length ? `${message} (${details.join(", ")})` : message;
    }
  }
  return "Payment request failed";
}

export async function verifyWebhook(
  req: Request,
  env: StripeEnv,
): Promise<{ type: string; data: { object: any } }> {
  const signature = req.headers.get("stripe-signature");
  const body = await req.text();
  // A webhook for the other mode (e.g. a live event sent to staging) is refused.
  if (deploymentMode() !== env) throw new Error("Webhook mode does not match this host");
  const secret = getEnv("STRIPE_WEBHOOK_SECRET");

  if (!signature || !body) throw new Error("Missing signature or body");

  let timestamp: string | undefined;
  const v1Signatures: string[] = [];
  for (const part of signature.split(",")) {
    const [key, value] = part.split("=", 2);
    if (key === "t") timestamp = value;
    if (key === "v1") v1Signatures.push(value);
  }
  if (!timestamp || v1Signatures.length === 0) throw new Error("Invalid signature format");

  const age = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (age > 300) throw new Error("Webhook timestamp too old");

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signed = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${timestamp}.${body}`),
  );
  const expected = Buffer.from(new Uint8Array(signed)).toString("hex");

  if (!v1Signatures.includes(expected)) throw new Error("Invalid webhook signature");
  return JSON.parse(body);
}
