// End-to-end (IO mocked) subscription lifecycle across Stripe and the App Store.
// Each group maps to an owner requirement (Nov 15) and to the "Verification"
// section of docs/restpilot-upgrade-2026-11/SUBSCRIPTIONS.md:
//   (a) restore, (b) cancellation, (c) duplicate prevention.
//
// RevenueCat webhooks use RevenueCat's documented body shape
// ({api_version, event:{id,type,app_user_id,original_app_user_id,aliases,...}};
// TRANSFER carries transferred_from/transferred_to) and are HMAC-signed exactly
// as RevenueCat signs them (X-RevenueCat-Webhook-Signature: t=<unix>,v1=<hex of
// HMAC-SHA256("<t>.<raw body>")>). The canonical state comes from a mocked
// GET /v1/subscribers/{id} in RevenueCat's documented response shape. The App
// Store table is an in-memory model of apply_store_entitlement's ordering rule
// (the real SQL is exercised by scripts/qa/verify-store-entitlements.mjs).
// No network: live Apple sandbox verification needs the owner's App Store
// Connect and RevenueCat setup (SUBSCRIPTIONS.md section 7).
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
import test from 'node:test';
import { loadTs } from './_load-ts.mjs';

const merge = loadTs('src/lib/entitlements/merge.ts');
const policy = loadTs('src/lib/entitlements/paywall-policy.ts');
const rc = loadTs('src/lib/entitlements/revenuecat.ts');
const sync = loadTs('src/lib/entitlements/store-sync.server.ts', { modules: { './revenuecat': rc } });
const guard = loadTs('src/lib/entitlements/checkout-guard.ts', { modules: { './merge': merge } });

const ALICE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const BOB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const DAY = 86_400_000;
const SECRET = 'rc_webhook_signing_secret_test';
const ENV_ON = { IAP_ENABLED: 'true', REVENUECAT_WEBHOOK_SECRET: SECRET, REVENUECAT_SECRET_API_KEY: 'sk_test_fixture' };
const iso = (ms) => new Date(ms).toISOString();

// ---- a small world: RevenueCat's canonical state + our store table ----------
function world({ env = ENV_ON } = {}) {
  let clock = Date.now();
  const rcState = new Map(); // app_user_id -> { productId: subscription }
  const table = new Map();   // `${user}:${env}` -> row (model of public.store_entitlements)
  const stripeRows = new Map(); // user -> public.subscriptions rows
  const fetched = [];
  const processed = new Set();
  const deps = {
    env,
    nowSeconds: () => Math.floor(clock / 1000),
    async fetch(url, init) {
      assert.equal(init.headers.Authorization, `Bearer ${env.REVENUECAT_SECRET_API_KEY}`);
      const id = decodeURIComponent(url.split('/subscribers/')[1]);
      fetched.push(id);
      // Documented GET /v1/subscribers/{app_user_id} shape.
      return Response.json({
        request_date: iso(clock), request_date_ms: clock,
        subscriber: { original_app_user_id: id, first_seen: iso(clock - 90 * DAY), management_url: 'https://apps.apple.com/account/subscriptions',
          entitlements: {}, non_subscriptions: {}, other_purchases: {}, subscriptions: rcState.get(id) ?? {} },
      });
    },
    async applySnapshot(s) { // same ordering rule as apply_store_entitlement
      const key = `${s.user_id}:${s.environment}`;
      const cur = table.get(key);
      if (cur && Date.parse(cur.snapshot_at) > Date.parse(s.snapshot_at)) return false;
      table.set(key, { ...s });
      return true;
    },
    async isProcessed(id) { return processed.has(id); },
    async markProcessed(id) { processed.add(id); },
  };
  const rowsFor = (user) => [...table.values()].filter((r) => r.user_id === user);
  const supabaseFor = (user) => ({
    from(t) {
      const data = t === 'store_entitlements' ? rowsFor(user) : t === 'subscriptions' ? (stripeRows.get(user) ?? []) : null;
      assert.ok(data, `unexpected table ${t}`);
      const q = { select() { return q; }, eq(k, v) { assert.equal(k, 'user_id'); assert.equal(v, user, 'reads only the signed-in user'); return q; },
        then(resolve, reject) { return Promise.resolve({ data, error: null }).then(resolve, reject); } };
      return q;
    },
  });
  const entitlement = (user, at = clock, extra = {}) => merge.mergeEntitlements(stripeRows.get(user) ?? [], rowsFor(user), {
    stripeEnvironment: 'live', appleEnvironments: merge.appleEnvironmentsFrom(env), now: at, ...extra });
  const webhook = (event) => {
    const raw = JSON.stringify({ api_version: '1.0', event });
    const t = Math.floor(clock / 1000);
    const sig = `t=${t},v1=${createHmac('sha256', SECRET).update(`${t}.${raw}`).digest('hex')}`;
    return sync.handleRevenueCatWebhook(new Request('https://restpilotai.com/api/public/iap/revenuecat',
      { method: 'POST', body: raw, headers: { 'content-type': 'application/json', 'x-revenuecat-webhook-signature': sig } }), deps);
  };
  return { deps, rcState, table, stripeRows, fetched, processed, rowsFor, supabaseFor, entitlement, webhook,
    get now() { return clock; }, advance(ms) { clock += ms; } };
}

const appStoreSub = (now, o = {}) => ({ store: 'app_store', is_sandbox: false, period_type: 'normal', purchase_date: iso(now - DAY),
  original_purchase_date: iso(now - DAY), expires_date: iso(now + 30 * DAY), unsubscribe_detected_at: null,
  billing_issues_detected_at: null, grace_period_expires_date: null, refunded_at: null, ownership_type: 'PURCHASED', ...o });
let n = 0;
const rcEvent = (type, user, now, extra = {}) => ({ id: `evt_${++n}`, type, event_timestamp_ms: now, app_id: 'app_fixture',
  app_user_id: user, original_app_user_id: user, aliases: [user], product_id: 'restpilot_monthly', period_type: 'NORMAL',
  purchased_at_ms: now - DAY, expiration_at_ms: now + 30 * DAY, environment: 'PRODUCTION', entitlement_ids: ['premium'],
  store: 'APP_STORE', transaction_id: `tx_${n}`, original_transaction_id: 'otx_1', ...extra });

// The real server functions, with framework/IO replaced.
function serverFns(w, env = w.deps.env) {
  return loadTs('src/lib/entitlements/entitlement.functions.ts', {
    modules: {
      '@tanstack/react-start': { createServerFn() { const b = { middleware: () => b, inputValidator: () => b, handler: (fn) => fn }; return b; } },
      '@/integrations/supabase/auth-middleware': { requireSupabaseAuth: {} },
      './merge': merge,
      './store-sync.server': sync,
      './store-db.server': { storeSyncDeps: async () => w.deps },
    },
    globals: { process: { env } },
  });
}

// ============================ (a) RESTORE ====================================
test('(a) restore: the signed-in user restores and their Apple entitlement is synced and returned', async () => {
  const w = world();
  w.rcState.set(ALICE, { restpilot_annual: appStoreSub(w.now) });
  const fns = serverFns(w);
  const res = await fns.syncMyStoreEntitlement({ context: { userId: ALICE, supabase: w.supabaseFor(ALICE) } });
  assert.deepEqual(w.fetched, [ALICE]);
  assert.equal(res.entitlement.active, true);
  assert.equal(res.entitlement.source, 'apple');
  assert.equal(res.entitlement.plan, 'annual');
  assert.equal(res.appleManagementUrl, 'https://apps.apple.com/account/subscriptions');
});

test('(a) restore: never acts for another user ID, even if the client sends one', async () => {
  const w = world();
  const fns = serverFns(w);
  await fns.syncMyStoreEntitlement({ context: { userId: ALICE, supabase: w.supabaseFor(ALICE) }, data: { userId: BOB, appUserID: BOB } });
  assert.deepEqual(w.fetched, [ALICE]);
  assert.ok(w.rowsFor(BOB).length === 0);
  const src = readFileSync(new URL('../src/lib/entitlements/entitlement.functions.ts', import.meta.url), 'utf8');
  assert.match(src, /syncStoreEntitlement\(context\.userId,/);
  assert.doesNotMatch(src, /inputValidator/, 'the sync takes no client input at all');
});

test('(a) restore: throttled to one RevenueCat lookup per user per 10 seconds, with an explicit message', async () => {
  const w = world();
  const fns = serverFns(w);
  const ctx = { context: { userId: ALICE, supabase: w.supabaseFor(ALICE) } };
  await fns.syncMyStoreEntitlement(ctx);
  const second = await fns.syncMyStoreEntitlement(ctx);
  assert.match(second.error, /try again in a few seconds/);
  assert.deepEqual(w.fetched, [ALICE], 'second call made no RevenueCat request');
  await fns.syncMyStoreEntitlement({ context: { userId: BOB, supabase: w.supabaseFor(BOB) } });
  assert.deepEqual(w.fetched, [ALICE, BOB], 'throttle is per user');
});

test('(a) restore: refused when IAP is off; no RevenueCat request', async () => {
  const w = world({ env: {} });
  const res = await serverFns(w).syncMyStoreEntitlement({ context: { userId: ALICE, supabase: w.supabaseFor(ALICE) } });
  assert.match(res.error, /not available/);
  assert.deepEqual(w.fetched, []);
});

test('(a) restore: TRANSFER to another account revokes the old account and grants the new one', async () => {
  const w = world();
  w.rcState.set(ALICE, { restpilot_monthly: appStoreSub(w.now) });
  assert.equal((await w.webhook(rcEvent('INITIAL_PURCHASE', ALICE, w.now))).status, 200);
  assert.equal(w.entitlement(ALICE).active, true);
  // Bob signs in on the same Apple Account and taps Restore: RevenueCat moves the purchase.
  w.advance(60_000);
  w.rcState.set(BOB, w.rcState.get(ALICE));
  w.rcState.set(ALICE, {});
  const transfer = { id: `evt_${++n}`, type: 'TRANSFER', event_timestamp_ms: w.now, app_id: 'app_fixture', store: 'APP_STORE',
    environment: 'PRODUCTION', transferred_from: [ALICE], transferred_to: [BOB] };
  assert.equal((await w.webhook(transfer)).status, 200);
  assert.deepEqual(new Set(w.fetched.slice(-2)), new Set([ALICE, BOB]));
  assert.equal(w.entitlement(ALICE).active, false, 'old account loses access');
  assert.equal(w.entitlement(BOB).active, true, 'new account gains access');
});

// ============================ (b) CANCELLATION ===============================
test('(b) cancellation: Apple CANCELLATION keeps access to the end of the paid period, then revokes', async () => {
  const w = world();
  const end = w.now + 20 * DAY;
  w.rcState.set(ALICE, { restpilot_monthly: appStoreSub(w.now, { expires_date: iso(end) }) });
  await w.webhook(rcEvent('INITIAL_PURCHASE', ALICE, w.now));
  w.advance(1000);
  w.rcState.set(ALICE, { restpilot_monthly: appStoreSub(w.now, { expires_date: iso(end), unsubscribe_detected_at: iso(w.now) }) });
  assert.equal((await w.webhook(rcEvent('CANCELLATION', ALICE, w.now, { cancel_reason: 'UNSUBSCRIBE', expiration_at_ms: end }))).status, 200);
  const during = w.entitlement(ALICE);
  assert.equal(during.active, true, 'not revoked immediately');
  assert.equal(during.willRenew, false);
  assert.equal(during.state, 'grace');
  assert.equal(during.expiresAt, Date.parse(iso(end)));
  assert.equal(w.entitlement(ALICE, end + 1).active, false, 'revoked after the period ends');
});

test('(b) cancellation: Apple EXPIRATION revokes access', async () => {
  const w = world();
  w.rcState.set(ALICE, { restpilot_monthly: appStoreSub(w.now) });
  await w.webhook(rcEvent('INITIAL_PURCHASE', ALICE, w.now));
  w.advance(1000);
  w.rcState.set(ALICE, { restpilot_monthly: appStoreSub(w.now, { expires_date: iso(w.now - 1000), unsubscribe_detected_at: iso(w.now - DAY) }) });
  assert.equal((await w.webhook(rcEvent('EXPIRATION', ALICE, w.now, { expiration_reason: 'UNSUBSCRIBE', expiration_at_ms: w.now - 1000 }))).status, 200);
  assert.equal(w.entitlement(ALICE).active, false);
});

test('(b) cancellation: Apple refund (CUSTOMER_SUPPORT) revokes immediately', async () => {
  const w = world();
  w.rcState.set(ALICE, { restpilot_annual: appStoreSub(w.now) });
  await w.webhook(rcEvent('INITIAL_PURCHASE', ALICE, w.now, { product_id: 'restpilot_annual' }));
  w.advance(1000);
  w.rcState.set(ALICE, { restpilot_annual: appStoreSub(w.now, { refunded_at: iso(w.now) }) });
  await w.webhook(rcEvent('CANCELLATION', ALICE, w.now, { cancel_reason: 'CUSTOMER_SUPPORT', product_id: 'restpilot_annual' }));
  assert.equal(w.entitlement(ALICE).active, false);
});

test('(b) cancellation: Apple billing issue keeps access through Apple grace, then revokes', async () => {
  const w = world();
  const expired = w.now - DAY, graceEnd = w.now + 5 * DAY;
  w.rcState.set(ALICE, { restpilot_monthly: appStoreSub(w.now, { expires_date: iso(expired), billing_issues_detected_at: iso(expired), grace_period_expires_date: iso(graceEnd) }) });
  await w.webhook(rcEvent('BILLING_ISSUE', ALICE, w.now));
  assert.equal(w.entitlement(ALICE).active, true);
  assert.equal(w.entitlement(ALICE, graceEnd + 1).active, false);
});

test('(b) cancellation: a late, older webhook snapshot cannot undo a cancellation', async () => {
  const w = world();
  w.rcState.set(ALICE, { restpilot_monthly: appStoreSub(w.now, { expires_date: iso(w.now - 1) }) });
  w.advance(5000);
  await w.webhook(rcEvent('EXPIRATION', ALICE, w.now));
  // A stale snapshot (older RevenueCat request time) arrives late.
  const stale = rc.snapshotsFromSubscriber(ALICE, { request_date_ms: w.now - 4000, subscriber: { subscriptions: { restpilot_monthly: appStoreSub(w.now) } } });
  for (const s of stale) assert.equal(await w.deps.applySnapshot(s), false);
  assert.equal(w.entitlement(ALICE).active, false);
});

test('(b) cancellation: Stripe cancel-at-period-end keeps access until the period ends, then revokes', () => {
  const w = world();
  const end = w.now + 12 * DAY;
  w.stripeRows.set(ALICE, [{ status: 'active', price_id: 'restpilot_monthly', current_period_end: iso(end), cancel_at_period_end: true, environment: 'live' }]);
  const e = w.entitlement(ALICE);
  assert.equal(e.active, true); assert.equal(e.source, 'stripe'); assert.equal(e.willRenew, false); assert.equal(e.expiresAt, end);
  assert.equal(w.entitlement(ALICE, end + 1).active, false);
});

test('(b) cancellation: Stripe subscription deleted (status canceled) honors the paid-through date, then revokes', () => {
  const w = world();
  const end = w.now + 3 * DAY;
  w.stripeRows.set(ALICE, [{ status: 'canceled', price_id: 'restpilot_annual', current_period_end: iso(end), cancel_at_period_end: false, environment: 'live' }]);
  assert.equal(w.entitlement(ALICE).active, true);
  assert.equal(w.entitlement(ALICE, end + 1).active, false);
  w.stripeRows.set(BOB, [{ status: 'canceled', price_id: 'restpilot_annual', current_period_end: iso(w.now - 1), cancel_at_period_end: false, environment: 'live' }]);
  assert.equal(w.entitlement(BOB).active, false, 'already past period end: no access');
});

// ============================ (c) DUPLICATE PREVENTION =======================
const decide = (surface, entitlement, o = {}) => policy.decidePaywall({ surface, iapAvailable: surface === 'ios', storefront: 'USA',
  usExternalLinkEnabled: false, webCheckoutEnabled: surface === 'web', entitlement, ...o });

test('(c) duplicates: a Stripe-active user in the app sees status, no buy button', () => {
  const w = world();
  w.stripeRows.set(ALICE, [{ status: 'active', price_id: 'restpilot_monthly', current_period_end: iso(w.now + 9 * DAY), cancel_at_period_end: false, environment: 'live' }]);
  const d = decide('ios', w.entitlement(ALICE));
  assert.equal(d.view, 'status'); assert.equal(d.purchase, null); assert.equal(d.externalPurchaseLink, false);
});

test('(c) duplicates: a Stripe-active user is recognized in the app even when this build has no Stripe environment configured', () => {
  const status = merge.statusStripeEnvironment({});
  assert.equal(status, 'live');
  const e = merge.mergeEntitlements([{ status: 'active', price_id: 'restpilot_annual', current_period_end: iso(Date.now() + DAY), cancel_at_period_end: false, environment: 'live' }], [],
    { stripeEnvironment: status, appleEnvironments: ['live'] });
  assert.equal(decide('ios', e).purchase, null);
});

test('(c) duplicates: an Apple-active user on the website sees no Stripe checkout', async () => {
  const w = world();
  w.rcState.set(ALICE, { restpilot_monthly: appStoreSub(w.now) });
  await w.webhook(rcEvent('INITIAL_PURCHASE', ALICE, w.now));
  const d = decide('web', w.entitlement(ALICE));
  assert.equal(d.view, 'status'); assert.equal(d.purchase, null);
  assert.deepEqual(d.manage, [{ source: 'apple', path: 'app_store' }]);
});

test('(c) duplicates: server guard REFUSES website Stripe checkout for an Apple-active user (no Stripe call)', async () => {
  const w = world();
  w.rcState.set(ALICE, { restpilot_annual: appStoreSub(w.now) });
  await w.webhook(rcEvent('INITIAL_PURCHASE', ALICE, w.now, { product_id: 'restpilot_annual' }));
  const h = checkoutHarness({ env: { NODE_ENV: 'production', IAP_ENABLED: 'true' }, storeRows: w.rowsFor(ALICE) });
  const res = await h.checkout('restpilot_monthly');
  assert.match(res.error, /already have RestPilot Premium through the App Store/);
  assert.deepEqual(h.stripeCalls, [], 'no Stripe request is made');
});

test('(c) duplicates: guard lets checkout proceed unchanged once the Apple subscription has expired', async () => {
  const h = checkoutHarness({ env: { NODE_ENV: 'production', IAP_ENABLED: 'true' },
    storeRows: [{ environment: 'live', plan: 'monthly', period_type: 'normal', expires_at: iso(Date.now() - DAY), grace_expires_at: null, will_renew: false }] });
  assert.equal((await h.checkout('restpilot_monthly')).clientSecret, 'cs_secret_test');
  assert.deepEqual(h.stripeCalls, ['prices.list', 'customers.search', 'customers.create', 'checkout.sessions.create']);
});

test('(c) duplicates: guard fails closed when the App Store status cannot be read', async () => {
  const h = checkoutHarness({ env: { NODE_ENV: 'production', IAP_ENABLED: 'true' }, storeError: { message: 'db down' } });
  assert.match((await h.checkout('restpilot_annual')).error, /couldn't check your existing subscriptions/);
  assert.deepEqual(h.stripeCalls, []);
});

test('(c) duplicates: with IAP off the guard is never reached and checkout is byte-for-byte unchanged', async () => {
  const h = checkoutHarness({ env: { NODE_ENV: 'production' }, storeRows: [{ environment: 'live', plan: 'monthly', period_type: 'normal', expires_at: iso(Date.now() + DAY), grace_expires_at: null, will_renew: true }] });
  assert.equal((await h.checkout('restpilot_monthly')).clientSecret, 'cs_secret_test');
  assert.equal(h.storeReads, 0, 'store_entitlements not read');
});

test('(c) duplicates: both channels renewing is flagged for support with both manage paths', async () => {
  const w = world();
  w.stripeRows.set(ALICE, [{ status: 'active', price_id: 'restpilot_monthly', current_period_end: iso(w.now + 9 * DAY), cancel_at_period_end: false, environment: 'live' }]);
  w.rcState.set(ALICE, { restpilot_annual: appStoreSub(w.now) });
  await w.webhook(rcEvent('INITIAL_PURCHASE', ALICE, w.now, { product_id: 'restpilot_annual' }));
  const e = w.entitlement(ALICE);
  assert.equal(e.duplicateBilling, true);
  for (const surface of ['ios', 'web']) {
    const d = decide(surface, e);
    assert.equal(d.duplicateBillingWarning, true); assert.equal(d.purchase, null);
    assert.deepEqual(d.manage.map((m) => m.source).sort(), ['apple', 'stripe']);
  }
  // Once one is canceled, the warning clears.
  w.stripeRows.set(ALICE, [{ status: 'active', price_id: 'restpilot_monthly', current_period_end: iso(w.now + 9 * DAY), cancel_at_period_end: true, environment: 'live' }]);
  assert.equal(w.entitlement(ALICE).duplicateBilling, false);
});

test('(c) duplicates: the app re-checks status on the server right before the App Store sheet', () => {
  const screen = readFileSync(new URL('../src/components/subscription/NativeSubscription.tsx', import.meta.url), 'utf8');
  const buy = screen.indexOf('async function onBuy');
  assert.ok(buy > 0);
  assert.ok(screen.indexOf('await getEntitlementStatus()', buy) < screen.indexOf('await purchase(pkg)', buy));
});

// ---- website checkout harness (real handler, Stripe/Supabase replaced) -------
function checkoutHarness({ env, storeRows = [], storeError = null }) {
  const source = stripTypeScriptTypes(readFileSync(new URL('../src/lib/billing.functions.ts', import.meta.url), 'utf8'))
    .replace(/^import[\s\S]*?;\n/gm, '').replaceAll('export const ', 'const ');
  const stripeCalls = [];
  let storeReads = 0;
  const stripe = {
    customers: { async search() { stripeCalls.push('customers.search'); return { data: [] }; }, async create() { stripeCalls.push('customers.create'); return { id: 'cus_new' }; } },
    prices: { async list({ lookup_keys }) { stripeCalls.push('prices.list'); const k = lookup_keys[0];
      return { data: [{ id: `price_${k}`, lookup_key: k, active: true, type: 'recurring', product: 'prod', recurring: { interval: k === 'restpilot_monthly' ? 'month' : 'year', interval_count: 1 } }] }; } },
    checkout: { sessions: { async create() { stripeCalls.push('checkout.sessions.create'); return { client_secret: 'cs_secret_test' }; } } },
  };
  const supabase = {
    auth: { async getUser() { return { data: { user: { email: 'member@example.test' } } }; } },
    from(t) {
      assert.equal(t, 'store_entitlements'); storeReads++;
      const q = { select() { return q; }, eq() { return q; }, then(res, rej) { return Promise.resolve({ data: storeError ? null : storeRows, error: storeError }).then(res, rej); } };
      return q;
    },
  };
  function createServerFn() { let v; const b = { middleware() { return b; }, inputValidator(fn) { v = fn; return b; }, handler(fn) { return (a) => fn({ ...a, data: v(a.data) }); } }; return b; }
  const ctx = vm.createContext({ URL, process: { env }, createServerFn, requireSupabaseAuth: {}, createStripeClient: () => stripe,
    getStripeErrorMessage: (e) => e.message, appleSubscriptionBlocksCheckout: guard.appleSubscriptionBlocksCheckout });
  const { createCheckoutSession } = vm.runInContext(`${source}\n({createCheckoutSession})`, ctx);
  return {
    stripeCalls, get storeReads() { return storeReads; },
    checkout: (priceId) => createCheckoutSession({ context: { supabase, userId: ALICE },
      data: { priceId, environment: 'live', returnUrl: 'https://restpilotai.com/profile?session_id={CHECKOUT_SESSION_ID}' } }),
  };
}

// ============================ existing lifetime purchasers ===================
test('lifetime: an existing lifetime purchaser is active premium everywhere, with no buy button and nothing to cancel', async () => {
  const w = world();
  const life = { status: 'lifetime', price_id: 'restpilot_lifetime', current_period_end: null, cancel_at_period_end: false, environment: 'live' };
  w.stripeRows.set(ALICE, [life]);
  const e = w.entitlement(ALICE);
  assert.equal(e.active, true); assert.equal(e.state, 'lifetime'); assert.equal(e.plan, 'lifetime'); assert.equal(e.expiresAt, null);
  assert.equal(e.willRenew, false); assert.equal(e.duplicateBilling, false);
  assert.equal(w.entitlement(ALICE, Date.now() + 50 * 365 * DAY).active, true, 'never expires');
  for (const surface of ['ios', 'web', 'other_native']) {
    const d = decide(surface, e);
    assert.equal(d.view, 'status', surface); assert.equal(d.purchase, null, surface); assert.equal(d.externalPurchaseLink, false, surface);
  }
  // The real server status function reports it as premium.
  const res = await serverFns(w).getEntitlementStatus({ context: { userId: ALICE, supabase: w.supabaseFor(ALICE) } });
  assert.equal(res.entitlement.active, true); assert.equal(res.entitlement.state, 'lifetime');
});

test('lifetime: lifetime alongside a renewing App Store subscription keeps lifetime and does not count as double billing', async () => {
  const w = world();
  w.stripeRows.set(ALICE, [{ status: 'lifetime', price_id: 'restpilot_lifetime', current_period_end: null, cancel_at_period_end: false, environment: 'live' }]);
  w.rcState.set(ALICE, { restpilot_monthly: appStoreSub(w.now) });
  await w.webhook(rcEvent('INITIAL_PURCHASE', ALICE, w.now));
  const e = w.entitlement(ALICE);
  assert.equal(e.state, 'lifetime');
  assert.equal(e.duplicateBilling, false, 'only one channel renews');
  assert.deepEqual(decide('ios', e).manage.map((m) => m.source).sort(), ['apple', 'stripe'], 'the Apple subscription can still be cancelled');
});

test('lifetime: the voice gate treats lifetime as paid premium', async () => {
  const access = loadTs('src/lib/realtime/access.server.ts', { globals: { process: { env: { PAYMENTS_ENVIRONMENT: 'live' } } } });
  assert.equal(access.voiceEntitlement([{ status: 'lifetime', current_period_end: null }]), 'paid');
});
// ============================ past_due / unpaid Stripe =======================
test("(c) duplicates: a past_due / unpaid Stripe subscriber is never offered an App Store purchase", () => {
  for (const status of ["past_due", "unpaid"]) {
    const e = merge.mergeEntitlements(
      [
        {
          status,
          price_id: "restpilot_monthly",
          current_period_end: iso(Date.now() - DAY),
          cancel_at_period_end: false,
          environment: "live",
        },
      ],
      [],
      { stripeEnvironment: "live", appleEnvironments: ["live"] },
    );
    assert.equal(e.active, false);
    assert.equal(e.stripeBillingIssue, true);
    const d = decide("ios", e);
    assert.equal(d.view, "billing_issue");
    assert.equal(d.purchase, null);
    assert.deepEqual(d.manage, [{ source: "stripe", path: "stripe_text_only" }]);
  }
  assert.equal(
    merge.mergeEntitlements(
      [
        {
          status: "past_due",
          price_id: "restpilot_monthly",
          current_period_end: null,
          cancel_at_period_end: false,
          environment: "sandbox",
        },
      ],
      [],
      { stripeEnvironment: "live", appleEnvironments: [] },
    ).stripeBillingIssue,
    false,
    "other environment ignored",
  );
  const screen = readFileSync(
    new URL("../src/components/subscription/NativeSubscription.tsx", import.meta.url),
    "utf8",
  );
  const buy = screen.indexOf("async function onBuy");
  assert.ok(
    screen.indexOf("latest.entitlement.stripeBillingIssue", buy) <
      screen.indexOf("await purchase(pkg)", buy),
  );
});
