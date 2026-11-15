// Run with: node --test tests/lifetime-discontinued.test.mjs   (Node 22.13+)
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { join } from 'node:path';
import vm from 'node:vm';
import test from 'node:test';

// Owner decision (Nov 14 2026): the $99 lifetime membership is permanently
// discontinued for NEW customers. Existing lifetime entitlements stay valid.
const root = new URL('..', import.meta.url).pathname;
const read = (p) => readFileSync(join(root, p), 'utf8');

// webCheckout: VITE_WEB_CHECKOUT_ENABLED (production default off since Nov 15 2026).
// These tests pin what the server does when the owner turns it back on.
function checkoutHarness(priceType = 'recurring', { webCheckout = true } = {}) {
  const calls = [];
  let payload;
  const source = stripTypeScriptTypes(read('src/lib/billing.functions.ts'))
    .replace(/^import[\s\S]*?;\n/gm, '').replaceAll('export const ', 'const ');
  const stripe = {
    prices: { async list({ lookup_keys }) { calls.push('price:list'); const key = lookup_keys[0]; return { data: [{ id: 'price_x', lookup_key: key, type: priceType, product: 'prod_x', recurring: priceType === 'recurring' ? { interval: key === 'restpilot_monthly' ? 'month' : 'year', interval_count: 1 } : null }] }; } },
    customers: { async search() { return { data: [{ id: 'cus_1', metadata: { userId: 'u1' } }] }; } },
    products: { async retrieve() { return { name: 'x' }; } },
    checkout: { sessions: { async create(p) { calls.push('checkout:create'); payload = p; return { client_secret: 'cs' }; } } },
  };
  function createServerFn() {
    let validator;
    const b = { middleware() { return b; }, inputValidator(fn) { validator = fn; return b; }, handler(fn) { return async (args) => fn({ ...args, data: validator(args.data) }); } };
    return b;
  }
  const ctx = vm.createContext({ createServerFn, requireSupabaseAuth: {}, createStripeClient() { calls.push('stripe'); return stripe; }, getStripeErrorMessage: (e) => e.message,
    // Website request (not the iPhone app): the native-app refusal does not apply.
    getRequest: () => new Request('https://restpilotai.com/', { headers: { 'user-agent': 'Mozilla/5.0 (Macintosh)' } }), isNativeAppRequest: () => false, NATIVE_PURCHASE_UNAVAILABLE: '',
    webCheckoutEnabled: () => webCheckout, WEB_CHECKOUT_DISABLED_MESSAGE: 'off',
    process: { env: {} }, appleSubscriptionBlocksCheckout: async () => { throw new Error('guard must not run with IAP off'); } });
  const { createCheckoutSession } = vm.runInContext(`${source}\n({createCheckoutSession})`, ctx);
  const supabase = { auth: { async getUser() { return { data: { user: { email: 'a@example.test' } } }; } } };
  return {
    calls,
    get payload() { return payload; },
    checkout: (priceId) => createCheckoutSession({ context: { supabase, userId: 'u1' }, data: { priceId, environment: 'sandbox', returnUrl: 'https://restpilotai.com/profile' } }),
  };
}

test('checkout refuses the lifetime price before any Stripe call', async () => {
  const h = checkoutHarness('one_time');
  await assert.rejects(h.checkout('restpilot_lifetime'), /Lifetime membership is no longer offered/);
  assert.deepEqual(h.calls, []);
});

test('with website checkout off (default), even a valid plan is refused before any Stripe call', async () => {
  for (const priceId of ['restpilot_monthly', 'restpilot_annual']) {
    const h = checkoutHarness('recurring', { webCheckout: false });
    assert.equal((await h.checkout(priceId)).error, 'off');
    assert.deepEqual(h.calls, []);
  }
  // Lifetime is still refused by the validator first, whatever the flag.
  await assert.rejects(checkoutHarness('one_time', { webCheckout: false }).checkout('restpilot_lifetime'), /Lifetime membership is no longer offered/);
});

test('checkout refuses any non-catalog or one-time price', async () => {
  for (const priceId of ['restpilot_founder', 'price_123', '']) {
    const h = checkoutHarness();
    await assert.rejects(h.checkout(priceId), /Invalid priceId/);
    assert.deepEqual(h.calls, []);
  }
  const oneTime = checkoutHarness('one_time');
  assert.ok((await oneTime.checkout('restpilot_monthly')).error);
  assert.ok(!oneTime.calls.includes('checkout:create'));
});

test('monthly and annual keep subscription mode and the 14-day trial', async () => {
  for (const priceId of ['restpilot_monthly', 'restpilot_annual']) {
    const h = checkoutHarness();
    assert.equal((await h.checkout(priceId)).clientSecret, 'cs');
    assert.equal(h.payload.mode, 'subscription');
    assert.equal(h.payload.subscription_data.trial_period_days, 14);
  }
});

function walk(dir, out = []) {
  for (const name of readdirSync(join(root, dir))) {
    const rel = join(dir, name);
    if (statSync(join(root, rel)).isDirectory()) walk(rel, out);
    else if (/\.tsx?$/.test(name) && !name.endsWith('.gen.ts')) out.push(rel);
  }
  return out;
}

test('no customer-facing screen offers a $99 or lifetime purchase', () => {
  const offenders = [...walk('src/routes'), ...walk('src/components')].filter((f) =>
    /\$\s?99\b|USD 99\b|Become a Founding Member|"restpilot_lifetime"|Pay once, use forever/.test(read(f)) && !f.includes('/api/'));
  assert.deepEqual(offenders, []);
});

test('pricing pages still show monthly $7.99, annual $49.99 and the 14-day trial', () => {
  for (const f of ['src/routes/pricing.tsx', 'src/routes/paywall.tsx', 'src/routes/index.tsx']) {
    const text = read(f);
    assert.match(text, /\$7\.99/, f);
    assert.match(text, /\$49\.99/, f);
    assert.match(text, /14-day free trial/, f);
  }
});

test('existing lifetime entitlements are still honored', () => {
  assert.match(read('src/lib/subscription.ts'), /restpilot_lifetime: "lifetime"/);
  assert.match(read('src/lib/subscription.ts'), /data\.status === "lifetime"/);
  assert.match(read('src/routes/api/public/payments/webhook.ts'), /status: "lifetime"/);
});
