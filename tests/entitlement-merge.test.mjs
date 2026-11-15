import assert from 'node:assert/strict';
import test from 'node:test';
import { loadTs } from './_load-ts.mjs';

const m = loadTs('src/lib/entitlements/merge.ts');
const NOW = Date.parse('2026-11-14T12:00:00Z');
const DAY = 86_400_000;
const iso = (ms) => new Date(ms).toISOString();
const opts = (extra = {}) => ({ stripeEnvironment: 'live', appleEnvironments: ['live', 'sandbox'], now: NOW, ...extra });

const stripe = (o = {}) => ({ status: 'active', price_id: 'restpilot_monthly', current_period_end: iso(NOW + 10 * DAY), cancel_at_period_end: false, environment: 'live', ...o });
const apple = (o = {}) => ({ environment: 'live', plan: 'annual', period_type: 'normal', expires_at: iso(NOW + 200 * DAY), grace_expires_at: null, will_renew: true, ...o });
const merge = (s, a, o) => m.mergeEntitlements(s, a, opts(o));

test('no rows, null rows and empty rows are not entitled', () => {
  for (const [s, a] of [[[], []], [null, null], [undefined, undefined]]) {
    const e = merge(s, a);
    assert.equal(e.active, false); assert.equal(e.source, null); assert.equal(e.state, 'none'); assert.equal(e.duplicateBilling, false);
  }
});

test('Stripe-only active monthly subscriber', () => {
  const e = merge([stripe()], []);
  assert.equal(e.active, true); assert.equal(e.source, 'stripe'); assert.equal(e.plan, 'monthly'); assert.equal(e.state, 'active');
  assert.equal(e.willRenew, true); assert.equal(e.hasStripe, true); assert.equal(e.hasApple, false); assert.equal(e.duplicateBilling, false);
});

test('Apple-only annual subscriber', () => {
  const e = merge([], [apple()]);
  assert.equal(e.source, 'apple'); assert.equal(e.plan, 'annual'); assert.equal(e.state, 'active'); assert.equal(e.hasApple, true);
});

test('Stripe grant rules match the voice gate: trial, canceled-paid-through, lifetime', () => {
  assert.equal(merge([stripe({ status: 'trialing' })], []).state, 'trialing');
  const canceled = merge([stripe({ status: 'canceled' })], []);
  assert.equal(canceled.active, true); assert.equal(canceled.state, 'grace'); assert.equal(canceled.willRenew, false);
  const ending = merge([stripe({ cancel_at_period_end: true })], []);
  assert.equal(ending.state, 'grace'); assert.equal(ending.willRenew, false);
  const lifetime = merge([stripe({ status: 'lifetime', price_id: 'restpilot_lifetime', current_period_end: null })], []);
  assert.equal(lifetime.state, 'lifetime'); assert.equal(lifetime.plan, 'lifetime'); assert.equal(lifetime.expiresAt, null);
});

for (const status of ['past_due', 'unpaid', 'incomplete', 'incomplete_expired', 'paused', '', null, 'ACTIVE']) {
  test(`Stripe status ${JSON.stringify(status)} grants nothing`, () => {
    assert.equal(merge([stripe({ status })], []).active, false);
  });
}

for (const current_period_end of [null, '', 'not-a-date', iso(NOW - 1), iso(NOW)]) {
  test(`Stripe active with period end ${JSON.stringify(current_period_end)} grants nothing`, () => {
    assert.equal(merge([stripe({ current_period_end })], []).active, false);
  });
}

test('Stripe rows from the other environment are ignored (sandbox never grants live)', () => {
  assert.equal(merge([stripe({ environment: 'sandbox' })], []).active, false);
  assert.equal(merge([stripe({ environment: 'sandbox' })], [], { stripeEnvironment: 'sandbox' }).active, true);
  assert.equal(merge([stripe({ environment: null })], []).active, false);
  assert.equal(merge([stripe()], [], { stripeEnvironment: null }).active, false);
});

test('Apple rows are honored only for configured environments (IAP off honors none)', () => {
  assert.equal(merge([], [apple()], { appleEnvironments: [] }).active, false);
  assert.equal(merge([], [apple({ environment: 'sandbox' })], { appleEnvironments: ['live'] }).active, false);
  assert.equal(merge([], [apple({ environment: 'sandbox' })]).active, true);
  assert.equal(merge([], [apple({ environment: 'prod' })]).active, false);
});

test('Apple expiry, grace period, trial and cancellation', () => {
  assert.equal(merge([], [apple({ expires_at: null })]).active, false, 'no expiry never grants');
  assert.equal(merge([], [apple({ expires_at: 'garbage' })]).active, false);
  assert.equal(merge([], [apple({ expires_at: iso(NOW - DAY) })]).active, false, 'expired');
  const grace = merge([], [apple({ expires_at: iso(NOW - DAY), grace_expires_at: iso(NOW + 3 * DAY) })]);
  assert.equal(grace.active, true); assert.equal(grace.state, 'grace'); assert.equal(grace.expiresAt, NOW + 3 * DAY);
  assert.equal(merge([], [apple({ period_type: 'trial' })]).state, 'trialing');
  const canceled = merge([], [apple({ will_renew: false })]);
  assert.equal(canceled.state, 'grace'); assert.equal(canceled.willRenew, false);
  assert.equal(merge([], [apple({ plan: 'lifetime' })]).plan, null, 'no Apple lifetime product exists');
});

test('both channels renewing is flagged as duplicate billing; paid outranks trial', () => {
  const e = merge([stripe()], [apple({ period_type: 'trial' })]);
  assert.equal(e.duplicateBilling, true);
  assert.equal(e.source, 'stripe', 'paid Stripe beats an Apple trial');
  assert.deepEqual(e.channels.map((c) => c.source), ['stripe', 'apple']);
  assert.equal(e.hasStripe && e.hasApple, true);
});

test('a canceled channel next to a renewing one is not double billing', () => {
  const e = merge([stripe({ cancel_at_period_end: true })], [apple()]);
  assert.equal(e.duplicateBilling, false);
  assert.equal(e.source, 'apple', 'renewing paid Apple beats a non-renewing Stripe period');
});

test('lifetime always wins and an extra renewing channel is still flagged as duplicate', () => {
  const life = stripe({ status: 'lifetime', price_id: 'restpilot_lifetime', current_period_end: null });
  const e = merge([life], [apple()]);
  assert.equal(e.state, 'lifetime'); assert.equal(e.duplicateBilling, false, 'only one channel renews');
  const two = merge([life, stripe()], [apple()]);
  assert.equal(two.duplicateBilling, true);
});

test('tie on state and renewal: later expiry first, then Stripe before Apple', () => {
  const e = merge([stripe({ current_period_end: iso(NOW + 5 * DAY) })], [apple({ expires_at: iso(NOW + 50 * DAY) })]);
  assert.equal(e.source, 'apple');
  const tie = merge([stripe({ current_period_end: iso(NOW + 5 * DAY) })], [apple({ expires_at: iso(NOW + 5 * DAY) })]);
  assert.equal(tie.source, 'stripe');
});

test('NO_ENTITLEMENT is immutable', () => {
  assert.throws(() => { 'use strict'; m.NO_ENTITLEMENT.active = true; });
  assert.equal(m.NO_ENTITLEMENT.active, false);
});

test('Apple rows adapt to the voice gate row shape', () => {
  const rows = m.appleRowsAsSubscriptionRows([
    apple(), apple({ environment: 'sandbox', period_type: 'trial' }), apple({ will_renew: false }), apple({ expires_at: iso(NOW - DAY) }),
  ], ['live', 'sandbox'], NOW);
  assert.deepEqual(rows.map((r) => r.status), ['active', 'trialing', 'canceled']);
  assert.ok(rows.every((r) => Date.parse(r.current_period_end) > NOW));
  assert.deepEqual(m.appleRowsAsSubscriptionRows([apple()], [], NOW), []);
});

test('status Stripe environment: explicit, token-derived, else live (never throws)', () => {
  assert.equal(m.statusStripeEnvironment({ PAYMENTS_ENVIRONMENT: 'sandbox' }), 'sandbox');
  assert.equal(m.statusStripeEnvironment({ PAYMENTS_ENVIRONMENT: 'live', VITE_PAYMENTS_CLIENT_TOKEN: 'pk_test_x' }), 'live');
  assert.equal(m.statusStripeEnvironment({ VITE_PAYMENTS_CLIENT_TOKEN: 'pk_test_x' }), 'sandbox');
  assert.equal(m.statusStripeEnvironment({ VITE_PAYMENTS_CLIENT_TOKEN: 'pk_live_x' }), 'live');
  assert.equal(m.statusStripeEnvironment({}), 'live');
  assert.equal(m.statusStripeEnvironment({ PAYMENTS_ENVIRONMENT: 'bogus' }), 'live');
});

test('Apple environments: none unless IAP is on; sandbox only with its own opt-in', () => {
  assert.deepEqual(m.appleEnvironmentsFrom({}), []);
  assert.deepEqual(m.appleEnvironmentsFrom({ IAP_HONOR_SANDBOX: 'true' }), []);
  assert.deepEqual(m.appleEnvironmentsFrom({ IAP_ENABLED: 'true' }), ['live']);
  assert.deepEqual(m.appleEnvironmentsFrom({ IAP_ENABLED: 'true', IAP_HONOR_SANDBOX: '1' }), ['live']);
  assert.deepEqual(m.appleEnvironmentsFrom({ IAP_ENABLED: 'true', IAP_HONOR_SANDBOX: 'true' }), ['live', 'sandbox']);
});

test('voice adapter: billing grace right after an Apple free trial stays metered as a trial', () => {
  const rows = m.appleRowsAsSubscriptionRows([
    apple({ period_type: 'trial', expires_at: iso(NOW - DAY), grace_expires_at: iso(NOW + 5 * DAY) }),
  ], ['live'], NOW);
  assert.deepEqual(rows.map((r) => r.status), ['trialing']);
});
