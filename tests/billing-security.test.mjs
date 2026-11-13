import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
import test from 'node:test';

// Run the checked-in validators and handlers; replace framework and provider IO.
const source = stripTypeScriptTypes(readFileSync(new URL('../src/lib/billing.functions.ts', import.meta.url), 'utf8'))
  .replace(/^import[\s\S]*?;\n/gm, '').replaceAll('export const ', 'const ');
function fixture(options = {}) {
  const calls = [];
  let checkoutPayload, portalPayload;
  const stripe = {
    customers: {
      async search({ query }) { calls.push('customer:search'); assert.equal(query, "metadata['userId']:'user-test'"); return {data: options.found ?? []}; },
      async list() { throw new Error('Email lookup must never be called'); },
      async update() { throw new Error('Customer ownership must never be reassigned'); },
      async create(data) { calls.push('customer:create'); assert.equal(data.metadata.userId, 'user-test'); assert.equal(data.email, 'shared@example.test'); return {id:'cus_new'}; },
      async retrieve(id) { calls.push('customer:retrieve'); assert.equal(id,'cus_owned'); return options.portalCustomer ?? {id,metadata:{userId:'user-test'}}; },
    },
    prices: { async list({lookup_keys,active}) {
      calls.push('price:list'); assert.equal(active,true);
      const key = lookup_keys[0];
      return {data:[{id:'price_test',lookup_key:key,active:true,type:key==='restpilot_lifetime'?'one_time':'recurring',product:'prod_test',recurring:{interval:key==='restpilot_monthly'?'month':'year',interval_count:1},...options.price}]};
    } },
    products: { async retrieve() {return {name:'Lifetime'};} },
    checkout: { sessions: { async create(payload) { calls.push('checkout:create'); checkoutPayload=payload; return {client_secret:'test_secret'}; } } },
    billingPortal: { sessions: { async create(payload) {calls.push('portal:create');portalPayload=payload;return {url:'https://billing.stripe.com/test'};} } },
  };
  const supabase = {
    auth: {async getUser(){return {data:{user:{email:'shared@example.test'}}};}},
    from(table) {
      assert.equal(table,'subscriptions');
      const q={select(){return q;},eq(k,v){calls.push(`db:${k}:${v}`);return q;},order(){return q;},limit(){return q;},async maybeSingle(){return {data:options.noSub?null:{stripe_customer_id:'cus_owned'},error:options.lookupError?{}:null};}};
      return q;
    },
  };
  function createServerFn() {
    let validator;
    const builder={middleware(){return builder;},inputValidator(fn){validator=fn;return builder;},handler(fn){return async args=>fn({...args,data:validator(args.data)});}};
    return builder;
  }
  const context=vm.createContext({URL,process:{env:options.env??{NODE_ENV:'production'}},createServerFn,requireSupabaseAuth:{},createStripeClient(environment){calls.push(`stripe:${environment}`);return stripe;},getStripeErrorMessage:e=>e.message});
  const handlers=vm.runInContext(`${source}\n({createCheckoutSession,createPortalSession})`,context);
  return {calls,get checkoutPayload(){return checkoutPayload;},get portalPayload(){return portalPayload;},
    checkout:(data={})=>handlers.createCheckoutSession({context:{supabase,userId:'user-test'},data:{priceId:'restpilot_monthly',environment:'sandbox',returnUrl:'https://restpilotai.com/profile?session_id={CHECKOUT_SESSION_ID}',...data}}),
    portal:(data={})=>handlers.createPortalSession({context:{supabase,userId:'user-test'},data:{environment:'sandbox',returnUrl:'https://restpilotai.com/profile',...data}})};
}

test('matching email cannot adopt another user customer; creates owned customer',async()=>{
  const f=fixture(); assert.equal((await f.checkout()).clientSecret,'test_secret'); assert.equal(f.checkoutPayload.customer,'cus_new'); assert.ok(f.calls.includes('customer:create'));
});
test('owned metadata match is reused without creating customer',async()=>{
  const f=fixture({found:[{id:'cus_owned',metadata:{userId:'user-test'}}]}); await f.checkout();assert.equal(f.checkoutPayload.customer,'cus_owned'); assert.ok(!f.calls.includes('customer:create'));
});
test('unexpected foreign metadata from customer search fails closed',async()=>{
  const f=fixture({found:[{id:'cus_foreign',metadata:{userId:'other-user'}}]});assert.match((await f.checkout()).error,/ownership/);assert.ok(!f.calls.includes('checkout:create'));
});
for(const environment of [undefined,null,'LIVE','test','',{},'sandbox ']) test(`reject invalid environment ${JSON.stringify(environment)} before Stripe`,async()=>{
  const f=fixture();await assert.rejects(f.checkout({environment}),/environment/);await assert.rejects(f.portal({environment}),/environment/);assert.equal(f.calls.length,0);
});
for(const priceId of ['arbitrary_price','price_real','restpilot_monthly ',null,{}]) test(`reject non-catalog price ${JSON.stringify(priceId)}`,async()=>{
  const f=fixture();await assert.rejects(f.checkout({priceId}),/priceId/);assert.equal(f.calls.length,0);
});
for(const returnUrl of ['https://evil.example/profile','https://restpilotai.com.evil.example/profile','https://restpilotai.com@evil.example/profile','https://evil:secret@restpilotai.com/profile','javascript:alert(1)','//restpilotai.com/profile','http://restpilotai.com/profile','http://localhost:3400/profile',null,{}]) test(`reject unsafe production return URL ${JSON.stringify(returnUrl)}`,async()=>{
  const f=fixture();await assert.rejects(f.checkout({returnUrl}),/return URL/);await assert.rejects(f.portal({returnUrl}),/return URL/);assert.equal(f.calls.length,0);
});
test('canonical return URL preserves Stripe session placeholder',async()=>{const f=fixture();await f.checkout();assert.equal(f.checkoutPayload.return_url,'https://restpilotai.com/profile?session_id={CHECKOUT_SESSION_ID}');});
test('explicit HTTPS PUBLIC_APP_URL allows deployment host',async()=>{const f=fixture({env:{NODE_ENV:'production',PUBLIC_APP_URL:'https://preview.example'}});assert.equal((await f.checkout({returnUrl:'https://preview.example/profile'})).clientSecret,'test_secret');});
test('sandbox allows local development but live does not',async()=>{const f=fixture({env:{NODE_ENV:'development'}});assert.equal((await f.checkout({returnUrl:'http://localhost:3400/profile'})).clientSecret,'test_secret');await assert.rejects(f.checkout({environment:'live',returnUrl:'http://localhost:3400/profile'}),/origin/);});
for(const price of [{active:false},{lookup_key:'other'},{type:'one_time'},{recurring:{interval:'year',interval_count:1}},{recurring:{interval:'month',interval_count:2}}]) test(`reject mismatched Stripe price ${JSON.stringify(price)}`,async()=>{const f=fixture({price});assert.ok((await f.checkout()).error);assert.ok(!f.calls.includes('checkout:create'));});
test('lifetime must remain one-time and has no trial',async()=>{const f=fixture();await f.checkout({priceId:'restpilot_lifetime'});assert.equal(f.checkoutPayload.mode,'payment');assert.equal(f.checkoutPayload.subscription_data,undefined);const broken=fixture({price:{type:'recurring'}});assert.ok((await broken.checkout({priceId:'restpilot_lifetime'})).error);assert.ok(!broken.calls.includes('checkout:create'));});
test('portal verifies both account-scoped mapping and Stripe metadata',async()=>{const f=fixture();assert.equal((await f.portal()).url,'https://billing.stripe.com/test');assert.ok(f.calls.includes('db:user_id:user-test'));assert.ok(f.calls.includes('db:environment:sandbox'));assert.equal(f.portalPayload.customer,'cus_owned');});
for(const portalCustomer of [{id:'cus_owned',metadata:{userId:'other-user'}},{id:'cus_owned',metadata:{}},{id:'cus_owned',deleted:true}]) test(`portal rejects foreign, unowned or deleted customer ${JSON.stringify(portalCustomer)}`,async()=>{const f=fixture({portalCustomer});assert.ok((await f.portal()).error);assert.ok(!f.calls.includes('portal:create'));});
test('portal lookup failure creates no Stripe session',async()=>{const f=fixture({lookupError:true});assert.ok((await f.portal()).error);assert.ok(!f.calls.includes('portal:create'));});
test('portal with no mapping does not invent a customer',async()=>{const f=fixture({noSub:true});assert.ok((await f.portal()).error);assert.ok(!f.calls.includes('portal:create'));});

for (const priceId of ['restpilot_monthly','restpilot_annual']) test(`${priceId} preserves advertised 14-day trial`,async()=>{const f=fixture();await f.checkout({priceId});assert.equal(f.checkoutPayload.subscription_data.trial_period_days,14);});
