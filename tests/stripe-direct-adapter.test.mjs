// Direct Stripe adapter for Railway (replaces Lovable's connector gateway).
// It must be inert without env vars, accept only restricted keys whose mode
// matches the deployment, never open new checkouts unless the owner switches
// VITE_STRIPE_CHECKOUT_ENABLED on, and talk to Stripe directly.
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import vm from "node:vm";
import test from "node:test";

const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
const source = stripTypeScriptTypes(read("../src/lib/stripe.server.ts"))
  .replace(/^import[\s\S]*?;\n/gm, "")
  .replaceAll("export const ", "const ")
  .replaceAll("export function ", "function ")
  .replaceAll("export async function ", "async function ");

const TEST_KEY = "rk_test_example";
const LIVE_KEY = "rk_live_example";

function load(env) {
  const constructed = [];
  class Stripe {
    constructor(key, options) {
      constructed.push({ key, options });
    }
    static createFetchHttpClient(fn) {
      return { custom: Boolean(fn) };
    }
  }
  const ctx = vm.createContext({
    process: { env },
    Stripe,
    Buffer,
    crypto: globalThis.crypto,
    TextEncoder,
    Date,
    JSON,
  });
  const api = vm.runInContext(
    `${source}\n({ createStripeClient, getConnectionApiKey, isStripeConfigured, isWebCheckoutEnabled, deploymentMode, verifyWebhook })`,
    ctx,
  );
  return { ...api, constructed };
}

test("inert without env vars: every purpose refuses, nothing is constructed", () => {
  const a = load({});
  assert.equal(a.isStripeConfigured("live"), false);
  assert.equal(a.isStripeConfigured("sandbox"), false);
  assert.equal(a.isWebCheckoutEnabled(), false);
  assert.throws(() => a.createStripeClient("live"), /checkout is not enabled/);
  assert.throws(() => a.createStripeClient("live", "sync"), /STRIPE_SECRET_KEY is not set/);
  assert.throws(() => a.createStripeClient("sandbox", "portal"), /STRIPE_SECRET_KEY is not set/);
  assert.equal(a.constructed.length, 0);
});

test("restricted keys only", () => {
  for (const key of ["sk_test_example", "sk_live_example"]) {
    const a = load({ STRIPE_SECRET_KEY: key, PAYMENTS_ENVIRONMENT: "sandbox" });
    assert.throws(() => a.createStripeClient("sandbox", "sync"), /restricted key/);
  }
  assert.throws(
    () =>
      load({ STRIPE_SECRET_KEY: "pk_test_x", PAYMENTS_ENVIRONMENT: "sandbox" }).createStripeClient(
        "sandbox",
        "sync",
      ),
    /not a Stripe restricted key/,
  );
});

test("mode lock: key, PAYMENTS_ENVIRONMENT, publishable key and request must agree", () => {
  assert.throws(
    () => load({ STRIPE_SECRET_KEY: TEST_KEY }).createStripeClient("sandbox", "sync"),
    /PAYMENTS_ENVIRONMENT is not set/,
  );
  assert.throws(
    () =>
      load({ STRIPE_SECRET_KEY: LIVE_KEY, PAYMENTS_ENVIRONMENT: "sandbox" }).createStripeClient(
        "sandbox",
        "sync",
      ),
    /STRIPE_SECRET_KEY does not match PAYMENTS_ENVIRONMENT/,
  );
  assert.throws(
    () =>
      load({
        STRIPE_SECRET_KEY: TEST_KEY,
        PAYMENTS_ENVIRONMENT: "sandbox",
        VITE_PAYMENTS_CLIENT_TOKEN: "pk_live_x",
      }).createStripeClient("sandbox", "sync"),
    /VITE_PAYMENTS_CLIENT_TOKEN does not match/,
  );
  const a = load({
    STRIPE_SECRET_KEY: TEST_KEY,
    PAYMENTS_ENVIRONMENT: "sandbox",
    VITE_PAYMENTS_CLIENT_TOKEN: "pk_test_x",
  });
  assert.throws(() => a.createStripeClient("live", "sync"), /serves sandbox, not live/);
  assert.equal(a.isStripeConfigured("sandbox"), true);
  assert.equal(a.isStripeConfigured("live"), false);
  a.createStripeClient("sandbox", "sync");
  assert.equal(a.constructed[0].key, TEST_KEY);
});

test("a key alone enables subscription sync and the portal, not new checkouts", () => {
  const a = load({ STRIPE_SECRET_KEY: LIVE_KEY, PAYMENTS_ENVIRONMENT: "live" });
  a.createStripeClient("live", "sync");
  a.createStripeClient("live", "portal");
  assert.throws(() => a.createStripeClient("live"), /checkout is not enabled/);
  assert.equal(a.constructed.length, 2);
});

test("checkout needs the key and the owner's exact switch", () => {
  const base = { STRIPE_SECRET_KEY: TEST_KEY, PAYMENTS_ENVIRONMENT: "sandbox" };
  assert.throws(
    () =>
      load({
        VITE_STRIPE_CHECKOUT_ENABLED: "true",
        PAYMENTS_ENVIRONMENT: "sandbox",
      }).createStripeClient("sandbox"),
    /STRIPE_SECRET_KEY/,
  );
  assert.throws(
    () => load({ ...base, VITE_STRIPE_CHECKOUT_ENABLED: "1" }).createStripeClient("sandbox"),
    /checkout is not enabled/,
  );
  const a = load({ ...base, VITE_STRIPE_CHECKOUT_ENABLED: "true" });
  a.createStripeClient("sandbox");
  assert.equal(a.constructed.length, 1);
});

test("talks to Stripe directly: default fetch client, no Lovable gateway", () => {
  const a = load({ STRIPE_SECRET_KEY: LIVE_KEY, PAYMENTS_ENVIRONMENT: "live" });
  a.createStripeClient("live", "sync");
  const { options } = a.constructed[0];
  assert.equal(options.apiVersion, "2026-03-25.dahlia");
  assert.deepEqual(JSON.parse(JSON.stringify(options.httpClient)), { custom: false });
  assert.doesNotMatch(read("../src/lib/stripe.server.ts"), /connector-gateway|LOVABLE_API_KEY/);
});

function signedRequest(secret, body, t = Math.floor(Date.now() / 1000)) {
  const sig = createHmac("sha256", secret).update(`${t}.${body}`).digest("hex");
  return new Request("https://example.test/api/public/payments/webhook?env=sandbox", {
    method: "POST",
    headers: { "stripe-signature": `t=${t},v1=${sig}` },
    body,
  });
}

test("webhook: STRIPE_WEBHOOK_SECRET verifies; wrong secret or wrong mode is refused", async () => {
  const env = {
    STRIPE_SECRET_KEY: TEST_KEY,
    PAYMENTS_ENVIRONMENT: "sandbox",
    STRIPE_WEBHOOK_SECRET: "whsec_test_secret",
  };
  const body = JSON.stringify({
    type: "customer.subscription.updated",
    data: { object: { id: "sub_1" } },
  });
  const ok = await load(env).verifyWebhook(signedRequest("whsec_test_secret", body), "sandbox");
  assert.equal(ok.type, "customer.subscription.updated");
  await assert.rejects(
    load(env).verifyWebhook(signedRequest("whsec_other", body), "sandbox"),
    /Invalid webhook signature/,
  );
  await assert.rejects(
    load(env).verifyWebhook(signedRequest("whsec_test_secret", body), "live"),
    /mode does not match/,
  );
  await assert.rejects(
    load({ ...env, STRIPE_WEBHOOK_SECRET: undefined }).verifyWebhook(
      signedRequest("x", body),
      "sandbox",
    ),
    /STRIPE_WEBHOOK_SECRET is not configured/,
  );
});

test("call sites use the intended purposes", () => {
  const billing = read("../src/lib/billing.functions.ts");
  const webhook = read("../src/routes/api/public/payments/webhook.ts");
  const account = read("../src/lib/account.functions.ts");
  assert.match(billing, /createCheckoutSession[\s\S]*?createStripeClient\(data\.environment\);/);
  assert.match(billing, /createStripeClient\(data\.environment, "portal"\)/);
  assert.equal((webhook.match(/createStripeClient\(env, "sync"\)/g) || []).length, 2);
  assert.match(account, /createStripeClient\(row\.environment, "sync"\)/);
});

test("Stripe CSP origins appear only when checkout is switched on", () => {
  const start = read("../src/start.ts");
  assert.match(
    start,
    /const stripeCheckout = process\.env\.VITE_STRIPE_CHECKOUT_ENABLED === "true";/,
  );
  for (const origin of [
    "https://js.stripe.com",
    "https://api.stripe.com",
    "https://hooks.stripe.com",
  ]) {
    for (const line of start.split("\n").filter((l) => l.includes(origin))) {
      assert.match(line, /stripeCheckout|^\s*\? \[/, `${origin} must be gated: ${line.trim()}`);
    }
  }
});

test("browser: checkout only on the website with the switch; no lifetime; same plans and return URL", () => {
  const client = read("../src/lib/stripe.ts");
  assert.match(client, /checkoutSwitch && isPaymentsConfigured\(\)/);
  assert.match(client, /https:\/\/js\.stripe\.com\/dahlia\/stripe\.js/);
  const preview = read("../src/components/AppPreviewAccess.tsx");
  assert.match(preview, /isWebCheckoutEnabled\(\) && !isNativeApp\(\)/);
  const ui = read("../src/components/subscription/WebStripeCheckout.tsx");
  assert.doesNotMatch(ui, /restpilot_lifetime|\$99|label: "Lifetime"|id: "lifetime"/i);
  assert.match(ui, /monthly: "restpilot_monthly"/);
  assert.match(ui, /annual: "restpilot_annual"/);
  assert.match(ui, /\$7\.99/);
  assert.match(ui, /\$49\.99/);
  assert.match(ui, /14-day free trial/);
  assert.match(ui, /\/profile\?checkout=success&session_id=\{CHECKOUT_SESSION_ID\}/);
});
