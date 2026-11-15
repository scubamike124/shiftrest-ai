// Owner decision (Nov 15 2026): new subscriptions are sold through Apple's App
// Store, not Stripe. VITE_WEB_CHECKOUT_ENABLED (default off) removes website
// checkout and the start-trial calls to action; the server refuses new
// purchases. Existing Stripe subscribers keep the portal and full management,
// including past-due subscribers, who now see "Manage billing".
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { assert, read, billingHarness, loadBillingFlags, APP_UA } from './_native-harness.mjs';
import { loadTs } from './_load-ts.mjs';

const OFF_MESSAGE = loadBillingFlags().WEB_CHECKOUT_DISABLED_MESSAGE;

// ---- the flag ---------------------------------------------------------------
test('flag: only the exact string "true" turns website checkout on; unset is off', () => {
  assert.equal(loadBillingFlags({}).webCheckoutEnabled(), false);
  for (const v of ['', 'false', '1', 'TRUE', 'yes', ' true']) {
    assert.equal(loadBillingFlags({ VITE_WEB_CHECKOUT_ENABLED: v }).webCheckoutEnabled(), false, JSON.stringify(v));
  }
  assert.equal(loadBillingFlags({ VITE_WEB_CHECKOUT_ENABLED: 'true' }).webCheckoutEnabled(), true);
});

test('flag: default is off in every committed env file (owner decision)', () => {
  for (const f of ['.env', '.env.production', '.env.development', '.env.example']) {
    let src = '';
    try { src = readFileSync(new URL('../' + f, import.meta.url), 'utf8'); } catch { continue; }
    assert.doesNotMatch(src, /^\s*VITE_WEB_CHECKOUT_ENABLED\s*=\s*["']?true/m, f);
  }
});

// ---- server -------------------------------------------------------------------
test('web checkout refused when off: monthly and annual, before any Stripe or database call', async () => {
  assert.equal(OFF_MESSAGE, "New subscriptions aren't sold on the website. Subscribe in the RestPilot iPhone app.");
  for (const priceId of ['restpilot_monthly', 'restpilot_annual']) {
    for (const environment of ['live', 'sandbox']) {
      const h = billingHarness();
      assert.deepEqual(await h.checkout(priceId, environment), { error: OFF_MESSAGE });
      assert.deepEqual(h.requests(), [], 'no Stripe request');
      assert.deepEqual(h.envs, [], 'no Stripe client');
      assert.deepEqual(h.dbCalls, [], 'no database call');
    }
  }
});

test('web checkout refused when off: invalid and lifetime prices are still rejected by the validator', async () => {
  const h = billingHarness();
  await assert.rejects(async () => h.checkout('restpilot_lifetime'), /Lifetime membership is no longer offered/);
  await assert.rejects(async () => h.checkout('price_123'), /Invalid priceId/);
  assert.deepEqual(h.requests(), []);
});

test('the iPhone app refusal is unchanged and takes precedence, flag on or off', async () => {
  for (const webCheckout of [false, true]) {
    const h = billingHarness({ headers: { 'user-agent': APP_UA }, webCheckout });
    assert.deepEqual(await h.checkout('restpilot_monthly'), { error: "Subscriptions aren't available in the app yet." });
    assert.deepEqual(h.requests(), []);
  }
});

test('with the flag on, website checkout still opens Stripe (unchanged; pinned in stripe-checkout-regression)', async () => {
  const h = billingHarness({ webCheckout: true });
  assert.deepEqual(await h.checkout('restpilot_annual'), { clientSecret: 'cs_secret_test' });
  assert.equal(h.requests().at(-1)[0], 'checkout.sessions.create');
});

test('existing Stripe subscribers keep the Customer Portal with checkout off (including past_due)', async () => {
  const h = billingHarness();
  assert.deepEqual(await h.portal(), { url: 'https://billing.stripe.com/p/test' });
  assert.deepEqual(h.requests(), [['billingPortal.sessions.create', { customer: 'cus_owned', return_url: 'https://restpilotai.com/profile' }]]);
  // The portal looks the customer up by user and environment, never by status,
  // so past_due / unpaid / canceled customers can reach it too.
  const src = read('src/lib/billing.functions.ts');
  const portal = src.slice(src.indexOf('export const createPortalSession'));
  assert.doesNotMatch(portal, /\.eq\("status"/);
  assert.doesNotMatch(portal, /webCheckoutEnabled/);
});

// ---- subscription state: past_due --------------------------------------------
function subscriptionState(row) {
  const supabase = {
    auth: { async getSession() { return { data: { session: { user: { id: 'u1' } } } }; } },
    from(t) {
      assert.equal(t, 'subscriptions');
      const q = { select() { return q; }, eq() { return q; }, order() { return q; }, limit() { return q; }, async maybeSingle() { return { data: row, error: null }; } };
      return q;
    },
  };
  const mod = loadTs('src/lib/subscription.ts', {
    modules: {
      '@/integrations/supabase/client': { supabase },
      '@/lib/stripe': { getStripeEnvironment: () => 'live', isPaymentsConfigured: () => true },
      // Apple IAP not set up for this build: Stripe answer only.
      '@/lib/billing-flags': { revenueCatIosKey: () => null },
      '@/lib/entitlements/entitlement.functions': { getEntitlementStatus: async () => { throw new Error('must not be called without the RevenueCat key'); } },
    },
  });
  return mod.getSubscriptionState();
}
const future = new Date(Date.now() + 10 * 86400e3).toISOString();
const past = new Date(Date.now() - 10 * 86400e3).toISOString();
const row = (o) => ({ price_id: 'restpilot_monthly', status: 'active', current_period_end: future, cancel_at_period_end: false, stripe_customer_id: 'cus_1', ...o });

test('past_due portal: past_due and unpaid are not Premium but are flagged as a billing issue', async () => {
  for (const status of ['past_due', 'unpaid']) {
    const s = await subscriptionState(row({ status }));
    assert.equal(s.isPremium, false, status);
    assert.equal(s.billingIssue, true, status);
    assert.equal(s.stripeCustomerId, 'cus_1');
  }
  // Even with the period already over (Stripe still retrying), they need the portal.
  assert.equal((await subscriptionState(row({ status: 'past_due', current_period_end: past }))).billingIssue, true);
  // No Stripe customer id: nothing to open.
  assert.equal((await subscriptionState(row({ status: 'past_due', stripe_customer_id: null }))).billingIssue, false);
});

test('active, trialing, lifetime and ended subscriptions are not billing issues', async () => {
  const cases = [
    [row({}), true],
    [row({ status: 'trialing' }), true],
    [row({ status: 'lifetime', price_id: 'restpilot_lifetime', current_period_end: null }), true],
    [row({ status: 'canceled', current_period_end: future }), true],
    [row({ status: 'canceled', current_period_end: past }), false],
    [row({ status: 'incomplete_expired', current_period_end: past }), false],
  ];
  for (const [r, premium] of cases) {
    const s = await subscriptionState(r);
    assert.equal(s.isPremium, premium, r.status);
    assert.equal(s.billingIssue, false, r.status);
  }
  const lifetime = await subscriptionState(cases[2][0]);
  assert.equal(lifetime.tier, 'lifetime');
});

test('past_due portal: Profile shows "Manage billing" (portal) instead of "Upgrade" for a billing issue', () => {
  const src = read('src/routes/profile.tsx');
  const issue = src.indexOf(') : subState?.billingIssue ? (');
  const upgrade = src.indexOf('Upgrade to Premium');
  assert.ok(issue > 0 && issue < upgrade, 'billing-issue branch comes before the Upgrade card');
  const branch = src.slice(issue, src.indexOf(') : inNativeApp && !iapAvailable() ? null : (', issue));
  assert.match(branch, /onClick=\{handleManageSubscription\}/);
  assert.match(branch, /"Manage billing"/);
  assert.match(branch, /\{!inNativeApp && \(/, 'no portal button inside the iPhone app (Guideline 3.1.1)');
  assert.doesNotMatch(branch, /to="\/paywall"|createCheckoutSession/);
});

// ---- website UI -------------------------------------------------------------
test('/paywall: with checkout off, no checkout button, trial CTA or Stripe badge; neutral app note instead', () => {
  const src = read('src/routes/paywall.tsx');
  const start = src.indexOf('async function startCheckout');
  const guard = src.indexOf('if (!webCheckoutEnabled()) return;', start);
  assert.ok(guard > start && guard < src.indexOf('createCheckoutSession(', start), 'guard before the server call');
  const resume = src.indexOf('restpilot_pending_checkout");', src.indexOf('useEffect'));
  assert.ok(src.indexOf('if (!webCheckoutEnabled()) return;', resume) < src.indexOf('startCheckout(pending)', resume), 'saved intent dropped when off');
  const on = src.indexOf('{checkoutOn ? (');
  const off = src.indexOf(') : (', on);
  const end = src.indexOf('      )}', off);
  for (const s of ['onClick={handleCheckout}', 'Secure checkout powered by Stripe', 'No charge today', '<RenewalDisclosure />']) {
    const i = src.indexOf(s);
    assert.ok(i > on && i < off, `${s} only when checkout is on`);
  }
  assert.match(src.slice(off, end), /\{APP_ONLY_PURCHASE_NOTE\}/);
  assert.match(src.slice(off, end), /to="\/profile"/);
  assert.doesNotMatch(src.slice(off, end), /apps\.apple\.com|href=/, 'no external purchase link');
  // In-app gate (#40): the app screen, never this website paywall.
  assert.match(src, /if \(inNativeApp\) return <AppSubscriptionScreen \/>;/);
});

test('/pricing: plan info stays; the "Choose" link to checkout only when checkout is on', () => {
  const src = read('src/routes/pricing.tsx');
  assert.match(src, /\$7\.99/); assert.match(src, /\$49\.99/); assert.match(src, /14-day free trial/);
  const on = src.indexOf('{checkoutOn ? (');
  const off = src.indexOf(') : (', on);
  const link = src.indexOf('to="/paywall"');
  assert.ok(link > on && link < off);
  assert.match(src.slice(off, off + 400), /Subscribe in the RestPilot iPhone app/);
  assert.doesNotMatch(src.slice(off, off + 400), /href=|<Link/);
  assert.match(src, /checkoutOn\s*\?\s*"Cancel anytime\. Billed securely through Stripe\./);
});

test('start-trial wording on /, /features and /science appears only when checkout is on', () => {
  const files = { 'src/routes/index.tsx': ['Start free — 14 days', 'Start free trial', 'Billed through Stripe', 'Free for 14 days'], 'src/routes/features.tsx': ['Start free trial', '14 days free'], 'src/routes/science.tsx': ['Start free — 14 days'] };
  for (const [f, phrases] of Object.entries(files)) {
    const src = read(f);
    for (const p of phrases) {
      let i = src.indexOf(p);
      assert.ok(i > 0, `${f}: ${p}`);
      while (i > 0) {
        const before = src.slice(Math.max(0, i - 160), i);
        assert.match(before, /webCheckoutEnabled\(\)\s*\?\s*[\s\S]*$/, `${f}: "${p}" is the checkout-on branch`);
        assert.doesNotMatch(before.slice(before.lastIndexOf('webCheckoutEnabled()')), /:\s*["`]/, `${f}: "${p}" is not the off branch`);
        i = src.indexOf(p, i + 1);
      }
    }
  }
});
