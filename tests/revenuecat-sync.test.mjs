import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';
import { loadTs } from './_load-ts.mjs';

const rc = loadTs('src/lib/entitlements/revenuecat.ts');
const sync = loadTs('src/lib/entitlements/store-sync.server.ts', { modules: { './revenuecat': rc } });

const USER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const REQUEST_MS = Date.parse('2026-11-14T12:00:00Z');
const sub = (o = {}) => ({ store: 'app_store', is_sandbox: false, period_type: 'normal', expires_date: '2026-12-14T12:00:00Z', grace_period_expires_date: null, unsubscribe_detected_at: null, billing_issues_detected_at: null, refunded_at: null, ...o });
const subscriber = (subscriptions = {}, extra = {}) => ({ request_date_ms: REQUEST_MS, subscriber: { original_app_user_id: USER, management_url: 'https://apps.apple.com/account/subscriptions', subscriptions, entitlements: {}, ...extra } });

test('snapshot: live monthly subscription, empty sandbox snapshot clears stale rows', () => {
  const [live, sandbox] = rc.snapshotsFromSubscriber(USER, subscriber({ restpilot_monthly: sub() }));
  assert.equal(live.environment, 'live'); assert.equal(live.plan, 'monthly'); assert.equal(live.product_id, 'restpilot_monthly');
  assert.equal(live.store, 'app_store'); assert.equal(live.will_renew, true); assert.equal(live.billing_issue, false);
  assert.equal(live.expires_at, '2026-12-14T12:00:00.000Z'); assert.equal(live.snapshot_at, new Date(REQUEST_MS).toISOString());
  assert.equal(live.management_url, 'https://apps.apple.com/account/subscriptions');
  assert.equal(sandbox.environment, 'sandbox'); assert.equal(sandbox.expires_at, null); assert.equal(sandbox.plan, null);
});

test('snapshot: trial, cancellation, billing issue, grace period, sandbox', () => {
  const [, s] = rc.snapshotsFromSubscriber(USER, subscriber({ restpilot_annual: sub({ is_sandbox: true, period_type: 'trial', unsubscribe_detected_at: '2026-11-10T00:00:00Z', billing_issues_detected_at: '2026-11-11T00:00:00Z', grace_period_expires_date: '2026-12-20T00:00:00Z' }) }));
  assert.equal(s.environment, 'sandbox'); assert.equal(s.plan, 'annual'); assert.equal(s.period_type, 'trial');
  assert.equal(s.will_renew, false); assert.equal(s.billing_issue, true); assert.equal(s.grace_expires_at, '2026-12-20T00:00:00.000Z');
});

test('snapshot: refunded, foreign-store, unknown and lifetime products grant nothing', () => {
  const snaps = rc.snapshotsFromSubscriber(USER, subscriber({
    restpilot_monthly: sub({ refunded_at: '2026-11-13T00:00:00Z' }),
    restpilot_annual: sub({ store: 'stripe' }),
    restpilot_lifetime: sub(),
    some_other_app_product: sub(),
  }));
  assert.ok(snaps.every((s) => s.expires_at === null && s.plan === null));
});

test('snapshot: picks the latest-ending subscription (upgrade monthly → annual)', () => {
  const [live] = rc.snapshotsFromSubscriber(USER, subscriber({ restpilot_monthly: sub({ expires_date: '2026-11-20T00:00:00Z' }), restpilot_annual: sub({ expires_date: '2027-11-20T00:00:00Z' }) }));
  assert.equal(live.plan, 'annual');
});

test('snapshot: management URL must be an apps.apple.com https URL', () => {
  for (const url of ['https://evil.example/x', 'http://apps.apple.com/x', 'javascript:alert(1)', 'https://user:pw@apps.apple.com/x', 42]) {
    assert.equal(rc.snapshotsFromSubscriber(USER, subscriber({ restpilot_monthly: sub() }, { management_url: url }))[0].management_url, null);
  }
});

test('snapshot: malformed responses throw (retryable) instead of clearing access', () => {
  for (const body of [null, {}, { subscriber: {} }, { request_date_ms: 'x', subscriber: {} }, { request_date_ms: -1, subscriber: {} }, { request_date_ms: REQUEST_MS, subscriber: [] }]) {
    assert.throws(() => rc.snapshotsFromSubscriber(USER, body));
  }
  assert.throws(() => rc.snapshotsFromSubscriber('$RCAnonymousID:abc', subscriber()), /app user id/);
});

test('affected users: purchaser, aliases and both sides of a transfer; UUIDs only; deduped and capped', () => {
  assert.deepEqual(rc.affectedUserIds({ app_user_id: USER, original_app_user_id: USER.toUpperCase(), aliases: ['$RCAnonymousID:x', OTHER], transferred_from: [OTHER], transferred_to: ['not-a-uuid'] }), [USER, OTHER]);
  assert.deepEqual(rc.affectedUserIds({ type: 'TEST' }), []);
  assert.deepEqual(rc.affectedUserIds(null), []);
  const many = Array.from({ length: 50 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`);
  assert.equal(rc.affectedUserIds({ aliases: many }).length, 10);
});

test('packagesByPlan maps the current offering to our two plans only', () => {
  const pkgs = rc.packagesByPlan({ current: { availablePackages: [
    { identifier: '$rc_monthly', product: { identifier: 'restpilot_monthly', priceString: '$7.99' } },
    { identifier: '$rc_annual', product: { identifier: 'restpilot_annual', priceString: '$49.99' } },
    { identifier: '$rc_lifetime', product: { identifier: 'restpilot_lifetime' } },
  ] } });
  assert.deepEqual(Object.keys(pkgs).sort(), ['annual', 'monthly']);
  assert.deepEqual(rc.packagesByPlan(null), {});
  assert.deepEqual(rc.packagesByPlan({ current: null }), {});
});

// ---- webhook handler ----------------------------------------------------
const SECRET = 'whsec_test_secret';
const NOW_S = 1_794_657_600;
const sign = (body, t = NOW_S, secret = SECRET) => `t=${t},v1=${createHmac('sha256', secret).update(`${t}.${body}`).digest('hex')}`;
const ENV = { IAP_ENABLED: 'true', REVENUECAT_WEBHOOK_SECRET: SECRET, REVENUECAT_SECRET_API_KEY: 'sk_test_key' };

function fixture(o = {}) {
  const calls = []; const processed = new Set(o.processed ?? []); const applied = [];
  let failApply = o.failApply ?? false;
  const deps = {
    env: { ...ENV, ...o.env },
    nowSeconds: () => NOW_S,
    async fetch(url, init) {
      calls.push(`fetch:${url}`);
      assert.equal(init.headers.Authorization, 'Bearer sk_test_key');
      assert.equal(init.redirect, 'error');
      if (o.fetchStatus) return new Response('nope', { status: o.fetchStatus });
      return Response.json(subscriber({ restpilot_monthly: sub() }));
    },
    async applySnapshot(s) { calls.push(`apply:${s.user_id}:${s.environment}`); if (failApply) throw new Error('db down'); applied.push(s); return true; },
    async isProcessed(id) { calls.push(`seen?:${id}`); return processed.has(id); },
    async markProcessed(id) { calls.push(`mark:${id}`); processed.add(id); },
    log() {},
  };
  const post = (event, { headers = {}, raw } = {}) => {
    const body = raw ?? JSON.stringify({ api_version: '1.0', event });
    return sync.handleRevenueCatWebhook(new Request('https://restpilotai.com/api/public/iap/revenuecat', { method: 'POST', body, headers: { 'x-revenuecat-webhook-signature': sign(body), ...headers } }), deps);
  };
  return { calls, applied, processed, post, deps, setFailApply(v) { failApply = v; } };
}
const event = (o = {}) => ({ id: 'evt_1', type: 'INITIAL_PURCHASE', app_user_id: USER, original_app_user_id: USER, aliases: [USER], environment: 'PRODUCTION', ...o });

test('webhook is inert (404) unless IAP_ENABLED=true, before reading anything', async () => {
  for (const IAP_ENABLED of [undefined, '', 'false', '1', 'TRUE']) {
    const f = fixture({ env: { IAP_ENABLED } });
    const res = await f.post(event());
    assert.equal(res.status, 404); assert.deepEqual(f.calls, []);
  }
});

test('webhook with flag on but secrets missing is 503 and does nothing', async () => {
  for (const env of [{ REVENUECAT_WEBHOOK_SECRET: '' }, { REVENUECAT_SECRET_API_KEY: undefined }]) {
    const f = fixture({ env }); assert.equal((await f.post(event())).status, 503); assert.deepEqual(f.calls, []);
  }
});

test('valid signed event fetches canonical state, writes both environments, records the event', async () => {
  const f = fixture();
  const res = await f.post(event());
  assert.equal(res.status, 200);
  assert.deepEqual(f.calls, ['seen?:evt_1', `fetch:https://api.revenuecat.com/v1/subscribers/${USER}`, `apply:${USER}:live`, `apply:${USER}:sandbox`, 'mark:evt_1']);
  assert.equal(f.applied[0].plan, 'monthly');
});

test('signature failures are 401 and touch nothing', async () => {
  const body = JSON.stringify({ event: event() });
  const cases = [
    {}, // missing header
    { 'x-revenuecat-webhook-signature': sign(body, NOW_S, 'wrong-secret') },
    { 'x-revenuecat-webhook-signature': sign(body, NOW_S - 301) },
    { 'x-revenuecat-webhook-signature': sign(body, NOW_S + 301) },
    { 'x-revenuecat-webhook-signature': sign(body + ' ') },
    { 'x-revenuecat-webhook-signature': 'v1=abc' },
    { 'x-revenuecat-webhook-signature': 't=abc,v1=abc' },
  ];
  for (const headers of cases) {
    const f = fixture();
    const req = new Request('https://x.test/', { method: 'POST', body, headers });
    const res = await sync.handleRevenueCatWebhook(req, f.deps);
    assert.equal(res.status, 401, JSON.stringify(headers)); assert.deepEqual(f.calls, []);
  }
});

test('optional Authorization header is enforced when configured', async () => {
  const f = fixture({ env: { REVENUECAT_WEBHOOK_AUTHORIZATION: 'Bearer hook-auth' } });
  assert.equal((await f.post(event())).status, 401);
  assert.equal((await f.post(event(), { headers: { authorization: 'Bearer wrong' } })).status, 401);
  assert.equal((await f.post(event(), { headers: { authorization: 'Bearer hook-auth' } })).status, 200);
});

test('duplicate delivery is acknowledged without a second sync', async () => {
  const f = fixture({ processed: ['evt_1'] });
  const res = await f.post(event());
  assert.equal(res.status, 200); assert.deepEqual(await res.json(), { received: true, duplicate: true });
  assert.deepEqual(f.calls, ['seen?:evt_1']);
});

test('persistence failure is 500 (retry) and the event is not marked; retry then succeeds once', async () => {
  const f = fixture({ failApply: true });
  assert.equal((await f.post(event())).status, 500);
  assert.equal(f.processed.has('evt_1'), false);
  f.setFailApply(false);
  assert.equal((await f.post(event())).status, 200);
  assert.equal((await f.post(event())).status, 200);
  assert.equal(f.calls.filter((c) => c.startsWith('fetch:')).length, 2, 'third delivery is deduped');
});

test('RevenueCat API failure is 500 and records nothing', async () => {
  const f = fixture({ fetchStatus: 503 });
  assert.equal((await f.post(event())).status, 500); assert.equal(f.processed.size, 0);
});

test('TRANSFER refreshes both accounts so the old account loses access', async () => {
  const f = fixture();
  await f.post(event({ type: 'TRANSFER', app_user_id: undefined, original_app_user_id: undefined, aliases: undefined, transferred_from: [OTHER], transferred_to: [USER] }));
  assert.ok(f.calls.includes(`fetch:https://api.revenuecat.com/v1/subscribers/${OTHER}`));
  assert.ok(f.calls.includes(`fetch:https://api.revenuecat.com/v1/subscribers/${USER}`));
});

test('TEST and anonymous events are acknowledged without API calls', async () => {
  const f = fixture();
  assert.equal((await f.post(event({ type: 'TEST', app_user_id: '$RCAnonymousID:abc', original_app_user_id: null, aliases: [] }))).status, 200);
  assert.ok(!f.calls.some((c) => c.startsWith('fetch:'))); assert.ok(f.processed.has('evt_1'));
});

test('signed but malformed payloads are 400', async () => {
  for (const raw of ['not json', '{}', '{"event":null}', JSON.stringify({ event: { id: '' } }), JSON.stringify({ event: { id: 'x'.repeat(129) } }), JSON.stringify({ event: { id: 7 } })]) {
    const f = fixture();
    assert.equal((await f.post(null, { raw })).status, 400, raw); assert.ok(!f.calls.some((c) => c.startsWith('fetch:')));
  }
});

test('oversized bodies are rejected before verification', async () => {
  const f = fixture();
  const raw = JSON.stringify({ event: event({ pad: 'x'.repeat(70 * 1024) }) });
  assert.equal((await f.post(null, { raw })).status, 413); assert.deepEqual(f.calls, []);
});

test('authenticated sync refuses non-UUID users and missing API key', async () => {
  const f = fixture();
  await assert.rejects(sync.syncStoreEntitlement('$RCAnonymousID:x', f.deps), /app user id/);
  await assert.rejects(sync.syncStoreEntitlement(USER, { ...f.deps, env: {} }), /not configured/);
});

test('oversized bodies are rejected while streaming, even without or with a lying Content-Length', async () => {
  const big = JSON.stringify({ event: event({ pad: 'x'.repeat(70 * 1024) }) });
  const stream = () => new ReadableStream({ start(c) { const b = new TextEncoder().encode(big); for (let i = 0; i < b.length; i += 8192) c.enqueue(b.slice(i, i + 8192)); c.close(); } });
  for (const headers of [{}, { 'content-length': '10' }]) {
    const f = fixture();
    const req = new Request('https://x.test/', { method: 'POST', body: stream(), duplex: 'half', headers: { 'x-revenuecat-webhook-signature': sign(big), ...headers } });
    assert.equal((await sync.handleRevenueCatWebhook(req, f.deps)).status, 413, JSON.stringify(headers));
    assert.deepEqual(f.calls, []);
  }
  const ok = fixture();
  const small = JSON.stringify({ api_version: '1.0', event: event() });
  const req = new Request('https://x.test/', { method: 'POST', body: new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(small)); c.close(); } }), duplex: 'half', headers: { 'x-revenuecat-webhook-signature': sign(small) } });
  assert.equal((await sync.handleRevenueCatWebhook(req, ok.deps)).status, 200, 'streamed body within the cap still works');
});

test('sandbox purchases are stored only while IAP_HONOR_SANDBOX=true (otherwise the sandbox row is written empty)', async () => {
  const sandboxBody = subscriber({ restpilot_monthly: sub({ is_sandbox: true }) });
  for (const [honor, expectPlan] of [[undefined, null], ['true', 'monthly']]) {
    const applied = [];
    const deps = { env: { ...ENV, IAP_HONOR_SANDBOX: honor }, fetch: async () => Response.json(sandboxBody), applySnapshot: async (s) => { applied.push(s); return true; } };
    await sync.syncStoreEntitlement(USER, deps);
    const sandbox = applied.find((s) => s.environment === 'sandbox');
    assert.equal(sandbox.plan, expectPlan); assert.equal(sandbox.expires_at === null, expectPlan === null);
    assert.equal(sandbox.snapshot_at, new Date(REQUEST_MS).toISOString(), 'still ordered, so it also clears older rows');
  }
});
