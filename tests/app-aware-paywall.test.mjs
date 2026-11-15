// Source-level guarantees for the app-aware paywall (UI is not rendered in
// these node tests): the website keeps the existing screen, nothing activates
// by default, and the in-app screen cannot reach Stripe checkout.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = (p) => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8');

test('/paywall renders the existing preview screen unless the IAP flag is on inside the app', () => {
  assert.match(read('src/routes/paywall.tsx'), /component: AppAwarePaywall/);
  const chooser = read('src/components/subscription/AppAwarePaywall.tsx');
  assert.match(chooser, /useState\(false\)/, 'server render and first client render are the existing screen');
  assert.match(chooser, /setInApp\(iapFlagEnabled\(\) && currentSurface\(\) !== "web"\)/);
  assert.match(chooser, /if \(!inApp\) return <AppPreviewAccess \/>;/);
});

test('website pricing route is untouched by the subscription work', () => {
  assert.match(read('src/routes/pricing.tsx'), /component: AppPreviewAccess/);
});

test('flags are strict opt-in strings, defaulting off', () => {
  const bridge = read('src/lib/entitlements/iap-bridge.ts');
  assert.match(bridge, /import\.meta\.env\.VITE_IAP_ENABLED === "true"/);
  assert.match(bridge, /import\.meta\.env\.VITE_IAP_US_EXTERNAL_LINK === "true"/);
  assert.match(read('src/lib/entitlements/store-sync.server.ts'), /env\.IAP_ENABLED === "true"/);
  const example = read('.env.example');
  for (const name of ['VITE_IAP_ENABLED=false', 'VITE_IAP_US_EXTERNAL_LINK=false', 'IAP_ENABLED=false', 'IAP_HONOR_SANDBOX=false']) assert.ok(example.includes(name), name);
  for (const secret of ['REVENUECAT_SECRET_API_KEY=', 'REVENUECAT_WEBHOOK_SECRET=']) assert.match(example, new RegExp(`^${secret}$`, 'm'), 'secret placeholder is empty');
});

test('the in-app subscription screen cannot open Stripe checkout', () => {
  for (const file of ['src/components/subscription/NativeSubscription.tsx', 'src/components/subscription/AppAwarePaywall.tsx', 'src/lib/entitlements/iap-bridge.ts']) {
    const src = read(file);
    assert.doesNotMatch(src, /billing\.functions|createCheckoutSession|createPortalSession|@stripe|stripe\.ts|loadStripe/, file);
  }
  const screen = read('src/components/subscription/NativeSubscription.tsx');
  assert.match(screen, /webCheckoutEnabled: false/);
  // Website links render only behind the policy's decisions.
  assert.match(screen, /decision\.externalPurchaseLink && \(/);
  assert.match(screen, /path === "stripe_portal" \?/);
  // Re-check status immediately before the App Store sheet (double-billing guard).
  assert.ok(screen.indexOf('await getEntitlementStatus()', screen.indexOf('async function onBuy')) < screen.indexOf('await purchase(pkg)'));
});

test('the entitlement sync user comes from the verified session, never from client input', () => {
  const fns = read('src/lib/entitlements/entitlement.functions.ts');
  assert.match(fns, /syncStoreEntitlement\(context\.userId,/);
  assert.doesNotMatch(fns, /inputValidator/);
});

test('migration keeps store tables service-written and user-readable only', () => {
  const sql = read('supabase/migrations/20261114120000_store_entitlements.sql');
  assert.match(sql, /revoke all on public\.store_entitlements from public, anon, authenticated;/);
  assert.match(sql, /grant select on public\.store_entitlements to authenticated;/);
  assert.match(sql, /using \(auth\.uid\(\) = user_id\)/);
  assert.match(sql, /revoke all on function public\.apply_store_entitlement\(jsonb\) from public, anon, authenticated;/);
  assert.match(sql, /where cur\.snapshot_at <= excluded\.snapshot_at;/);
});

test('Buy and Restore wait until the App Store SDK is identified as the signed-in user', () => {
  const screen = read('src/components/subscription/NativeSubscription.tsx');
  assert.match(screen, /if \(!pkg \|\| busy \|\| !userId \|\| storeUser !== userId\) return;/);
  assert.match(screen, /if \(busy \|\| !userId \|\| storeUser !== userId\) return;/);
  assert.match(screen, /disabled=\{busy !== null \|\| storeUser !== userId\}/);
  assert.match(screen, /decision\.restore && decision\.view !== "loading" && storeUser === userId &&/);
  const buy = screen.indexOf('async function onBuy');
  assert.ok(screen.indexOf('await identify(userId)', buy) < screen.indexOf('await purchase(pkg)', buy));
  const restore = screen.indexOf('async function onRestore');
  assert.ok(screen.indexOf('await identify(userId)', restore) < screen.indexOf('await restore()', restore));
  // A user switch resets identity and plans before anything can be bought.
  assert.match(screen, /setStoreUser\(null\);\s*setPackages\(\{\}\);\s*setPlansState\("loading"\);/);
  // identify() is serialized in the bridge.
  assert.match(read('src/lib/entitlements/iap-bridge.ts'), /identifyQueue = run\.catch/);
});

test('plans show a loading state and a retry, not "unavailable", while StoreKit loads', () => {
  const screen = read('src/components/subscription/NativeSubscription.tsx');
  assert.match(screen, /plansState === "loading" \?/);
  assert.match(screen, /Loading plans…/);
  assert.match(screen, /setPlansAttempt\(\(n\) => n \+ 1\)/);
});
