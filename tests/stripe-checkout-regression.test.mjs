// Regression lock for the website Stripe checkout (owner: "Do not remove or
// break the working website Stripe system"). Runs the checked-in handler with
// Stripe/Supabase IO replaced, and pins the exact Stripe requests that monthly
// and annual checkout make, including the 14-day trial. Any change to what
// the website sends Stripe for these plans must fail here first.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
import test from 'node:test';

const source = stripTypeScriptTypes(readFileSync(new URL('../src/lib/billing.functions.ts', import.meta.url), 'utf8'))
  .replace(/^import[\s\S]*?;\n/gm, '').replaceAll('export const ', 'const ');

function harness({ existingCustomer = null } = {}) {
  const requests = [];
  const stripe = {
    customers: {
      async search(params) { requests.push(['customers.search', params]); return { data: existingCustomer ? [existingCustomer] : [] }; },
      async create(params) { requests.push(['customers.create', params]); return { id: 'cus_new' }; },
      async list() { throw new Error('must not list customers by email'); },
      async update() { throw new Error('must not update customers'); },
      async retrieve() { throw new Error('checkout must not retrieve customers'); },
    },
    prices: {
      async list(params) {
        requests.push(['prices.list', params]);
        const key = params.lookup_keys[0];
        return { data: [{ id: `price_${key}`, lookup_key: key, active: true, type: 'recurring', product: 'prod_restpilot', recurring: { interval: key === 'restpilot_monthly' ? 'month' : 'year', interval_count: 1 } }] };
      },
    },
    products: { async retrieve(id) { requests.push(['products.retrieve', id]); return { name: 'RestPilot' }; } },
    checkout: { sessions: { async create(params) { requests.push(['checkout.sessions.create', params]); return { client_secret: 'cs_secret_test' }; } } },
    billingPortal: { sessions: { async create() { throw new Error('unexpected portal'); } } },
  };
  const supabase = { auth: { async getUser() { return { data: { user: { email: 'member@example.test' } } }; } } };
  function createServerFn() {
    let validator;
    const b = { middleware() { return b; }, inputValidator(fn) { validator = fn; return b; }, handler(fn) { return async (args) => fn({ ...args, data: validator(args.data) }); } };
    return b;
  }
  const envs = [];
  const ctx = vm.createContext({ URL, process: { env: { NODE_ENV: 'production' } }, createServerFn, requireSupabaseAuth: {},
    createStripeClient(env) { envs.push(env); return stripe; }, getStripeErrorMessage: (e) => e.message });
  const { createCheckoutSession } = vm.runInContext(`${source}\n({createCheckoutSession})`, ctx);
  const checkout = (priceId, environment = 'live') => createCheckoutSession({
    context: { supabase, userId: 'user-123' },
    data: { priceId, environment, returnUrl: 'https://restpilotai.com/profile?session_id={CHECKOUT_SESSION_ID}' },
  });
  // Cross-realm objects → plain JSON for exact comparison.
  return { checkout, requests: () => JSON.parse(JSON.stringify(requests)), envs };
}

const expectedSession = (priceId, customer) => ({
  line_items: [{ price: `price_${priceId}`, quantity: 1 }],
  mode: 'subscription',
  ui_mode: 'embedded_page',
  return_url: 'https://restpilotai.com/profile?session_id={CHECKOUT_SESSION_ID}',
  customer,
  metadata: { userId: 'user-123', priceId },
  subscription_data: { metadata: { userId: 'user-123' }, trial_period_days: 14 },
});

for (const priceId of ['restpilot_monthly', 'restpilot_annual']) {
  test(`${priceId}: new customer — exact Stripe request sequence and checkout payload`, async () => {
    const h = harness();
    assert.deepEqual(JSON.parse(JSON.stringify(await h.checkout(priceId))), { clientSecret: 'cs_secret_test' });
    assert.deepEqual(h.envs, ['live']);
    assert.deepEqual(h.requests(), [
      ['prices.list', { lookup_keys: [priceId], active: true }],
      ['customers.search', { query: "metadata['userId']:'user-123'", limit: 1 }],
      ['customers.create', { email: 'member@example.test', metadata: { userId: 'user-123' } }],
      ['checkout.sessions.create', expectedSession(priceId, 'cus_new')],
    ]);
  });

  test(`${priceId}: returning customer — reuses the owned customer, same payload`, async () => {
    const h = harness({ existingCustomer: { id: 'cus_owned', metadata: { userId: 'user-123' } } });
    await h.checkout(priceId, 'sandbox');
    assert.deepEqual(h.envs, ['sandbox']);
    const reqs = h.requests();
    assert.deepEqual(reqs.map(([name]) => name), ['prices.list', 'customers.search', 'checkout.sessions.create']);
    assert.deepEqual(reqs.at(-1)[1], expectedSession(priceId, 'cus_owned'));
  });

  test(`${priceId}: 14-day free trial is present and is the only trial setting`, async () => {
    const h = harness();
    await h.checkout(priceId);
    const session = h.requests().at(-1)[1];
    assert.equal(session.subscription_data.trial_period_days, 14);
    assert.equal(session.subscription_data.trial_end, undefined);
    assert.equal(session.payment_method_collection, undefined, 'card collection behaviour unchanged (Stripe default)');
    assert.equal(session.payment_intent_data, undefined);
  });
}

test('subscription flags do not reach the website checkout code path', () => {
  const billing = readFileSync(new URL('../src/lib/billing.functions.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(billing, /IAP_|revenuecat|entitlements\//i);
});
