import assert from 'node:assert/strict';
import test from 'node:test';
import { loadTs } from './_load-ts.mjs';

const { decidePaywall, isUsStorefront } = loadTs('src/lib/entitlements/paywall-policy.ts');
const { mergeEntitlements, NO_ENTITLEMENT } = loadTs('src/lib/entitlements/merge.ts');

const NOW = Date.parse('2026-11-14T12:00:00Z');
const future = new Date(NOW + 30 * 86_400_000).toISOString();
const opts = { stripeEnvironment: 'live', appleEnvironments: ['live', 'sandbox'], now: NOW };
const stripeActive = mergeEntitlements([{ status: 'active', price_id: 'restpilot_monthly', current_period_end: future, cancel_at_period_end: false, environment: 'live' }], [], opts);
const appleActive = mergeEntitlements([], [{ environment: 'live', plan: 'annual', period_type: 'normal', expires_at: future, grace_expires_at: null, will_renew: true }], opts);
const both = mergeEntitlements(
  [{ status: 'active', price_id: 'restpilot_monthly', current_period_end: future, cancel_at_period_end: false, environment: 'live' }],
  [{ environment: 'live', plan: 'annual', period_type: 'normal', expires_at: future, grace_expires_at: null, will_renew: true }], opts);

const input = (o = {}) => ({ surface: 'ios', iapAvailable: true, storefront: 'USA', usExternalLinkEnabled: false, webCheckoutEnabled: false, entitlement: NO_ENTITLEMENT, ...o });

test('US storefront detection accepts StoreKit alpha-3 and alpha-2 only', () => {
  for (const s of ['USA', 'usa', ' US ', 'US']) assert.equal(isUsStorefront(s), true);
  for (const s of ['GBR', 'DEU', 'JPN', 'KOR', 'CAN', 'USAA', '', null, undefined, 1]) assert.equal(isUsStorefront(s), false);
});

test('native iOS, not subscribed: IAP purchase and restore, never web checkout', () => {
  const d = decidePaywall(input());
  assert.equal(d.view, 'purchase'); assert.equal(d.purchase, 'iap'); assert.equal(d.restore, true);
  assert.equal(d.externalPurchaseLink, false, 'link flag is off by default');
});

test('native iOS never offers web checkout, even when the website has Stripe configured', () => {
  for (const storefront of ['USA', 'GBR', null]) for (const usExternalLinkEnabled of [true, false]) for (const iapAvailable of [true, false]) {
    const d = decidePaywall(input({ storefront, usExternalLinkEnabled, iapAvailable, webCheckoutEnabled: true }));
    assert.notEqual(d.purchase, 'web_checkout');
  }
});

test('external purchase link only on the US storefront, with its flag, next to IAP', () => {
  assert.equal(decidePaywall(input({ usExternalLinkEnabled: true })).externalPurchaseLink, true);
  for (const storefront of ['GBR', 'DEU', 'FRA', 'NLD', 'JPN', 'KOR', 'CAN', 'AUS', null, '']) {
    assert.equal(decidePaywall(input({ storefront, usExternalLinkEnabled: true })).externalPurchaseLink, false, String(storefront));
  }
  const noIap = decidePaywall(input({ usExternalLinkEnabled: true, iapAvailable: false }));
  assert.equal(noIap.externalPurchaseLink, false); assert.equal(noIap.view, 'unavailable'); assert.equal(noIap.restore, false);
});

test('IAP unavailable in the app (flag off, no key or no plugin): nothing to buy, no links', () => {
  const d = decidePaywall(input({ iapAvailable: false }));
  assert.equal(d.view, 'unavailable'); assert.equal(d.purchase, null); assert.equal(d.externalPurchaseLink, false);
});

test('Android or other native shells: no purchase and no links (no Play Billing integration)', () => {
  const d = decidePaywall(input({ surface: 'other_native', usExternalLinkEnabled: true }));
  assert.equal(d.view, 'unavailable'); assert.equal(d.purchase, null); assert.equal(d.externalPurchaseLink, false); assert.equal(d.restore, false);
});

test('unknown status never shows a buy button', () => {
  for (const surface of ['ios', 'web', 'other_native']) {
    const d = decidePaywall(input({ surface, entitlement: null, webCheckoutEnabled: true }));
    assert.equal(d.view, 'loading'); assert.equal(d.purchase, null); assert.equal(d.externalPurchaseLink, false);
  }
});

test('Stripe subscriber in the app: status and manage-on-web text, no buy button', () => {
  const d = decidePaywall(input({ entitlement: stripeActive, storefront: 'GBR', usExternalLinkEnabled: true }));
  assert.equal(d.view, 'status'); assert.equal(d.purchase, null); assert.equal(d.externalPurchaseLink, false);
  assert.deepEqual(d.manage, [{ source: 'stripe', path: 'stripe_text_only' }]);
  assert.deepEqual(decidePaywall(input({ entitlement: stripeActive })).manage, [{ source: 'stripe', path: 'stripe_text_only' }], 'US without flag: text only');
  assert.deepEqual(decidePaywall(input({ entitlement: stripeActive, usExternalLinkEnabled: true })).manage, [{ source: 'stripe', path: 'stripe_portal' }], 'US with flag: link');
});

test('Apple subscriber in the app: App Store manage path and restore', () => {
  const d = decidePaywall(input({ entitlement: appleActive }));
  assert.equal(d.view, 'status'); assert.equal(d.purchase, null); assert.equal(d.restore, true);
  assert.deepEqual(d.manage, [{ source: 'apple', path: 'app_store' }]);
});

test('Apple subscriber on the website: status, App Store manage path, no Stripe checkout', () => {
  const d = decidePaywall(input({ surface: 'web', entitlement: appleActive, webCheckoutEnabled: true }));
  assert.equal(d.view, 'status'); assert.equal(d.purchase, null); assert.equal(d.restore, false);
  assert.deepEqual(d.manage, [{ source: 'apple', path: 'app_store' }]);
});

test('website: Stripe checkout only when configured; Stripe subscriber gets the portal', () => {
  assert.equal(decidePaywall(input({ surface: 'web', webCheckoutEnabled: true })).purchase, 'web_checkout');
  assert.equal(decidePaywall(input({ surface: 'web', webCheckoutEnabled: false })).view, 'unavailable');
  assert.equal(decidePaywall(input({ surface: 'web', webCheckoutEnabled: true })).restore, false);
  assert.deepEqual(decidePaywall(input({ surface: 'web', webCheckoutEnabled: true, entitlement: stripeActive })).manage, [{ source: 'stripe', path: 'stripe_portal' }]);
});

test('double billing: warning and both manage paths, no buy button', () => {
  const d = decidePaywall(input({ entitlement: both }));
  assert.equal(d.view, 'status'); assert.equal(d.duplicateBillingWarning, true); assert.equal(d.purchase, null);
  assert.deepEqual(d.manage.map((x) => x.source).sort(), ['apple', 'stripe']);
});
