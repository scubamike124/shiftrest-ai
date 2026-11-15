// Existing Stripe subscribers must keep working after new purchases move to
// the App Store: the signed Stripe webhook still records renewals, past_due,
// cancel-at-period-end, final cancellation, legacy lifetime purchases and
// payment failures. Runs the real route handler and the real signature check
// (src/lib/stripe.server.ts) with the database, email and Stripe SDK replaced.
// No network.
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';
import { loadTs } from './_load-ts.mjs';

const SECRET = 'whsec_unit_test_only';
const env = {
  SUPABASE_URL: 'https://db.invalid', SUPABASE_SERVICE_ROLE_KEY: 'service-role-test',
  PAYMENTS_LIVE_WEBHOOK_SECRET: SECRET, PAYMENTS_SANDBOX_WEBHOOK_SECRET: SECRET + '_sandbox',
  STRIPE_LIVE_API_KEY: 'sk_test_dummy', STRIPE_SANDBOX_API_KEY: 'sk_test_dummy', LOVABLE_API_KEY: 'lovable-test',
};

function harness() {
  const writes = []; const emails = []; const alerts = [];
  const db = {
    auth: { admin: { async getUserById(id) { return { data: { user: { email: `${id}@example.test` } } }; } } },
    from(table) {
      const q = {
        upsert(row, opts) { writes.push({ table, op: 'upsert', row, opts }); return Promise.resolve({ error: null }); },
        update(row) { const w = { table, op: 'update', row, where: [] }; writes.push(w); const u = { eq(c, v) { w.where.push([c, v]); return u; }, then(r) { return Promise.resolve({ error: null }).then(r); } }; return u; },
      };
      return q;
    },
  };
  class FakeStripe {
    static createFetchHttpClient() { return {}; }
    constructor() { this.checkout = { sessions: { async listLineItems() { return { data: [{ price: { lookup_key: 'restpilot_lifetime', product: 'prod_life' } }] }; } } }; }
  }
  const stripeServer = loadTs('src/lib/stripe.server.ts', { modules: { stripe: { default: FakeStripe } }, globals: { process: { env } } });
  const route = loadTs('src/routes/api/public/payments/webhook.ts', {
    modules: {
      '@tanstack/react-router': { createFileRoute: () => (cfg) => cfg },
      '@supabase/supabase-js': { createClient: () => db },
      '@/lib/stripe.server': stripeServer,
      '@/lib/email/send.server': { async sendTransactionalEmailServer(m) { emails.push(m.templateName); return { ok: true }; } },
      '@/lib/ops/alert.server': { async notifyOwner(a) { alerts.push(a.service); } },
    },
    globals: { process: { env } },
  });
  const post = (event, { envName = 'live', secret = SECRET, t = Math.floor(Date.now() / 1000) } = {}) => {
    const body = JSON.stringify(event);
    const sig = `t=${t},v1=${createHmac('sha256', secret).update(`${t}.${body}`).digest('hex')}`;
    return route.Route.server.handlers.POST({ request: new Request(`https://restpilotai.com/api/public/payments/webhook?env=${envName}`, { method: 'POST', body, headers: { 'stripe-signature': sig } }) });
  };
  return { writes, emails, alerts, post };
}

const periodEnd = Math.floor(Date.parse('2026-12-15T00:00:00Z') / 1000);
const sub = (o = {}) => ({ id: 'sub_1', customer: 'cus_1', status: 'active', cancel_at_period_end: false, metadata: { userId: 'u1' },
  items: { data: [{ price: { lookup_key: 'restpilot_monthly', product: 'prod_m' }, current_period_start: periodEnd - 30 * 86400, current_period_end: periodEnd }] }, ...o });

test('existing Stripe webhooks still processed: renewal moves the period end (customer.subscription.updated)', async () => {
  const h = harness();
  const res = await h.post({ type: 'customer.subscription.updated', data: { object: sub() } });
  assert.equal(res.status, 200);
  assert.equal(h.writes.length, 1);
  const w = h.writes[0];
  assert.equal(w.table, 'subscriptions'); assert.equal(w.op, 'upsert'); assert.deepEqual(w.opts, { onConflict: 'stripe_subscription_id' });
  assert.equal(w.row.status, 'active'); assert.equal(w.row.price_id, 'restpilot_monthly'); assert.equal(w.row.environment, 'live');
  assert.equal(w.row.current_period_end, '2026-12-15T00:00:00.000Z'); assert.equal(w.row.user_id, 'u1');
});

test('existing Stripe webhooks still processed: past_due, cancel at period end, annual', async () => {
  const h = harness();
  await h.post({ type: 'customer.subscription.updated', data: { object: sub({ status: 'past_due' }) } });
  await h.post({ type: 'customer.subscription.updated', data: { object: sub({ cancel_at_period_end: true }) } });
  await h.post({ type: 'customer.subscription.updated', data: { object: sub({ items: { data: [{ price: { lookup_key: 'restpilot_annual', product: 'prod_a' }, current_period_end: periodEnd }] } }) } });
  assert.deepEqual(h.writes.map((w) => [w.row.status, w.row.cancel_at_period_end, w.row.price_id]), [
    ['past_due', false, 'restpilot_monthly'], ['active', true, 'restpilot_monthly'], ['active', false, 'restpilot_annual'],
  ]);
});

test('existing Stripe webhooks still processed: final cancellation marks the row canceled and emails', async () => {
  const h = harness();
  const res = await h.post({ type: 'customer.subscription.deleted', data: { object: sub({ status: 'canceled' }) } });
  assert.equal(res.status, 200);
  assert.deepEqual(h.writes.map((w) => [w.op, w.row.status, w.where]), [['update', 'canceled', [['stripe_subscription_id', 'sub_1'], ['environment', 'live']]]]);
  assert.deepEqual(h.emails, ['subscription-canceled']);
});

test('existing Stripe webhooks still processed: a legacy lifetime payment is still recorded as lifetime', async () => {
  const h = harness();
  await h.post({ type: 'checkout.session.completed', data: { object: { id: 'cs_1', mode: 'payment', customer: 'cus_1', metadata: { userId: 'u1' }, amount_total: 9900, currency: 'usd' } } });
  const w = h.writes.find((x) => x.op === 'upsert');
  assert.equal(w.row.status, 'lifetime'); assert.equal(w.row.stripe_subscription_id, 'lifetime_cs_1'); assert.equal(w.row.current_period_end, null);
});

test('existing Stripe webhooks still processed: payment failure emails the customer and alerts the owner', async () => {
  const h = harness();
  await h.post({ type: 'invoice.payment_failed', data: { object: { id: 'in_1', customer_email: 'm@example.test', amount_due: 799, currency: 'usd' } } });
  assert.deepEqual(h.emails, ['payment-failed']);
  assert.deepEqual(h.alerts, ['stripe.invoice.payment_failed']);
  assert.equal(h.writes.length, 0);
});

test('Stripe webhook: forged, stale or wrong-environment signatures are refused without writing', async () => {
  for (const opts of [{ secret: 'wrong' }, { t: Math.floor(Date.now() / 1000) - 3600 }, { envName: 'sandbox' }]) {
    const h = harness();
    const res = await h.post({ type: 'customer.subscription.updated', data: { object: sub() } }, opts);
    assert.equal(res.status, 400, JSON.stringify(opts));
    assert.equal(h.writes.length, 0);
  }
  const h = harness();
  const res = await h.post({ type: 'customer.subscription.updated', data: { object: sub() } }, { envName: 'bogus' });
  assert.deepEqual(await res.json(), { received: true, ignored: 'invalid env' });
  assert.equal(h.writes.length, 0);
});
