// Shared helpers: load native-app.ts and run the real billing handlers with
// Stripe, Supabase and the framework replaced. No network.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';

const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');

export function loadNativeApp(windowValue, navigatorValue) {
  const js = ts.transpileModule(read('src/lib/native-app.ts'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const module = { exports: {} };
  const ctx = { module, exports: module.exports, require: (n) => { if (n === 'react') return { useEffect() {}, useState: (v) => [v, () => {}] }; throw new Error('unexpected ' + n); } };
  if (windowValue !== undefined) ctx.window = windowValue;
  if (navigatorValue !== undefined) ctx.navigator = navigatorValue;
  vm.runInNewContext(js, ctx);
  return module.exports;
}

export const SAFARI_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
export const APP_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 RestPilotApp/1.0.0';

export function billingHarness({ headers = { 'user-agent': SAFARI_UA }, existingCustomer = null, emailCustomer = null } = {}) {
  const native = loadNativeApp();
  const source = stripTypeScriptTypes(read('src/lib/billing.functions.ts'))
    .replace(/^import[\s\S]*?;\n/gm, '').replaceAll('export const ', 'const ');
  const requests = [];
  const dbCalls = [];
  const stripe = {
    customers: {
      async search(p) { requests.push(['customers.search', p]); return { data: existingCustomer ? [existingCustomer] : [] }; },
      async list(p) { requests.push(['customers.list', p]); return { data: emailCustomer ? [emailCustomer] : [] }; },
      async update(id, p) { requests.push(['customers.update', id, p]); return { id }; },
      async create(p) { requests.push(['customers.create', p]); return { id: 'cus_new' }; },
      async retrieve(id) { requests.push(['customers.retrieve', id]); return { id, metadata: { userId: 'user-123' } }; },
    },
    prices: { async list(p) {
      requests.push(['prices.list', p]);
      const k = p.lookup_keys[0];
      return { data: [{ id: `price_${k}`, lookup_key: k, active: true, type: 'recurring', product: 'prod_restpilot', recurring: { interval: k === 'restpilot_monthly' ? 'month' : 'year', interval_count: 1 } }] };
    } },
    products: { async retrieve(id) { requests.push(['products.retrieve', id]); return { name: 'x' }; } },
    checkout: { sessions: { async create(p) { requests.push(['checkout.sessions.create', p]); return { client_secret: 'cs_secret_test' }; } } },
    billingPortal: { sessions: { async create(p) { requests.push(['billingPortal.sessions.create', p]); return { url: 'https://billing.stripe.com/p/test' }; } } },
  };
  const supabase = {
    auth: { async getUser() { dbCalls.push('auth.getUser'); return { data: { user: { email: 'member@example.test' } } }; } },
    from(t) {
      dbCalls.push(`from:${t}`);
      const q = { select() { return q; }, eq() { return q; }, order() { return q; }, limit() { return q; }, async maybeSingle() { return { data: { stripe_customer_id: 'cus_owned' }, error: null }; } };
      return q;
    },
  };
  function createServerFn() {
    let v;
    const b = { middleware() { return b; }, inputValidator(fn) { v = fn; return b; }, handler(fn) { return (a) => fn({ ...a, data: v(a.data) }); } };
    return b;
  }
  const envs = [];
  const ctx = vm.createContext({
    createServerFn, requireSupabaseAuth: {}, getStripeErrorMessage: (e) => e.message,
    createStripeClient(env) { envs.push(env); return stripe; },
    getRequest: () => new Request('https://restpilotai.com/_serverFn/x', { method: 'POST', headers }),
    isNativeAppRequest: native.isNativeAppRequest, NATIVE_PURCHASE_UNAVAILABLE: native.NATIVE_PURCHASE_UNAVAILABLE,
  });
  const { createCheckoutSession, createPortalSession } = vm.runInContext(`${source}\n({createCheckoutSession, createPortalSession})`, ctx);
  const context = { supabase, userId: 'user-123' };
  return {
    envs, dbCalls,
    requests: () => JSON.parse(JSON.stringify(requests)),
    checkout: (priceId, environment = 'live') => createCheckoutSession({ context, data: { priceId, environment, returnUrl: 'https://restpilotai.com/profile?checkout=success&session_id={CHECKOUT_SESSION_ID}' } }).then((r) => JSON.parse(JSON.stringify(r))),
    portal: () => createPortalSession({ context, data: { environment: 'live', returnUrl: 'https://restpilotai.com/profile' } }).then((r) => JSON.parse(JSON.stringify(r))),
  };
}
export { assert, read };
