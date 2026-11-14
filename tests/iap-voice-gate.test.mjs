// The voice gate counts App Store subscribers only when IAP_ENABLED=true.
import assert from 'node:assert/strict';
import test from 'node:test';
import { loadTs } from './_load-ts.mjs';

const merge = loadTs('src/lib/entitlements/merge.ts');
const future = new Date(Date.now() + 30 * 86_400_000).toISOString();

function gate({ env = {}, stripeRows = [], storeRows = [], storeError = null } = {}) {
  const tables = [];
  const db = {
    from(table) {
      tables.push(table);
      const result = table === 'store_entitlements' ? { data: storeRows, error: storeError } : table === 'trial_usage' ? null : { data: stripeRows, error: null };
      const q = { select() { return q; }, eq() { return q; }, then(resolve) { return Promise.resolve(resolve(result)); }, async maybeSingle() { return { data: { voice_seconds_used: 0 }, error: null }; } };
      return q;
    },
    async rpc() { return { data: 0, error: null }; },
  };
  const access = loadTs('src/lib/realtime/access.server.ts', { globals: { process: { env: { PAYMENTS_ENVIRONMENT: 'sandbox' } } } });
  const api = loadTs('src/lib/realtime/trial-usage.functions.ts', {
    modules: {
      '@tanstack/react-start': { createServerFn: () => { const b = { middleware: () => b, inputValidator: () => b, handler: (fn) => fn }; return b; } },
      '@/integrations/supabase/auth-middleware': {}, './access.server': access, '@/lib/trial-limits': { TRIAL_VOICE_SECONDS_CAP: 3600 },
      '@/integrations/supabase/client.server': { supabaseAdmin: db }, '@/lib/entitlements/merge': merge,
    },
    globals: { process: { env } },
  });
  return { load: () => api.loadTrialUsageState('11111111-1111-4111-8111-111111111111', 'sandbox'), tables };
}
const appleRow = (o = {}) => ({ environment: 'live', plan: 'annual', period_type: 'normal', expires_at: future, grace_expires_at: null, will_renew: true, ...o });

test('flag off: App Store rows are never read and grant nothing', async () => {
  const g = gate({ storeRows: [appleRow()] });
  await assert.rejects(g.load(), /active subscription/);
  assert.ok(!g.tables.includes('store_entitlements'));
});

test('flag on: paid App Store subscriber passes the voice gate as paid', async () => {
  const g = gate({ env: { IAP_ENABLED: 'true' }, storeRows: [appleRow()] });
  assert.equal((await g.load()).isTrial, false);
});

test('flag on: App Store free trial is metered like a Stripe trial', async () => {
  const g = gate({ env: { IAP_ENABLED: 'true' }, storeRows: [appleRow({ period_type: 'trial' })] });
  assert.equal((await g.load()).isTrial, true);
});

test('flag on: expired App Store row and store read errors fail closed', async () => {
  await assert.rejects(gate({ env: { IAP_ENABLED: 'true' }, storeRows: [appleRow({ expires_at: '2000-01-01T00:00:00Z' })] }).load(), /active subscription/);
  await assert.rejects(gate({ env: { IAP_ENABLED: 'true' }, storeError: {} }).load(), /unavailable/);
});

test('flag on: Stripe subscribers are unaffected', async () => {
  const g = gate({ env: { IAP_ENABLED: 'true' }, stripeRows: [{ status: 'active', current_period_end: future }] });
  assert.equal((await g.load()).isTrial, false);
});
