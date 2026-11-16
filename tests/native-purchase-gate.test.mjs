// Inside the iPhone app shell no website purchase can be started
// (App Store Guideline 3.1.1). The website is unchanged
// (see stripe-checkout-regression.test.mjs).
import test from 'node:test';
import { assert, read, billingHarness, loadNativeApp, APP_UA, SAFARI_UA } from './_native-harness.mjs';

// ---- detection -------------------------------------------------------------
test('client detection: Capacitor native platform or the RestPilotApp/ User-Agent token', () => {
  const ua = (s) => ({ userAgent: s });
  assert.equal(loadNativeApp(undefined).isNativeApp(), false, 'server render');
  assert.equal(loadNativeApp({}, ua(SAFARI_UA)).isNativeApp(), false, 'Safari');
  assert.equal(loadNativeApp({ Capacitor: { isNativePlatform: () => false } }, ua(SAFARI_UA)).isNativeApp(), false, 'Capacitor web runtime');
  assert.equal(loadNativeApp({ Capacitor: { isNativePlatform: () => true } }, ua(SAFARI_UA)).isNativeApp(), true, 'app shell bridge');
  assert.equal(loadNativeApp({}, ua(APP_UA)).isNativeApp(), true, 'app shell User-Agent only');
  assert.equal(loadNativeApp({ Capacitor: { isNativePlatform: () => { throw new Error('x'); } } }, ua(APP_UA)).isNativeApp(), true, 'bridge throws, UA still detects');
  assert.equal(loadNativeApp({ Capacitor: { isNativePlatform: () => { throw new Error('x'); } } }, ua(SAFARI_UA)).isNativeApp(), false, 'never throws');
});

test('server detection: UA token or explicit header; ordinary browsers are not matched', () => {
  const { isNativeAppRequest, NATIVE_APP_HEADER } = loadNativeApp();
  assert.equal(NATIVE_APP_HEADER, 'x-restpilot-native-app');
  const h = (o) => new Headers(o);
  assert.equal(isNativeAppRequest(h({ 'user-agent': APP_UA })), true);
  assert.equal(isNativeAppRequest(h({ 'user-agent': SAFARI_UA, [NATIVE_APP_HEADER]: '1' })), true);
  for (const o of [{ 'user-agent': SAFARI_UA }, { 'user-agent': SAFARI_UA, [NATIVE_APP_HEADER]: '0' }, { 'user-agent': 'RestPilot/1.0' }, {}]) {
    assert.equal(isNativeAppRequest(h(o)), false, JSON.stringify(o));
  }
  assert.equal(isNativeAppRequest(null), false);
});

// ---- server defence in depth ----------------------------------------------
for (const [name, headers] of [['RestPilotApp/ User-Agent', { 'user-agent': APP_UA }], ['explicit native header', { 'user-agent': SAFARI_UA, 'x-restpilot-native-app': '1' }]]) {
  test(`server refuses website checkout from the app (${name}) before any Stripe or database call`, async () => {
    for (const priceId of ['restpilot_monthly', 'restpilot_annual']) {
      const h = billingHarness({ headers });
      assert.deepEqual(await h.checkout(priceId), { error: "Subscriptions aren't available in the app yet." });
      assert.deepEqual(h.requests(), []); assert.deepEqual(h.envs, []); assert.deepEqual(h.dbCalls, []);
    }
  });
  test(`server refuses the Stripe portal from the app (${name})`, async () => {
    const h = billingHarness({ headers });
    assert.deepEqual(await h.portal(), { error: "Subscriptions aren't available in the app yet." });
    assert.deepEqual(h.requests(), []); assert.deepEqual(h.dbCalls, []);
  });
}

test('the client tells the server it is the app only when it is (website headers unchanged)', () => {
  const src = read('src/integrations/supabase/auth-attacher.custom.ts');
  assert.match(src, /const headers: Record<string, string> = token \? \{ Authorization: `Bearer \$\{token\}` \} : \{\};/);
  assert.match(src, /if \(isNativeApp\(\)\) headers\[NATIVE_APP_HEADER\] = "1";/);
  assert.match(src, /return next\(\{ headers \}\);/);
});

// ---- UI: no purchase entry point in the app --------------------------------
test('/paywall: neutral notice in the app, and checkout cannot start even before the notice renders', () => {
  const src = read('src/routes/paywall.tsx');
  assert.match(src, /if \(inNativeApp\) return <NativeSubscriptionNotice \/>;/);
  const start = src.indexOf('async function startCheckout');
  assert.ok(src.indexOf('if (isNativeApp()) return;', start) < src.indexOf('createCheckoutSession(', start), 'synchronous guard before the server call');
  const resume = src.indexOf('restpilot_pending_checkout");', src.indexOf('useEffect'));
  assert.ok(src.indexOf('if (isNativeApp()) return;', resume) > 0, 'saved checkout intent is dropped in the app');
  assert.ok(src.indexOf('if (inNativeApp) return <NativeSubscriptionNotice />;') < src.indexOf('if (clientSecret)'), 'notice wins over an open checkout');
});

test('/pricing: neutral notice in the app', () => {
  assert.match(read('src/routes/pricing.tsx'), /if \(useIsNativeApp\(\)\) return <NativeSubscriptionNotice \/>;/);
});

test('the neutral notice has no price, purchase button or website purchase wording', () => {
  const src = read('src/components/native/NativeSubscriptionNotice.tsx');
  const jsx = src.slice(src.indexOf('return ('));
  assert.doesNotMatch(jsx, /\$\d|price|buy|subscribe now|checkout|stripe|website|restpilotai\.com|\/pricing|\/paywall|upgrade|trial\b/i);
  assert.match(src, /NATIVE_PURCHASE_UNAVAILABLE/);
  assert.match(src, /getSubscriptionState/, 'existing subscribers see their plan status');
  assert.match(read('src/lib/native-app.ts'), /NATIVE_PURCHASE_UNAVAILABLE =\s*"Subscriptions aren't available in the app yet\."/);
});

test('trial and price calls to action are website-only on /, /science and /features', () => {
  const index = read('src/routes/index.tsx');
  assert.match(index, /<WebOnly>\s*<PricingPreview ctaHref=\{ctaHref\} \/>\s*<CtaBand ctaHref=\{ctaHref\} \/>\s*<\/WebOnly>/);
  assert.match(index, /<WebOnly>\s*<Link\s+to=\{ctaHref\}[\s\S]*?Start free — 14 days[\s\S]*?<\/Link>\s*<\/WebOnly>/);
  assert.match(read('src/routes/science.tsx'), /<WebOnly>\s*<Link\s+to="\/auth"[\s\S]*?Start free — 14 days\s*<\/Link>\s*<\/WebOnly>/);
  assert.match(read('src/routes/features.tsx'), /<WebOnly>\s*<p[^>]*>\s*14 days free[\s\S]*?Start free trial[\s\S]*?<\/Link>\s*<\/WebOnly>/);
  assert.match(read('src/components/native/WebOnly.tsx'), /return useIsNativeApp\(\) \? null : <>\{children\}<\/>;/);
});

test('navigation: no Upgrade or Pricing entries in the app', () => {
  assert.match(read('src/components/site/AppSidebar.tsx'), /footerNav\s*\.filter\(\(n\) => !\(inNativeApp && n\.to === "\/paywall"\)\)/);
  const header = read('src/components/site/SiteHeader.tsx');
  assert.match(header, /const links = inNativeApp \? nav\.filter\(\(n\) => n\.to !== "\/pricing"\) : nav;/);
  assert.equal((header.match(/\{nav\.map/g) ?? []).length, 0, 'both header menus use the filtered list');
  assert.match(read('src/components/site/SiteFooter.tsx'), /\.\.\.\(inNativeApp \? \[\] : \[\{ to: "\/pricing", label: "Pricing" \}\]\)/);
});

test('AI-limit prompts: no Upgrade action in the app (companion, coach, pilot)', () => {
  // The three chat surfaces no longer build their own AI-limit toast: the one
  // shared helper does, and it is the only place with a /paywall toast action.
  for (const f of ['companion', 'coach', 'pilot']) {
    const src = read(`src/routes/${f}.tsx`);
    assert.equal((src.match(/window\.location\.href = "\/paywall"/g) ?? []).length, 0, `${f}: no /paywall toast action of its own`);
    assert.match(src, /toastAIRefusal\(/, `${f}: uses the shared, gated helper`);
  }
  const helper = read('src/lib/ai/refusal-client.ts');
  const n = (helper.match(/window\.location\.href = "\/paywall"/g) ?? []).length;
  const gated = (helper.match(/!refusal\.offerUpgrade \|\| isNativeApp\(\)\s*\?\s*\{ description \}\s*:\s*\{[\s\S]{0,300}?window\.location\.href = "\/paywall"/g) ?? []).length;
  assert.equal(n, 1);
  assert.equal(gated, n, 'the /paywall toast action is gated on isNativeApp()');
  // The in-conversation line: no upgrade wording in the app (behaviour is
  // covered in tests/ai-limit-truth.test.mjs).
  assert.match(read('src/lib/ai/refusal.ts'), /const offerUpgrade = !opts\.native;/);
  const companion = read('src/routes/companion.tsx');
  assert.match(companion, /function VoiceTrialUsedUp\(\) \{\s*if \(useIsNativeApp\(\)\) \{/);
});

test('/profile: no upgrade card and no Stripe portal button in the app', () => {
  const src = read('src/routes/profile.tsx');
  assert.match(src, /\) : inNativeApp \? null : \(\s*<Link\s+to="\/paywall"/);
  assert.match(src, /subState\.tier !== "lifetime" && !inNativeApp && \(\s*<button/);
  assert.match(src, /Billing changes aren&apos;t available in the app\./);
});

test('every link or redirect to /paywall or /pricing in the app UI is gated', () => {
  // Remaining references are legal-document text links and email templates, which
  // lead to the neutral notice in the app and are not purchase buttons.
  const allowed = new Set(['src/routes/legal.subscription.tsx', 'src/routes/legal.terms.tsx', 'src/routes/auth.tsx', 'src/routes/__root.tsx', 'src/routes/sitemap[.]xml.ts', 'src/routes/pricing.tsx', 'src/routes/paywall.tsx',
    'src/routes/index.tsx', 'src/routes/companion.tsx', 'src/routes/coach.tsx', 'src/routes/pilot.tsx', 'src/routes/profile.tsx',
    'src/components/site/AppSidebar.tsx', 'src/components/site/SiteHeader.tsx', 'src/components/site/SiteFooter.tsx',
    // The shared AI-refusal toast: its Upgrade action is gated on isNativeApp() (asserted above).
    'src/lib/ai/refusal-client.ts']);
  const { execSync } = process.getBuiltinModule('node:child_process');
  const files = execSync("git ls-files src | xargs grep -lE '\"/(paywall|pricing)\"' || true", { cwd: new URL('..', import.meta.url).pathname, encoding: 'utf8' }).trim().split('\n').filter(Boolean)
    .filter((f) => !f.includes('email-templates') && !f.endsWith('routeTree.gen.ts'));
  assert.deepEqual(files.filter((f) => !allowed.has(f)), [], 'new purchase entry points must be gated and listed here');
  // index.tsx only links /pricing from inside PricingPreview, which is WebOnly.
  const index = read('src/routes/index.tsx');
  const pricingLink = index.indexOf('to="/pricing"');
  assert.ok(pricingLink > index.indexOf('function PricingPreview') && pricingLink < index.indexOf('function CtaBand'));
});

test('hydration always matches the server, and components mounted later start hidden in the app', () => {
  const src = read('src/lib/native-app.ts');
  // useSyncExternalStore: React uses the server snapshot (false) while
  // hydrating, even for code-split routes that hydrate after the layout's
  // effects, so the client never disagrees with the server HTML (React #418).
  // Outside hydration (client navigation) it reads isNativeApp() directly.
  assert.match(src, /useSyncExternalStore\(noopSubscribe, isNativeApp, \(\) => false\)/);
  assert.doesNotMatch(src, /let hydrated/, 'no module-level hydration flag (caused #418 on code-split routes)');
  const load = (win) => {
    const calls = [];
    const useSyncExternalStore = (subscribe, getSnapshot, getServerSnapshot) => { calls.push({ subscribe, getSnapshot, getServerSnapshot }); return getSnapshot(); };
    const ts = process.getBuiltinModule('node:module').stripTypeScriptTypes;
    const js = ts(read('src/lib/native-app.ts')).replace(/^import[\s\S]*?;\n/gm, '').replaceAll('export ', '');
    const m = new Function('useSyncExternalStore', 'window', 'navigator', `${js}; return { useIsNativeApp };`)(useSyncExternalStore, win, { userAgent: 'x' });
    return { m, calls };
  };
  const app = load({ Capacitor: { isNativePlatform: () => true } });
  assert.equal(app.m.useIsNativeApp(), true, 'a component mounted after hydration starts hidden in the app');
  assert.equal(app.calls[0].getServerSnapshot(), false, 'server snapshot (used during hydration) matches the website');
  assert.equal(typeof app.calls[0].subscribe(() => {}), 'function', 'subscribe returns an unsubscribe');
  const web = load({});
  assert.equal(web.m.useIsNativeApp(), false, 'website stays web');
});
