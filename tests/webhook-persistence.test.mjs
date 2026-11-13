import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
import test from 'node:test';

// Exercise the actual POST handler, replacing only signature/provider/database IO.
const source=stripTypeScriptTypes(readFileSync(new URL('../src/routes/api/public/payments/webhook.ts',import.meta.url),'utf8'))
  .replace(/^import[\s\S]*?;\n/gm,'').replaceAll('export const ','const ');
const subscription={id:'sub_test',customer:'cus_test',metadata:{userId:'user-test'},status:'active',items:{data:[{price:{id:'price_test',lookup_key:'restpilot_monthly',product:'prod_test'},current_period_start:1700000000,current_period_end:1702600000}]}};
const purchase={id:'cs_test',mode:'payment',payment_status:'paid',customer:'cus_test',metadata:{userId:'user-test'},customer_details:{email:'test@example.test'}};
function fixture(options={}) {
  const calls=[],rows=new Map();let fail=options.fail??false;
  const db={
    auth:{admin:{async getUserById(){return {data:{user:{email:'test@example.test'}}};}}},
    from(table){assert.equal(table,'subscriptions');return {
      async upsert(row,config){calls.push('db:upsert');assert.equal(config.onConflict,'stripe_subscription_id');if(fail)return {error:{message:'private db details'}};rows.set(row.stripe_subscription_id,row);return {error:null};},
      update(patch){const filters={};const q={eq(k,v){filters[k]=v;return q;},async select(columns){calls.push('db:update');assert.equal(columns,'id');assert.equal(filters.stripe_subscription_id,'sub_test');assert.equal(filters.environment,'sandbox');assert.equal(patch.status,'canceled');return {data:options.noMatch?[]:[{id:'row_test'}],error:fail?{message:'private db details'}:null};}};return q;},
    };},
  };
  const context=vm.createContext({URL,Request,Response,process:{env:{}},console:{error(){},log(){}},createFileRoute:()=>x=>x,createClient:()=>db,
    verifyWebhook:async()=>{calls.push('verify');if(options.badSignature)throw new Error('Invalid signature');return options.event;},
    createStripeClient:environment=>{assert.equal(environment,'sandbox');return {checkout:{sessions:{async listLineItems(){calls.push('stripe:line-items');return {data:options.lineItems??[{price:{id:'price_lifetime',lookup_key:'restpilot_lifetime',product:'prod_lifetime'}}]};}}}};},
    webhookSecretFingerprint:async()=>'test-fingerprint',
    sendTransactionalEmailServer:async data=>{calls.push(`email:${data.templateName}`);return {success:true};},
    notifyOwner:async()=>{calls.push('alert');if(options.alertFail)throw new Error('alert unavailable');},
  });
  const route=vm.runInContext(`${source}\nRoute`,context);
  return {calls,rows,setFail(value){fail=value;},post:(query='?env=sandbox')=>route.server.handlers.POST({request:new Request(`https://restpilotai.com/api/public/payments/webhook${query}`,{method:'POST',body:'{}'})})};
}
for(const type of ['customer.subscription.created','customer.subscription.updated','customer.subscription.deleted','checkout.session.completed','checkout.session.async_payment_succeeded']) {
  test(`${type} failed database write returns 500 without confirmation email`,async()=>{
    const f=fixture({fail:true,event:{type,data:{object:type.startsWith('checkout')?purchase:subscription}}});
    const response=await f.post();assert.equal(response.status,500);assert.equal(await response.text(),'Webhook error');assert.ok(!f.calls.some(c=>c.startsWith('email:')));assert.ok(f.calls.includes('alert'));
  });
  test(`${type} successful persistence returns 200`,async()=>{
    const f=fixture({event:{type,data:{object:type.startsWith('checkout')?purchase:subscription}}});assert.equal((await f.post()).status,200);assert.ok(f.calls.some(c=>c.startsWith('db:')));
    if(type!=='customer.subscription.updated')assert.ok(f.calls.findIndex(c=>c.startsWith('db:'))<f.calls.findIndex(c=>c.startsWith('email:')));
  });
}
test('cancellation with no matching row requests retry',async()=>{const f=fixture({noMatch:true,event:{type:'customer.subscription.deleted',data:{object:subscription}}});assert.equal((await f.post()).status,500);assert.ok(!f.calls.some(c=>c.startsWith('email:')));});
test('invalid signature stays 400 and never touches database',async()=>{const f=fixture({badSignature:true});assert.equal((await f.post()).status,400);assert.ok(!f.calls.some(c=>c.startsWith('db:')));});
test('alert failure cannot hide retryable persistence error',async()=>{const f=fixture({fail:true,alertFail:true,event:{type:'customer.subscription.updated',data:{object:subscription}}});assert.equal((await f.post()).status,500);});
for(const [type,object,key] of [['customer.subscription.created',subscription,'sub_test'],['checkout.session.completed',purchase,'lifetime_cs_test']]) {
  test(`${type} retry succeeds after database recovery and duplicate delivery reuses row key`,async()=>{
    const f=fixture({fail:true,event:{type,data:{object}}});assert.equal((await f.post()).status,500);assert.equal(f.rows.size,0);
    f.setFail(false);assert.equal((await f.post()).status,200);assert.equal((await f.post()).status,200);assert.equal(f.rows.size,1);assert.equal(f.rows.get(key).user_id,'user-test');
  });
}
test('unhandled signed event acknowledges without database writes',async()=>{const f=fixture({event:{type:'ping',data:{object:{}}}});assert.equal((await f.post()).status,200);assert.ok(!f.calls.some(c=>c.startsWith('db:')));});

for(const payment_status of ['unpaid','no_payment_required',undefined]) test(`completed ${payment_status} checkout grants no lifetime or receipt`,async()=>{
  const f=fixture({event:{type:'checkout.session.completed',data:{object:{...purchase,payment_status}}}});
  assert.equal((await f.post()).status,payment_status==='unpaid'?200:500);assert.equal(f.rows.size,0);assert.ok(!f.calls.some(c=>c.startsWith('email:')||c==='stripe:line-items'));
});
test('delayed success grants lifetime only after paid confirmation',async()=>{
  const f=fixture({event:{type:'checkout.session.async_payment_succeeded',data:{object:purchase}}});assert.equal((await f.post()).status,200);assert.equal(f.rows.get('lifetime_cs_test').status,'lifetime');assert.ok(f.calls.includes('email:payment-receipt'));
});
test('inconsistent async success requests retry without entitlement',async()=>{
  const f=fixture({event:{type:'checkout.session.async_payment_succeeded',data:{object:{...purchase,payment_status:'unpaid'}}}});assert.equal((await f.post()).status,500);assert.equal(f.rows.size,0);assert.ok(!f.calls.some(c=>c.startsWith('email:')));
});
for(const type of ['customer.subscription.created','customer.subscription.updated','checkout.session.completed','checkout.session.async_payment_succeeded']) test(`${type} missing user metadata is not silently acknowledged`,async()=>{
  const object=type.startsWith('checkout')?purchase:subscription;
  const f=fixture({event:{type,data:{object:{...object,metadata:{}}}}});assert.equal((await f.post()).status,500);assert.equal(f.rows.size,0);assert.ok(!f.calls.some(c=>c.startsWith('email:')));
});
test('paid checkout with missing line item requests retry',async()=>{const f=fixture({lineItems:[],event:{type:'checkout.session.completed',data:{object:purchase}}});assert.equal((await f.post()).status,500);assert.equal(f.rows.size,0);});
test('unrelated paid one-time product cannot grant lifetime',async()=>{const f=fixture({lineItems:[{price:{lookup_key:'other_product'}}],event:{type:'checkout.session.completed',data:{object:purchase}}});assert.equal((await f.post()).status,500);assert.equal(f.rows.size,0);});
test('subscription checkout completion never creates lifetime entitlement',async()=>{const f=fixture({event:{type:'checkout.session.completed',data:{object:{...purchase,mode:'subscription'}}}});assert.equal((await f.post()).status,200);assert.equal(f.rows.size,0);assert.ok(!f.calls.includes('stripe:line-items'));});
test('no-payment-required subscription trial sends no paid receipt',async()=>{const f=fixture({event:{type:'checkout.session.completed',data:{object:{...purchase,mode:'subscription',payment_status:'no_payment_required'}}}});assert.equal((await f.post()).status,200);assert.equal(f.rows.size,0);assert.ok(!f.calls.some(c=>c.startsWith('email:')));});
for(const query of ['', '?env=bogus','?env=LIVE']) test(`invalid environment ${query} returns400 before verification and persistence`,async()=>{const f=fixture();assert.equal((await f.post(query)).status,400);assert.ok(!f.calls.includes('verify'));assert.ok(!f.calls.some(c=>c.startsWith('db:')));});
