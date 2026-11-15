// RestPilot Apple IAP follow-ups on #63: (1) /legal/subscription covers both
// billing paths and shows no website purchase link in the app; (2) the app
// re-syncs the App Store entitlement on open/foreground; (3) rollback docs.
// Real code is run with mocked fetch/server fns. No network.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
import { loadTs } from './_load-ts.mjs';

const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const require = createRequire(import.meta.url);
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

// ---- (1) legal pages, rendered for real --------------------------------------
// mode 'mounted-web' / 'mounted-app': the hook's value after mount.
// mode 'first-app' / 'first-web': the REAL hook, first render only (what the
// server HTML and hydration produce; effects do not run), in the app or not.
function loadRealNativeApp(inApp) {
  const js = ts.transpileModule(read('src/lib/native-app.ts'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const module = { exports: {} };
  const win = inApp ? { Capacitor: { isNativePlatform: () => true } } : {};
  vm.compileFunction(js, ['module', 'exports', 'require', 'window', 'navigator'])(
    module, module.exports, (n) => { if (n === 'react') return React; throw new Error('unexpected ' + n); }, win, { userAgent: inApp ? 'RestPilotApp/1.0' : 'Safari' });
  return module.exports;
}
function renderPage(file, mode) {
  const js = ts.transpileModule(read(file), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const module = { exports: {} };
  let captured;
  const nativeApp = mode.startsWith('first')
    ? loadRealNativeApp(mode === 'first-app')
    : { useWebOnlyAfterMount: () => mode === 'mounted-web' };
  const mods = {
    'react/jsx-runtime': require('react/jsx-runtime'),
    '@tanstack/react-router': {
      createFileRoute: () => (opts) => { captured = opts; return opts; },
      Link: ({ to, children }) => React.createElement('a', { href: to }, children),
    },
    '@/components/legal/LegalLayout': { LegalLayout: ({ children }) => React.createElement('div', null, children) },
    '@/lib/legal/meta': { findLegalDoc: () => ({ title: 'Legal', summary: 's', path: '/legal/x' }) },
    '@/lib/native-app': nativeApp,
  };
  vm.compileFunction(js, ['module', 'exports', 'require'])(module, module.exports, (n) => { if (n in mods) return mods[n]; throw new Error('unexpected ' + n); });
  return renderToStaticMarkup(React.createElement(captured.component));
}
const renderLegal = (mode) => renderPage('src/routes/legal.subscription.tsx', mode);
const renderTerms = (mode) => renderPage('src/routes/legal.terms.tsx', mode);
const text = (html) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

for (const mode of ['mounted-web', 'mounted-app', 'first-app', 'first-web']) {
  test(`/legal/subscription (${mode}) covers App Store and website billing`, () => {
    const t = text(renderLegal(mode));
    assert.match(t, /billed by Apple through the App Store/);
    assert.match(t, /Settings → your name → Subscriptions/);
    assert.match(t, /reportaproblem\.apple\.com/);
    assert.match(t, /cancelled at least 24 hours before the end of the current period/);
    assert.match(t, /Payment is charged to your Apple Account at confirmation of purchase/);
    assert.match(t, /Stripe/); // existing website subscribers
    assert.match(t, /USD 7\.99\/month/);
    assert.match(t, /USD 49\.99\/year/);
    assert.match(t, /Lifetime plan has been permanently discontinued/);
  });
}

test('/legal/subscription: after mount the website shows the pricing link and account-settings wording', () => {
  const web = renderLegal('mounted-web');
  assert.match(web, /href="\/pricing"/);
  assert.match(web, /cancel any time from your account settings/);
});

// Includes the first render: that is what the server HTML and hydration show,
// and an app user must never see website purchase wording, even briefly.
for (const mode of ['mounted-app', 'first-app', 'first-web']) {
  test(`/legal/subscription (${mode}): no website pricing/purchase link or website-only cancel wording`, () => {
    const app = renderLegal(mode);
    assert.doesNotMatch(app, /href="\/(pricing|paywall|checkout)/);
    assert.doesNotMatch(app, /href="https?:\/\/(?!reportaproblem\.apple\.com)/);
    assert.doesNotMatch(text(app), /pricing page|buy on our website|subscribe on our website|account settings/i);
    assert.match(text(app), /The price is shown before you subscribe/);
  });
}

for (const mode of ['mounted-app', 'first-app', 'first-web']) {
  test(`/legal/terms (${mode}): no link to /pricing`, () => {
    const t = renderTerms(mode);
    assert.doesNotMatch(t, /href="\/(pricing|paywall)"/);
    assert.doesNotMatch(text(t), /pricing page/);
    assert.match(text(t), /as described in our Subscription Terms/);
  });
}
test('/legal/terms: after mount the website keeps its pricing page link', () => {
  const t = renderTerms('mounted-web');
  assert.match(t, /href="\/pricing"/);
  assert.match(text(t), /as described on our pricing page and in our Subscription Terms/);
});

test('/legal pages source: use the first-render-safe hook, not useIsNativeApp', () => {
  for (const f of ['src/routes/legal.subscription.tsx', 'src/routes/legal.terms.tsx']) {
    assert.match(read(f), /useWebOnlyAfterMount\(\)/);
    assert.doesNotMatch(read(f), /useIsNativeApp/);
  }
  assert.doesNotMatch(read('src/routes/legal.subscription.tsx'), /Subscriptions are processed by our payment provider \(currently\s+Stripe\)\. By subscribing/);
});

// ---- (2) foreground re-sync -------------------------------------------------
const resync = loadTs('src/lib/entitlements/store-resync.ts');
const NOW = Date.UTC(2026, 10, 15);
const DAY = 86_400_000;
const ent = (channels = [], active = channels.length > 0) => ({ active, channels });
const ok = (entitlement, iapReady = true) => ({ entitlement, appleManagementUrl: null, iapReady });
const apple = (expiresAt) => ({ source: 'apple', plan: 'monthly', state: 'active', expiresAt, willRenew: true, environment: 'live' });
const stripe = { source: 'stripe', plan: 'annual', state: 'active', expiresAt: NOW + 200 * DAY, willRenew: true, environment: 'live' };

function harness(over = {}) {
  const calls = { status: 0, sync: 0 };
  const deps = {
    isNativeApp: () => true,
    iapAvailable: () => true,
    userId: 'u1',
    getStatus: async () => { calls.status++; return ok(ent()); },
    sync: async () => { calls.sync++; return ok(ent([apple(NOW + 30 * DAY)])); },
    now: () => NOW,
    lastAttempt: new Map(),
    ...over,
  };
  return { deps, calls };
}

test('resync: no-op on the web, without IAP, when signed out, when the server is not ready or errors', async () => {
  for (const [name, over, outcome] of [
    ['web', { isNativeApp: () => false }, 'skipped-web'],
    ['iap not available', { iapAvailable: () => false }, 'skipped-not-ready'],
    ['signed out', { userId: null }, 'skipped-signed-out'],
    ['server iapReady false', { getStatus: async () => ok(ent(), false) }, 'skipped-not-ready'],
    ['status error', { getStatus: async () => ({ error: 'x' }) }, 'skipped-not-ready'],
  ]) {
    const h = harness(over);
    assert.equal(await resync.resyncStoreEntitlement(h.deps), outcome, name);
    assert.equal(h.calls.sync, 0, name + ': no sync');
  }
  const web = harness({ isNativeApp: () => false });
  await resync.resyncStoreEntitlement(web.deps);
  assert.equal(web.calls.status, 0, 'web: not even a status read');
});

test('resync: syncs when the Apple row is missing/expired or near expiry; not otherwise', async () => {
  let h = harness();
  assert.equal(await resync.resyncStoreEntitlement(h.deps), 'synced', 'no Apple access');
  assert.equal(h.calls.sync, 1);
  h = harness({ getStatus: async () => ok(ent([apple(NOW + 1 * DAY)])) });
  assert.equal(await resync.resyncStoreEntitlement(h.deps), 'synced', 'near expiry');
  h = harness({ getStatus: async () => ok(ent([apple(NOW + 20 * DAY)])) });
  assert.equal(await resync.resyncStoreEntitlement(h.deps), 'skipped-not-needed', 'healthy Apple');
  assert.equal(h.calls.sync, 0);
  h = harness({ getStatus: async () => ok(ent([stripe])) });
  assert.equal(await resync.resyncStoreEntitlement(h.deps), 'skipped-not-needed', 'website subscriber');
  assert.equal(h.calls.sync, 0);
});

test('resync: client throttle, failures swallowed, never throws', async () => {
  const h = harness();
  assert.equal(await resync.resyncStoreEntitlement(h.deps), 'synced');
  assert.equal(await resync.resyncStoreEntitlement(h.deps), 'skipped-recent', 'foreground again straight away');
  assert.equal(h.calls.sync, 1);
  // no-Apple users wait longer than near-expiry users
  h.deps.now = () => NOW + 60 * 60 * 1000;
  assert.equal(await resync.resyncStoreEntitlement(h.deps), 'skipped-recent', 'still within 6h for a user with no Apple access');
  h.deps.now = () => NOW + 7 * 60 * 60 * 1000;
  assert.equal(await resync.resyncStoreEntitlement(h.deps), 'synced');
  const bad = harness({ sync: async () => { throw new Error('boom'); } });
  assert.equal(await resync.resyncStoreEntitlement(bad.deps), 'failed');
  const err = harness({ sync: async () => ({ error: 'Still checking' }) });
  assert.equal(await resync.resyncStoreEntitlement(err.deps), 'failed');
  const statusThrows = harness({ getStatus: async () => { throw new Error('net'); } });
  assert.equal(await resync.resyncStoreEntitlement(statusThrows.deps), 'failed');
});

test('resync: Apple access ending within 3 days is NOT re-asked within the 30 minute minimum gap', async () => {
  const h = harness({ getStatus: async () => ok(ent([apple(NOW + 1 * DAY)])) });
  assert.equal(await resync.resyncStoreEntitlement(h.deps), 'synced');
  h.deps.now = () => NOW + 29 * 60 * 1000;
  assert.equal(await resync.resyncStoreEntitlement(h.deps), 'skipped-recent');
  assert.equal(h.calls.sync, 1);
  h.deps.now = () => NOW + 31 * 60 * 1000;
  assert.equal(await resync.resyncStoreEntitlement(h.deps), 'synced');
  assert.equal(h.calls.sync, 2);
});

test('resync is wired: root mounts it for signed-in users; it renders nothing and has no purchase UI', () => {
  const root = read('src/routes/__root.tsx');
  assert.match(root, /\{signedIn && <StoreEntitlementResync \/>\}/);
  const c = read('src/components/subscription/StoreEntitlementResync.tsx');
  assert.match(c, /return null;/);
  assert.match(c, /syncMyStoreEntitlement\(\)/);
  assert.match(c, /visibilitychange/);
  assert.doesNotMatch(c, /purchase\(|restore\(|checkout|createCheckout|\/paywall|\/pricing/);
});

// ---- (3) rollback docs ------------------------------------------------------
test('APPLE-IAP-SETUP rollback section states the safe order and the go/no-go', () => {
  const doc = read('docs/restpilot-upgrade-2026-11/APPLE-IAP-SETUP.md');
  const sec = doc.slice(doc.indexOf('## 4. Rollback'), doc.indexOf('## 5.'));
  assert.match(sec, /Stop NEW App Store sales[^\n]*remove `VITE_REVENUECAT_IOS_API_KEY` and Publish/);
  assert.match(sec, /Keep `IAP_ENABLED=true` while ANY Apple subscriber exists/);
  assert.match(sec, /hides their Premium/);
  assert.match(sec, /disables Restore/);
  assert.match(sec, /duplicate-billing guard inert/);
  assert.match(sec, /`IAP_HONOR_SANDBOX` OFF after App Review/);
  assert.match(sec, /sandbox and TestFlight purchases grant real Premium/);
  assert.match(sec, /sandbox webhook from RevenueCat returns HTTP 200 with a valid signature[\s\S]*no-go/i);
});
