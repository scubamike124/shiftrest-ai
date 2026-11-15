// The local StoreKit Testing file must describe exactly the App Store products
// the code sells: monthly $7.99 and annual $49.99, one subscription group,
// each with a free 2-week (14-day) introductory offer, and no lifetime product.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { loadTs } from './_load-ts.mjs';

const cfg = JSON.parse(fs.readFileSync(new URL('../ios-app/ios/App/RestPilot.storekit', import.meta.url), 'utf8'));
const { APP_STORE_PRODUCTS } = loadTs('src/lib/entitlements/revenuecat.ts');

test('StoreKit file: one subscription group with exactly the products the code sells', () => {
  assert.equal(cfg.subscriptionGroups.length, 1);
  const subs = cfg.subscriptionGroups[0].subscriptions;
  assert.deepEqual(subs.map((s) => s.productID).sort(), Object.keys(APP_STORE_PRODUCTS).sort());
  assert.deepEqual(cfg.products, [], 'no consumable or lifetime products');
  assert.deepEqual(cfg.nonRenewingSubscriptions, []);
  assert.ok(subs.every((s) => s.type === 'RecurringSubscription' && s.subscriptionGroupID === cfg.subscriptionGroups[0].id));
});

test('StoreKit file: fixed prices, periods and the 14-day free trial', () => {
  const byId = Object.fromEntries(cfg.subscriptionGroups[0].subscriptions.map((s) => [s.productID, s]));
  assert.equal(byId.restpilot_monthly.displayPrice, '7.99');
  assert.equal(byId.restpilot_monthly.recurringSubscriptionPeriod, 'P1M');
  assert.equal(byId.restpilot_annual.displayPrice, '49.99');
  assert.equal(byId.restpilot_annual.recurringSubscriptionPeriod, 'P1Y');
  for (const s of Object.values(byId)) {
    assert.deepEqual({ paymentMode: s.introductoryOffer.paymentMode, subscriptionPeriod: s.introductoryOffer.subscriptionPeriod }, { paymentMode: 'free', subscriptionPeriod: 'P2W' });
  }
  assert.ok(byId.restpilot_annual.groupNumber < byId.restpilot_monthly.groupNumber, 'annual ranks above monthly (upgrade, not a second subscription)');
  assert.equal(cfg.settings._storefront, 'USA');
});
