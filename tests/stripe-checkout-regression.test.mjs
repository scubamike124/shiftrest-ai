// Regression lock for the production website Stripe checkout (owner: "Preserve
// the existing Lovable website and Stripe checkout"). Runs the real handler
// with Stripe/Supabase replaced, as a normal browser request, and pins the
// exact Stripe requests monthly and annual send, including the 14-day trial.
// Any change to what the website sends Stripe must fail here first.
import test from 'node:test';
import { assert, billingHarness } from './_native-harness.mjs';

const RETURN = 'https://restpilotai.com/profile?checkout=success&session_id={CHECKOUT_SESSION_ID}';
const session = (priceId, customer) => ({
  line_items: [{ price: `price_${priceId}`, quantity: 1 }],
  mode: 'subscription',
  ui_mode: 'embedded_page',
  return_url: RETURN,
  customer,
  metadata: { userId: 'user-123', priceId },
  subscription_data: { metadata: { userId: 'user-123' }, trial_period_days: 14 },
});

for (const priceId of ['restpilot_monthly', 'restpilot_annual']) {
  test(`website ${priceId}: new customer, exact Stripe requests`, async () => {
    const h = billingHarness({ webCheckout: true });
    assert.deepEqual(await h.checkout(priceId), { clientSecret: 'cs_secret_test' });
    assert.deepEqual(h.envs, ['live']);
    assert.deepEqual(h.requests(), [
      ['prices.list', { lookup_keys: [priceId] }],
      ['customers.search', { query: "metadata['userId']:'user-123'", limit: 1 }],
      ['customers.list', { email: 'member@example.test', limit: 1 }],
      ['customers.create', { email: 'member@example.test', metadata: { userId: 'user-123' } }],
      ['checkout.sessions.create', session(priceId, 'cus_new')],
    ]);
  });

  test(`website ${priceId}: returning customer by metadata, same session payload`, async () => {
    const h = billingHarness({ webCheckout: true, existingCustomer: { id: 'cus_owned', metadata: { userId: 'user-123' } } });
    await h.checkout(priceId, 'sandbox');
    assert.deepEqual(h.envs, ['sandbox']);
    const reqs = h.requests();
    assert.deepEqual(reqs.map((r) => r[0]), ['prices.list', 'customers.search', 'checkout.sessions.create']);
    assert.deepEqual(reqs.at(-1)[1], session(priceId, 'cus_owned'));
  });

  test(`website ${priceId}: existing customer found by email keeps today's behaviour`, async () => {
    const h = billingHarness({ webCheckout: true, emailCustomer: { id: 'cus_email', metadata: {} } });
    await h.checkout(priceId);
    const reqs = h.requests();
    assert.deepEqual(reqs.map((r) => r[0]), ['prices.list', 'customers.search', 'customers.list', 'customers.update', 'checkout.sessions.create']);
    assert.deepEqual(reqs.at(-1)[1], session(priceId, 'cus_email'));
  });

  test(`website ${priceId}: 14-day free trial is present`, async () => {
    const h = billingHarness({ webCheckout: true });
    await h.checkout(priceId);
    assert.equal(h.requests().at(-1)[1].subscription_data.trial_period_days, 14);
  });
}

test('website: Stripe customer portal unchanged', async () => {
  const h = billingHarness({ webCheckout: true });
  assert.deepEqual(await h.portal(), { url: 'https://billing.stripe.com/p/test' });
  assert.deepEqual(h.requests(), [
    ['billingPortal.sessions.create', { customer: 'cus_owned', return_url: 'https://restpilotai.com/profile' }],
  ]);
});
