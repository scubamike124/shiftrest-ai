import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
import test from 'node:test';

// Exercise the actual server handlers, replacing only framework/dependency IO.
const source = stripTypeScriptTypes(readFileSync(new URL('../src/lib/account.functions.ts', import.meta.url), 'utf8'))
  .replace(/^import .*;\n/gm, '')
  .replaceAll('export const ', 'const ')
  .replace(/import\(("[^"]+")\)/g, 'deps.load($1)');
function fixture(options = {}) {
  const calls = [];
  const subs = options.subs ?? [{ stripe_subscription_id: 'sub_test', environment: 'sandbox', status: 'active' }];
  const admin = {
    from(table) {
      return {
        select() { if(options.exportRows) return { eq(column,uid) {
          assert.equal(column,table==='profiles'?'id':'user_id'); assert.equal(uid,'user-test');
          return { order(column) {
            assert.equal(column, table==='user_prefs'||table==='notification_prefs'?'user_id':table==='companion_skills'?'skill':'id');
            return { async range(from,to) {
              calls.push(`export:${table}:${from}`);
              if(options.exportFailTable===table && from>=500) return {data:null,error:{message:'secret SQL'}};
              return {data:(options.exportRows[table]??[]).slice(from,Math.min(to+1,from+(options.serverCap??500))),error:null};
            } };
          } };
        } }; return { async eq() { calls.push(`read:${table}`); return { data: subs, error: options.lookupFail ? { message: 'private db failure' } : null }; } }; },
        update(value) { return { async eq() { calls.push('save:cancellation'); assert.equal(value.cancel_at_period_end, false); return { error: options.updateFail ? { message: 'db failure' } : null }; } }; },
        delete() { return { async eq(column, uid) { assert.equal(column, table === 'profiles' ? 'id' : 'user_id'); assert.equal(uid, 'user-test'); calls.push(`delete:${table}`); return { error: options.failTable === table ? { message: 'private SQL details' } : null }; } }; },
      };
    },
    auth: { admin: {
      async getUserById() { return { data: { user: options.exportRows ? {email:'test@example.invalid'} : {} } }; },
      async deleteUser() { calls.push('delete:identity'); return { error: options.authFail ? { message: 'secret auth failure' } : null }; },
    } },
  };
  const deps = { async load(path) {
    if (path.includes('client.server')) return { supabaseAdmin: admin };
    if (path.includes('stripe.server')) return { createStripeClient(environment) {
      assert.equal(environment, 'sandbox');
      return { subscriptions: {
        async retrieve() { calls.push('stripe:retrieve'); return { status: options.alreadyCanceled ? 'canceled' : 'active' }; },
        async cancel() { calls.push('stripe:cancel'); if (options.cancelFail) throw new Error('private provider failure'); return { status: options.unconfirmed ? 'active' : 'canceled' }; },
      } };
    } };
    if (path.includes('email/send.server')) return { async sendTransactionalEmailServer() { calls.push('email:ready'); } };
    if (path.includes('alert.server')) return { async notifyOwner() {} };
    throw new Error(`Unexpected dependency: ${path}`);
  } };
  const context = vm.createContext({ deps, console: { error() {} }, createServerFn: () => ({ middleware: () => ({ handler: (fn) => fn }) }), requireSupabaseAuth: {} });
  const handlers = vm.runInContext(`${source}\n({deleteAccountFn, purgeAiMemoryFn, exportAccountFn})`, context);
  return { calls, export: () => handlers.exportAccountFn({context:{userId:'user-test'}}), remove: () => handlers.deleteAccountFn({context:{userId:'user-test'}}), purge: () => handlers.purgeAiMemoryFn({context:{userId:'user-test'}}) };
}
for (const [name, options] of Object.entries({ lookup: {lookupFail:true}, cancellation:{cancelFail:true}, unconfirmed:{unconfirmed:true}, reconciliation:{updateFail:true}, invalidEnvironment:{subs:[{stripe_subscription_id:'sub_test',environment:null,status:'active'}]}, missingId:{subs:[{environment:'sandbox',status:'active'}]} })) {
  test(`${name} failure preserves identity and personal data`, async () => {
    const f=fixture(options); await assert.rejects(f.remove()); assert.equal(f.calls.some(c=>c.startsWith('delete:')),false);
  });
}
test('table failure preserves sign-in and reports incomplete deletion', async () => {
  const f=fixture({failTable:'ai_memory'}); await assert.rejects(f.remove(), /incomplete/); assert.equal(f.calls.includes('delete:identity'),false);
});
test('retry reconciles a previously canceled Stripe subscription', async () => {
  const f=fixture({alreadyCanceled:true}); const result=await f.remove(); assert.equal(result.ok,true); assert.equal(f.calls.includes('stripe:cancel'),false); assert.equal(f.calls.at(-1),'delete:identity');
});
test('successful deletion cancels billing before personal data and identity', async () => {
  const f=fixture(); assert.equal((await f.remove()).ok,true); assert.ok(f.calls.indexOf('save:cancellation')<f.calls.indexOf('delete:shifts')); assert.equal(f.calls.at(-1),'delete:identity');
});
test('account with no subscription may delete', async () => { const f=fixture({subs:[]}); assert.equal((await f.remove()).ok,true); });
test('auth deletion failure is truthful without leaking provider error', async () => {
  const f=fixture({authFail:true}); await assert.rejects(f.remove(), /couldn't finish deleting your sign-in/);
});
test('memory purge failure cannot report success', async () => { const f=fixture({failTable:'ai_memory'}); await assert.rejects(f.purge(), /could not be cleared/); });
test('successful memory purge reports five cleared tables', async () => { const f=fixture(); const r=await f.purge(); assert.equal(r.ok,true); assert.equal(r.cleared.length,5); });

test('one-time lifetime purchase does not call Stripe subscription API', async () => {
  const f=fixture({subs:[{stripe_subscription_id:'lifetime_cs_test_123',environment:'sandbox',status:'lifetime'}]});
  assert.equal((await f.remove()).ok,true); assert.equal(f.calls.some(c=>c.startsWith('stripe:')),false);
});
test('success does not claim cascade-deleted records were retained', async () => {
  const result=await fixture().remove(); assert.equal(result.retained.length,0); assert.ok(result.cascaded.includes('subscriptions'));
});
test('profile filter matches checked-in schema', () => {
  const migration=readFileSync(new URL('../supabase/migrations/20260601225645_edf4e0fa-be02-4b40-a757-bcd3f147c5f3.sql',import.meta.url),'utf8');
  assert.match(migration,/CREATE TABLE public\.profiles \(\s+id UUID NOT NULL PRIMARY KEY REFERENCES auth\.users\(id\) ON DELETE CASCADE/);
});

test('export reads more than 1000 rows with stable order and smaller server caps', async () => {
 const rows=Array.from({length:1201},(_,i)=>({id:String(i)}));
 const f=fixture({exportRows:{coach_messages:rows},serverCap:200}); const result=await f.export();
 assert.equal(result.data.coach_messages.length,1201); assert.equal(result.data.coach_messages.at(-1).id,'1200');
 assert.ok(f.calls.includes('export:coach_messages:1200')); assert.equal(f.calls.at(-1),'email:ready');
});
test('failed later export page reports failure without ready email', async () => {
 const f=fixture({exportRows:{coach_messages:Array.from({length:1201},(_,i)=>({id:String(i)}))},exportFailTable:'coach_messages'});
 await assert.rejects(f.export(),/No complete export/); assert.equal(f.calls.includes('email:ready'),false);
});
test('memory proposal purge failure cannot report fresh memory', async () => { await assert.rejects(fixture({failTable:'ai_memory_proposals'}).purge()); });
