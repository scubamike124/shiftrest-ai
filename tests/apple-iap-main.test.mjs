// Apple In-App Purchase on main (owner decision, Nov 15 2026): new purchases go
// through the App Store via RevenueCat. These tests cover what is specific to
// main: the store_entitlements migration is NOT applied yet (it lives in
// supabase/pending-migrations/), so every Apple path must stay inert, logged
// and harmless without it; the app's paywall stays the neutral notice until
// the RevenueCat key, the native plugin and the server pipeline are all ready;
// purchase / restore / cancel through the native bridge; Apple status shown on
// Profile; App Store trial users metered like Stripe trial users.
// Ported RevenueCat logic is covered by entitlement-merge, paywall-policy,
// revenuecat-sync and subscription-lifecycle tests. No network.
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import test from 'node:test';
import { loadTs } from './_load-ts.mjs';
import { loadNativeApp, APP_UA, SAFARI_UA } from './_native-harness.mjs';

const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const merge = loadTs('src/lib/entitlements/merge.ts');
const rc = loadTs('src/lib/entitlements/revenuecat.ts');
const sync = loadTs('src/lib/entitlements/store-sync.server.ts', { modules: { './revenuecat': rc } });
const quiet = { warn() {}, error() {}, log() {} };

const USER = '11111111-1111-4111-8111-111111111111';
const DAY = 86_400_000;
const iso = (ms) => new Date(ms).toISOString();
const MISSING = { code: 'PGRST205', message: "Could not find the table 'public.store_entitlements' in the schema cache" };
const ENV_ON = { IAP_ENABLED: 'true', REVENUECAT_WEBHOOK_SECRET: 'whsec_rc_test', REVENUECAT_SECRET_API_KEY: 'sk_rc_test' };

// ---- the migration is pending, not applied ---------------------------------
test('migration: store_entitlements is shipped as a PENDING file, never in supabase/migrations', () => {
  const applied = readdirSync(new URL('../supabase/migrations/', import.meta.url));
  for (const f of applied) assert.doesNotMatch(read(`supabase/migrations/${f}`), /store_entitlements|apply_store_entitlement/, f);
  const pending = read('supabase/pending-migrations/20261115120000_store_entitlements.sql');
  assert.match(pending, /PENDING: NOT APPLIED/);
  // has_active_subscription keeps the Stripe conditions verbatim (only adds an OR).
  const stripeBody = `(status IN ('active', 'trialing') AND (current_period_end IS NULL OR current_period_end > now()))
      OR (status = 'canceled' AND current_period_end IS NOT NULL AND current_period_end > now())
      OR (status = 'lifetime')`;
  assert.ok(pending.includes(stripeBody));
  assert.ok(read('supabase/migrations/20260626222351_6ee9b465-a4e1-4d6d-8755-4fb200212e6c.sql').includes(stripeBody));
});

test('missing-table detection: PostgREST and Postgres codes and messages', () => {
  for (const e of [MISSING, { code: '42P01' }, { code: '42883' }, { code: 'PGRST202' }, { message: 'relation "public.store_entitlements" does not exist' }, { message: 'Could not find the function public.apply_store_entitlement(_snapshot) in the schema cache' }]) {
    assert.equal(sync.isMissingRelationError(e), true, JSON.stringify(e));
  }
  for (const e of [null, undefined, 'x', { code: '57014' }, { message: 'connection reset' }, { code: '23505', message: 'duplicate key' }]) {
    assert.equal(sync.isMissingRelationError(e), false, JSON.stringify(e));
  }
});

// ---- table absent: database layer ------------------------------------------
function storeDb(error) {
  const db = {
    rpc: async () => ({ data: null, error }),
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error }) }) }), upsert: async () => ({ error }) }),
  };
  return loadTs('src/lib/entitlements/store-db.server.ts', { modules: { 'node:process': { env: {} }, './store-sync.server': sync } }).storeDbDeps(db, ENV_ON);
}

test('table absent: every database call throws StoreNotReadyError; other errors stay generic', async () => {
  const deps = storeDb(MISSING);
  for (const call of [() => deps.applySnapshot({}), () => deps.isProcessed('evt'), () => deps.markProcessed('evt', 'X')]) {
    await assert.rejects(call(), (e) => sync.isStoreNotReady(e));
  }
  const other = storeDb({ code: '57014', message: 'timeout' });
  await assert.rejects(other.isProcessed('evt'), (e) => !sync.isStoreNotReady(e) && /lookup failed/.test(e.message));
});

test('table absent: the signed RevenueCat webhook answers 503 (retry later), logs it, and records nothing', async () => {
  const logs = []; let marked = 0; let fetched = 0;
  const deps = {
    env: ENV_ON, nowSeconds: () => 1_794_657_600, log: (m) => logs.push(m),
    fetch: async () => { fetched++; return Response.json({}); },
    applySnapshot: async () => { throw new sync.StoreNotReadyError(); },
    isProcessed: async () => { throw new sync.StoreNotReadyError(); },
    markProcessed: async () => { marked++; },
  };
  const body = JSON.stringify({ api_version: '1.0', event: { id: 'evt_1', type: 'INITIAL_PURCHASE', app_user_id: USER } });
  const t = 1_794_657_600;
  const sig = `t=${t},v1=${createHmac('sha256', ENV_ON.REVENUECAT_WEBHOOK_SECRET).update(`${t}.${body}`).digest('hex')}`;
  const res = await sync.handleRevenueCatWebhook(new Request('https://restpilotai.com/api/public/iap/revenuecat', { method: 'POST', body, headers: { 'x-revenuecat-webhook-signature': sig } }), deps);
  assert.equal(res.status, 503);
  assert.equal(await res.text(), 'Not configured');
  assert.equal(marked, 0); assert.equal(fetched, 0);
  assert.match(logs.join('\n'), /migration is not applied/);
});

// ---- table absent: status, restore, checkout guard --------------------------
function serverFns({ env = ENV_ON, stripeRows = [], storeError = null, storeRows = [], syncDeps } = {}) {
  const warnings = [];
  const fns = loadTs('src/lib/entitlements/entitlement.functions.ts', {
    modules: {
      '@tanstack/react-start': { createServerFn() { const b = { middleware: () => b, inputValidator: () => b, handler: (fn) => fn }; return b; } },
      '@/integrations/supabase/auth-middleware': { requireSupabaseAuth: {} },
      '@/lib/billing-flags': { paymentsClientToken: () => 'pk_live_x' },
      './merge': merge,
      './store-sync.server': sync,
      './store-db.server': { storeSyncDeps: async () => syncDeps ?? { env, fetch: async () => Response.json({}), applySnapshot: async () => { throw new sync.StoreNotReadyError(); } } },
    },
    globals: { process: { env }, console: { warn: (m) => warnings.push(m), error() {} } },
  });
  const supabase = {
    from(t) {
      const q = { select() { return q; }, eq() { return q; }, then(res, rej) {
        const r = t === 'subscriptions' ? { data: stripeRows, error: null } : storeError ? { data: null, error: storeError } : { data: storeRows, error: null };
        return Promise.resolve(r).then(res, rej);
      } };
      return q;
    },
  };
  return { fns, warnings, ctx: { context: { userId: USER, supabase } } };
}
const stripeActive = { status: 'active', price_id: 'restpilot_monthly', current_period_end: iso(Date.now() + 9 * DAY), cancel_at_period_end: false, environment: 'live' };

test('table absent: status still reports Stripe (and lifetime) access; Apple inert; iapReady false; logged once', async () => {
  for (const [rows, active] of [[[stripeActive], true], [[{ status: 'lifetime', price_id: 'restpilot_lifetime', current_period_end: null, cancel_at_period_end: false, environment: 'live' }], true], [[], false]]) {
    const { fns, warnings, ctx } = serverFns({ stripeRows: rows, storeError: MISSING });
    const res = await fns.getEntitlementStatus(ctx);
    assert.equal(res.entitlement.active, active);
    assert.equal(res.entitlement.hasApple, false);
    assert.equal(res.iapReady, false);
    await fns.getEntitlementStatus(ctx);
    assert.equal(warnings.length, 1, 'warned once per instance');
    assert.match(warnings[0], /migration not applied/);
  }
});

test('status fails closed (no buy button) on any other store read error', async () => {
  const { fns, ctx } = serverFns({ storeError: { code: '57014', message: 'timeout' } });
  assert.match((await fns.getEntitlementStatus(ctx)).error, /unavailable/);
});

test('iapReady needs IAP_ENABLED, both RevenueCat secrets and the table', async () => {
  const cases = [[ENV_ON, null, true], [{ ...ENV_ON, IAP_ENABLED: 'false' }, null, false], [{ ...ENV_ON, REVENUECAT_WEBHOOK_SECRET: '' }, null, false], [{ ...ENV_ON, REVENUECAT_SECRET_API_KEY: undefined }, null, false], [ENV_ON, MISSING, false]];
  for (const [env, storeError, ready] of cases) {
    const { fns, ctx } = serverFns({ env, storeError });
    assert.equal((await fns.getEntitlementStatus(ctx)).iapReady, ready, JSON.stringify({ env, storeError }));
  }
});

test('table absent: restore answers "not available yet" without calling RevenueCat', async () => {
  let fetched = 0;
  const syncDeps = { env: ENV_ON, fetch: async () => { fetched++; return Response.json({}); }, applySnapshot: async () => true };
  const { fns, ctx } = serverFns({ storeError: MISSING, syncDeps });
  assert.equal((await fns.syncMyStoreEntitlement(ctx)).error, 'In-app purchases are not available yet.');
  assert.equal(fetched, 0);
  // Tables present but RevenueCat secrets missing: same, no call.
  const noKey = serverFns({ env: { IAP_ENABLED: 'true' }, syncDeps });
  assert.equal((await noKey.fns.syncMyStoreEntitlement(noKey.ctx)).error, 'In-app purchases are not available yet.');
  assert.equal(fetched, 0);
  // Tables vanish between the check and the write (race): still "not available".
  const race = serverFns({ syncDeps: { env: ENV_ON, fetch: async () => Response.json({ request_date_ms: Date.now(), subscriber: { subscriptions: {} } }), applySnapshot: async () => { throw new sync.StoreNotReadyError(); } } });
  assert.equal((await race.fns.syncMyStoreEntitlement(race.ctx)).error, 'In-app purchases are not available yet.');
});

test('table absent: website checkout guard is inert (nothing to collide with); other errors still refuse', async () => {
  const guard = loadTs('src/lib/entitlements/checkout-guard.ts', { modules: { './merge': merge, './store-sync.server': sync }, globals: { console: quiet } });
  const sb = (error) => ({ from: () => ({ select: () => ({ eq: async () => ({ data: null, error }) }) }) });
  assert.equal(await guard.appleSubscriptionBlocksCheckout(sb(MISSING), USER, ENV_ON), null);
  assert.equal(await guard.appleSubscriptionBlocksCheckout(sb({ code: '57014' }), USER, ENV_ON), guard.APPLE_STATUS_UNAVAILABLE_MESSAGE);
  assert.equal(await guard.appleSubscriptionBlocksCheckout(sb({ code: '57014' }), USER, {}), null, 'IAP off: never reads');
});

// ---- duplicate prevention: past_due Stripe blocks an App Store purchase ------
test('duplicates: a past_due / unpaid Stripe subscriber is never offered an App Store purchase', () => {
  const policy = loadTs('src/lib/entitlements/paywall-policy.ts');
  for (const status of ['past_due', 'unpaid']) {
    const e = merge.mergeEntitlements([{ ...stripeActive, status }], [], { stripeEnvironment: 'live', appleEnvironments: ['live'] });
    assert.equal(e.active, false); assert.equal(e.stripeBillingIssue, true);
    const d = policy.decidePaywall({ surface: 'ios', iapAvailable: true, storefront: 'USA', usExternalLinkEnabled: false, webCheckoutEnabled: false, entitlement: e });
    assert.equal(d.view, 'billing_issue'); assert.equal(d.purchase, null);
    assert.deepEqual(d.manage, [{ source: 'stripe', path: 'stripe_text_only' }], 'text only in the app');
  }
  // Sandbox rows do not count against a live deployment.
  assert.equal(merge.mergeEntitlements([{ ...stripeActive, status: 'past_due', environment: 'sandbox' }], [], { stripeEnvironment: 'live', appleEnvironments: [] }).stripeBillingIssue, false);
  const src = read('src/components/subscription/NativeSubscription.tsx');
  const buy = src.indexOf('async function onBuy');
  assert.ok(src.indexOf('latest.entitlement.stripeBillingIssue', buy) < src.indexOf('await purchase(pkg)', buy), 're-checked before the App Store sheet');
  assert.ok(src.indexOf('!latest.iapReady', buy) < src.indexOf('await purchase(pkg)', buy));
});

// ---- native bridge: purchase, restore, cancel --------------------------------
function bridge({ key = 'appl_TestPublicKey123', platform = 'ios', plugin = true, ua = APP_UA, fail } = {}) {
  const calls = [];
  const Capacitor = {
    isNativePlatform: () => true, getPlatform: () => platform,
    PluginHeaders: plugin ? [{ name: 'Purchases' }] : [{ name: 'App' }],
    async nativePromise(p, method, opts) {
      calls.push([p, method, opts]);
      if (fail?.[method]) throw fail[method];
      if (method === 'isConfigured') return { isConfigured: calls.some((c) => c[1] === 'configure') };
      if (method === 'getOfferings') return { current: { availablePackages: [
        { identifier: '$rc_monthly', product: { identifier: 'restpilot_monthly', priceString: '$7.99', introPrice: { price: 0 } } },
        { identifier: '$rc_annual', product: { identifier: 'restpilot_annual', priceString: '$49.99', introPrice: { price: 0 } } },
      ] } };
      return {};
    },
  };
  const window = { Capacitor };
  const nativeApp = loadNativeApp(window, { userAgent: ua });
  const mod = loadTs('src/lib/entitlements/iap-bridge.ts', {
    modules: { '@/lib/native-app': nativeApp, '@/lib/billing-flags': { revenueCatIosKey: () => key }, './revenuecat': rc },
    globals: { window },
  });
  return { mod, calls };
}

test('bridge: inert without the RevenueCat key, outside iOS, without the plugin, or on the website', async () => {
  for (const o of [{ key: null }, { platform: 'android' }, { plugin: false }]) {
    const { mod, calls } = bridge(o);
    assert.equal(mod.iapAvailable(), false, JSON.stringify(o));
    await assert.rejects(mod.loadPackages(), /not available/);
    assert.deepEqual(calls, []);
  }
  const web = loadTs('src/lib/entitlements/iap-bridge.ts', { modules: { '@/lib/native-app': loadNativeApp({}, { userAgent: SAFARI_UA }), '@/lib/billing-flags': { revenueCatIosKey: () => 'appl_x' }, './revenuecat': rc }, globals: { window: {} } });
  assert.equal(web.iapAvailable(), false); assert.equal(web.currentSurface(), 'web');
  assert.equal(bridge().mod.iapAvailable(), true);
});

test('purchase: identify as the signed-in user, load Monthly and Annual, buy; a cancelled sheet is not an error', async () => {
  const { mod, calls } = bridge();
  await mod.identify(USER);
  const pkgs = await mod.loadPackages();
  assert.deepEqual(Object.keys(pkgs).sort(), ['annual', 'monthly']);
  assert.equal(await mod.purchase(pkgs.annual), 'purchased');
  assert.deepEqual(calls.map((c) => c[1]), ['isConfigured', 'configure', 'getOfferings', 'purchasePackage']);
  assert.deepEqual(calls[1][2], { apiKey: 'appl_TestPublicKey123', appUserID: USER });
  const cancelled = bridge({ fail: { purchasePackage: { code: '1', userCancelled: true } } });
  assert.equal(await cancelled.mod.purchase(pkgs.monthly), 'cancelled');
  const failed = bridge({ fail: { purchasePackage: new Error('payment declined') } });
  await assert.rejects(failed.mod.purchase(pkgs.monthly), /declined/);
});

test('purchase: switching RestPilot accounts logs the App Store SDK into the new user before buying', async () => {
  const { mod, calls } = bridge();
  await mod.identify(USER);
  await mod.identify('22222222-2222-4222-8222-222222222222');
  assert.deepEqual(calls.at(-1), ['Purchases', 'logIn', { appUserID: '22222222-2222-4222-8222-222222222222' }]);
});

test('restore: calls restorePurchases; the screen then asks the server to sync (user from the session only)', async () => {
  const { mod, calls } = bridge();
  await mod.identify(USER);
  await mod.restore();
  assert.equal(calls.at(-1)[1], 'restorePurchases');
  const src = read('src/components/subscription/NativeSubscription.tsx');
  const onRestore = src.slice(src.indexOf('async function onRestore'));
  assert.ok(onRestore.indexOf('await restore()') < onRestore.indexOf('afterStoreChange('));
  assert.match(src, /const next = await syncMyStoreEntitlement\(\);/);
});

test('cancellation: the app sends Apple subscribers to Apple\'s own management (no in-app cancel, no website link)', () => {
  const src = read('src/components/subscription/NativeSubscription.tsx');
  assert.match(src, /href=\{appleUrl \?\? APPLE_SUBSCRIPTIONS_URL\}/);
  assert.match(src, /Manage App Store subscriptions/);
  assert.match(src, /Cancel at least 24\s+hours before renewal/);
  assert.equal(loadTs('src/lib/entitlements/iap-bridge.ts', { modules: { '@/lib/native-app': loadNativeApp(), '@/lib/billing-flags': { revenueCatIosKey: () => null }, './revenuecat': rc } }).APPLE_SUBSCRIPTIONS_URL, 'https://apps.apple.com/account/subscriptions');
});

// ---- the app paywall screen --------------------------------------------------
test('app paywall: neutral notice unless key + plugin (client) and iapReady (server); App Store terms and legal links', () => {
  const chooser = read('src/components/subscription/AppSubscriptionScreen.tsx');
  assert.match(chooser, /if \(!iapAvailable\(\)\) return <NativeSubscriptionNotice \/>;/);
  const src = read('src/components/subscription/NativeSubscription.tsx');
  assert.match(src, /if \(status && "entitlement" in status && !status\.iapReady\) return <NativeSubscriptionNotice \/>;/);
  assert.match(src, /const canIap = iapAvailable\(\) && iapReady;/);
  for (const s of ['Restore purchases', 'Payment is charged to your Apple Account', 'renews automatically', '14-day free trial for eligible new subscribers', 'to="/legal/terms"', 'to="/legal/privacy"', 'to="/legal/subscription"']) {
    assert.ok(src.includes(s), s);
  }
  // Never Stripe and never a link to buy on the website.
  assert.doesNotMatch(src, /createCheckoutSession|createPortalSession|@\/lib\/stripe|restpilotai\.com|\/pricing|externalPurchaseLink/);
  assert.match(src, /usExternalLinkEnabled: false/);
});

test('app paywall: committed env files leave the RevenueCat key unset (inert by default)', () => {
  for (const f of ['.env', '.env.production', '.env.development']) {
    let s = ''; try { s = read(f); } catch { continue; }
    assert.doesNotMatch(s, /VITE_REVENUECAT_IOS_API_KEY\s*=\s*["']?appl_/, f);
  }
});

// ---- Profile: Apple subscribers ----------------------------------------------
function subscriptionState({ key, stripeRow = null, status }) {
  let serverCalls = 0;
  const supabase = {
    auth: { async getSession() { return { data: { session: { user: { id: USER } } } }; } },
    from() { const q = { select() { return q; }, eq() { return q; }, order() { return q; }, limit() { return q; }, async maybeSingle() { return { data: stripeRow, error: null }; } }; return q; },
  };
  const mod = loadTs('src/lib/subscription.ts', { modules: {
    '@/integrations/supabase/client': { supabase },
    '@/lib/stripe': { getStripeEnvironment: () => 'live', isPaymentsConfigured: () => true },
    '@/lib/billing-flags': { revenueCatIosKey: () => key },
    '@/lib/entitlements/entitlement.functions': { getEntitlementStatus: async () => { serverCalls++; return status; } },
  } });
  return mod.getSubscriptionState().then((s) => ({ s, serverCalls }));
}
const appleOnly = (o = {}) => ({ iapReady: true, appleManagementUrl: null, entitlement: merge.mergeEntitlements([], [{ environment: 'live', plan: 'annual', period_type: 'normal', expires_at: iso(Date.now() + 300 * DAY), grace_expires_at: null, will_renew: true, ...o }], { stripeEnvironment: 'live', appleEnvironments: ['live'] }) });

test('Profile: an App Store subscriber shows as Premium (source apple); trial and cancel states carried over', async () => {
  const { s } = await subscriptionState({ key: 'appl_x', status: appleOnly() });
  assert.equal(s.isPremium, true); assert.equal(s.source, 'apple'); assert.equal(s.tier, 'annual'); assert.equal(s.cancelAtPeriodEnd, false);
  const trial = await subscriptionState({ key: 'appl_x', status: appleOnly({ period_type: 'trial', will_renew: false }) });
  assert.equal(trial.s.status, 'trialing'); assert.equal(trial.s.cancelAtPeriodEnd, true);
  const expired = await subscriptionState({ key: 'appl_x', status: appleOnly({ expires_at: iso(Date.now() - DAY) }) });
  assert.equal(expired.s.isPremium, false, 'expired App Store subscription: no Premium');
  const errored = await subscriptionState({ key: 'appl_x', status: { error: 'x' } });
  assert.equal(errored.s.isPremium, false);
});

test('Profile: without the RevenueCat key, or for Stripe Premium / past_due, the server is not asked', async () => {
  assert.equal((await subscriptionState({ key: null, status: appleOnly() })).serverCalls, 0);
  const stripe = await subscriptionState({ key: 'appl_x', stripeRow: { price_id: 'restpilot_monthly', status: 'active', current_period_end: iso(Date.now() + DAY), cancel_at_period_end: false, stripe_customer_id: 'cus_1' }, status: appleOnly() });
  assert.equal(stripe.serverCalls, 0); assert.equal(stripe.s.source, 'stripe');
  const pastDue = await subscriptionState({ key: 'appl_x', stripeRow: { price_id: 'restpilot_monthly', status: 'past_due', current_period_end: iso(Date.now() - DAY), cancel_at_period_end: false, stripe_customer_id: 'cus_1' }, status: appleOnly() });
  assert.equal(pastDue.serverCalls, 0); assert.equal(pastDue.s.billingIssue, true);
});

test('Profile: Apple subscribers get Apple\'s manage link, never the Stripe portal; deletion warns them to cancel with Apple', () => {
  const src = read('src/routes/profile.tsx');
  assert.match(src, /\{subState\.source === "apple" && \(\s*\/\/[^\n]*\n\s*<a\s+href=\{APPLE_SUBSCRIPTIONS_URL\}/);
  assert.match(src, /subState\.source !== "apple" && subState\.tier !== "lifetime" && !inNativeApp && \(\s*<button/);
  assert.match(src, /Subscribed through the App Store\? Deleting your account does not cancel it/);
});

// ---- voice trial metering ----------------------------------------------------
function voice({ env = {}, stripeRow = null, store = { data: [], error: null } } = {}) {
  let storeReads = 0;
  const supabaseAdmin = {
    from(t) {
      const q = { select() { return q; }, eq() { return q; }, order() { return q; }, limit() { return q; },
        async maybeSingle() { return { data: t === 'subscriptions' ? stripeRow : null, error: null }; },
        then(res, rej) { storeReads++; assert.equal(t, 'store_entitlements'); return Promise.resolve(store).then(res, rej); } };
      return q;
    },
  };
  const mod = loadTs('src/lib/realtime/trial-usage.functions.ts', {
    modules: {
      '@tanstack/react-start': { createServerFn() { const b = { middleware: () => b, inputValidator: () => b, handler: (fn) => fn }; return b; } },
      '@/integrations/supabase/auth-middleware': { requireSupabaseAuth: {} },
      '@/lib/trial-limits': { TRIAL_VOICE_SECONDS_CAP: 600 },
      '@/integrations/supabase/client.server': { supabaseAdmin },
      '@/lib/entitlements/merge': merge,
    },
    globals: { process: { env } },
  });
  return { state: () => mod.loadTrialUsageState(USER, 'live'), get storeReads() { return storeReads; } };
}
const appleRow = (o = {}) => ({ environment: 'live', plan: 'monthly', period_type: 'trial', expires_at: iso(Date.now() + 10 * DAY), grace_expires_at: null, will_renew: true, ...o });

test('voice: App Store free-trial users are metered like Stripe trial users once IAP is on', async () => {
  assert.equal((await voice({ env: ENV_ON, store: { data: [appleRow()], error: null } }).state()).isTrial, true);
  assert.equal((await voice({ env: ENV_ON, store: { data: [appleRow({ period_type: 'normal' })], error: null } }).state()).isTrial, false, 'paid Apple: passthrough');
});

test('voice: unchanged with IAP off, for lifetime / active Stripe, and when the table is missing', async () => {
  const off = voice({ store: { data: [appleRow()], error: null } });
  assert.equal((await off.state()).isTrial, false); assert.equal(off.storeReads, 0, 'IAP off: store never read');
  assert.equal((await voice({ env: ENV_ON, stripeRow: { status: 'trialing' } }).state()).isTrial, true, 'Stripe trial unchanged');
  for (const status of ['lifetime', 'active']) {
    const v = voice({ env: ENV_ON, stripeRow: { status }, store: { data: [appleRow()], error: null } });
    assert.equal((await v.state()).isTrial, false, status); assert.equal(v.storeReads, 0);
  }
  assert.equal((await voice({ env: ENV_ON, store: { data: null, error: MISSING } }).state()).isTrial, false, 'missing table: no Apple trial, no error');
});
