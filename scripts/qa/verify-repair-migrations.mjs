// Run with RESTPILOT_PGLITE_MODULE pointing to an installed @electric-sql/pglite module.
// Uses an isolated in-memory PostgreSQL engine; never connects to production.
import assert from 'node:assert/strict';
import fs from 'node:fs';
const {PGlite}=await import(process.env.RESTPILOT_PGLITE_MODULE || '@electric-sql/pglite');
const db=new PGlite();
await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
create schema auth; create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql as 'select null::uuid';
create function public.set_updated_at() returns trigger language plpgsql as $$begin new.updated_at=now();return new;end;$$;`);
for(const path of [
 '20260626222351_6ee9b465-a4e1-4d6d-8755-4fb200212e6c.sql',
 '20260706024628_c8debd36-0464-450e-ad91-ccc6da89c4d9.sql',
 '20261113090000_ai_request_admission.sql',
 '20261113100000_trial_voice_atomic.sql',
 '20261113110000_subscription_sync.sql',
])await db.exec(fs.readFileSync(new URL('../../supabase/migrations/'+path,import.meta.url),'utf8'));
const user='11111111-1111-4111-8111-111111111111';
await db.query('insert into auth.users values ($1)',[user]);
const snapshot={user_id:user,stripe_subscription_id:'sub_test',stripe_customer_id:'cus_test',product_id:'prod_test',price_id:'restpilot_monthly',environment:'sandbox',status:'active',current_period_start:'2026-11-01T00:00:00Z',current_period_end:'2026-12-01T00:00:00Z',cancel_at_period_end:false};
const apply=async(row,rev)=>(await db.query('select public.apply_subscription_snapshot($1::jsonb,$2) as applied',[JSON.stringify(row),rev])).rows[0].applied;
assert.equal(await apply(snapshot,0),true);
assert.equal(await apply({...snapshot,status:'canceled'},1),true);
assert.equal(await apply(snapshot,1),false,'stale snapshot must retry, not resurrect');
assert.equal((await db.query('select status from subscriptions')).rows[0].status,'canceled');
await assert.rejects(apply(snapshot,2),/cannot reactivate/);
await assert.rejects(apply({...snapshot,environment:'live'},0),/ownership mismatch/);
await assert.rejects(apply({...snapshot,user_id:'22222222-2222-4222-8222-222222222222'},2),/ownership mismatch/);
assert.equal(await apply({...snapshot,stripe_subscription_id:'sub_deleted_first',status:'canceled'},0),true,'deletion before create must persist');
const increments=await Promise.all(Array.from({length:40},()=>db.query('select increment_trial_voice_usage($1,$2,$3) as used',[user,'sandbox',30])));
assert.equal(Math.max(...increments.map(r=>r.rows[0].used)),1200);
assert.equal((await db.query('select voice_seconds_used from trial_usage')).rows[0].voice_seconds_used,1200,'overlapping heartbeats must accumulate');
await db.query('select increment_trial_voice_usage($1,$2,$3)',[user,'sandbox',3600]);
assert.equal((await db.query('select voice_seconds_used from trial_usage')).rows[0].voice_seconds_used,3600);
await assert.rejects(db.query('select increment_trial_voice_usage($1,$2,$3)',[user,'sandbox',-1]),/invalid/);
const admissions=await Promise.all(Array.from({length:31},()=>db.query('select consume_ai_request($1) as result',[user])));
assert.equal(admissions.filter(r=>r.rows[0].result.allowed).length,30);
for(const role of ['anon','authenticated']) {
 await db.exec('set role '+role);
 for(const sql of ["select consume_ai_request('"+user+"')","select increment_trial_voice_usage('"+user+"','sandbox',1)","select apply_subscription_snapshot('{}',0)",'select * from subscription_sync_state','select * from ai_request_allowance']) await assert.rejects(db.query(sql),/permission denied/);
 await db.exec('reset role');
}
await db.exec('set role service_role');
assert.equal((await db.query('select count(*)::int as n from subscription_sync_state')).rows[0].n,2);
await db.exec('reset role');
await db.close();
console.log('PASS: actual migration execution, stale-write rejection, cancellation tombstone, ownership/environment checks, deletion-before-create, 40 overlapping usage increments, cap, 31-request admission burst, and anon/authenticated privilege denial.');
