// Executes supabase/migrations/20261114120000_store_entitlements.sql in an
// isolated in-memory PostgreSQL (PGlite); never connects to a real database.
// RESTPILOT_PGLITE_MODULE=/path/to/@electric-sql/pglite/dist/index.js node scripts/qa/verify-store-entitlements.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
const { PGlite } = await import(process.env.RESTPILOT_PGLITE_MODULE || '@electric-sql/pglite');
const db = new PGlite();
await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
create schema auth; create table auth.users(id uuid primary key);
grant usage on schema auth to authenticated, anon;
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.uid', true), '')::uuid$$;
grant usage on schema public to anon, authenticated, service_role;`);
await db.exec(fs.readFileSync(new URL('../../supabase/migrations/20261114120000_store_entitlements.sql', import.meta.url), 'utf8'));
const A = '11111111-1111-4111-8111-111111111111', B = '22222222-2222-4222-8222-222222222222', GONE = '33333333-3333-4333-8333-333333333333';
await db.query('insert into auth.users values ($1), ($2)', [A, B]);
const snap = (o = {}) => ({ user_id: A, environment: 'live', store: 'app_store', product_id: 'restpilot_monthly', plan: 'monthly', period_type: 'normal',
  expires_at: '2026-12-14T00:00:00Z', grace_expires_at: null, will_renew: true, billing_issue: false,
  management_url: 'https://apps.apple.com/account/subscriptions', snapshot_at: '2026-11-14T12:00:00Z', ...o });
const apply = async (s) => (await db.query('select public.apply_store_entitlement($1::jsonb) as ok', [JSON.stringify(s)])).rows[0].ok;
const row = async (u = A, e = 'live') => (await db.query('select * from store_entitlements where user_id=$1 and environment=$2', [u, e])).rows[0];

assert.equal(await apply(snap()), true, 'first snapshot written');
assert.equal(await apply(snap({ will_renew: false, snapshot_at: '2026-11-14T13:00:00Z' })), true, 'newer snapshot written');
assert.equal(await apply(snap({ will_renew: true, snapshot_at: '2026-11-14T12:30:00Z' })), false, 'older snapshot refused');
assert.equal((await row()).will_renew, false, 'stale replay cannot resurrect renewal');
assert.equal(await apply(snap({ will_renew: false, snapshot_at: '2026-11-14T13:00:00Z' })), true, 'identical replay is idempotent');
assert.equal(await apply(snap({ environment: 'sandbox', snapshot_at: '2026-11-01T00:00:00Z' })), true, 'environments are independent rows');
assert.equal(await apply(snap({ user_id: GONE })), false, 'deleted account acknowledged, nothing written');
assert.equal((await db.query('select count(*)::int as n from store_entitlements')).rows[0].n, 2);
for (const bad of [snap({ environment: 'prod' }), snap({ user_id: 'not-a-uuid' }), snap({ snapshot_at: null }), snap({ plan: 'lifetime' }),
  snap({ management_url: 'https://evil.example/' }), snap({ store: 'play_store' }), snap({ expires_at: 'garbage' })]) {
  await assert.rejects(apply(bad), undefined, JSON.stringify(bad));
}
// Concurrent deliveries: whatever the interleaving, the newest snapshot wins.
const times = Array.from({ length: 20 }, (_, i) => new Date(Date.parse('2026-11-15T00:00:00Z') + i * 1000).toISOString());
await Promise.all(times.sort(() => Math.random() - 0.5).map((t) => apply(snap({ user_id: B, snapshot_at: t }))));
assert.equal(new Date((await row(B)).snapshot_at).toISOString(), times.sort().at(-1));

// Privileges: clients can read only their own row and cannot write or call the function.
await db.exec(`set test.uid = '${A}'`);
await db.exec('set role authenticated');
assert.deepEqual((await db.query('select user_id from store_entitlements order by environment')).rows.map((r) => r.user_id), [A, A]);
for (const sql of [`select public.apply_store_entitlement('${JSON.stringify(snap())}'::jsonb)`,
  `insert into store_entitlements(user_id, environment, snapshot_at) values ('${A}', 'live', now())`,
  `update store_entitlements set will_renew = true`, `delete from store_entitlements`,
  'select * from store_webhook_events', `insert into store_webhook_events(event_id) values ('x')`]) {
  const result = await db.query(sql).then((r) => r, (e) => e);
  assert.ok(result instanceof Error ? /permission denied/.test(result.message) : result.affectedRows === 0, sql);
}
await db.exec('reset role');
await db.exec('set role anon');
for (const sql of ['select * from store_entitlements', `select public.apply_store_entitlement('{}'::jsonb)`]) await assert.rejects(db.query(sql), /permission denied/, sql);
await db.exec('reset role');
// Account deletion cascades.
await db.query('delete from auth.users where id = $1', [A]);
assert.equal((await db.query('select count(*)::int as n from store_entitlements where user_id=$1', [A])).rows[0].n, 0);
console.log('store_entitlements migration checks passed');
