import assert from 'node:assert/strict';
import {test} from 'node:test';
import fs from 'node:fs';
import ts from 'typescript';
import vm from 'node:vm';
function load(path,mocks={},env={},fetchOverride){
 const js=ts.transpileModule(fs.readFileSync(new URL('../'+path,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const module={exports:{}};
 vm.runInNewContext(js,{module,exports:module.exports,require:n=>{if(n in mocks)return mocks[n];throw new Error('Unexpected dependency '+n)},process:{env},console,Response,AbortSignal,fetch:fetchOverride??(()=>{throw new Error('Unexpected provider call')})});return module.exports;
}
const access=env=>load('src/lib/realtime/access.server.ts',{},env);
for(const env of [{},{PAYMENTS_ENVIRONMENT:'bogus'},{PAYMENTS_ENVIRONMENT:'live',VITE_PAYMENTS_CLIENT_TOKEN:'pk_test_example'}])test('missing/conflicting deployment environment denies voice '+JSON.stringify(env),()=>{
 assert.throws(()=>access(env).realtimeEnvironment('sandbox'),/environment/);
});
test('browser cannot switch production entitlement checks to sandbox',()=>{
 const a=access({PAYMENTS_ENVIRONMENT:'live'});assert.equal(a.realtimeEnvironment(),'live');assert.throws(()=>a.realtimeEnvironment('sandbox'),/Invalid/);
});
const a=access({PAYMENTS_ENVIRONMENT:'sandbox'});
const valid={status:'active',current_period_end:'2099-01-01T00:00:00Z'};
for(const rows of [[],[{...valid,status:'unpaid'}],[{...valid,current_period_end:null}],[{...valid,current_period_end:'bad'}],[{...valid,current_period_end:'2000-01-01'}]])test('no valid subscription cannot become unlimited voice '+JSON.stringify(rows),()=>assert.throws(()=>a.voiceEntitlement(rows),/active subscription/));
test('paid entitlement survives a newer failed checkout row',()=>assert.equal(a.voiceEntitlement([{...valid,status:'incomplete'},valid]),'paid'));
test('trial and lifetime distinguish metered access',()=>{
 assert.equal(a.voiceEntitlement([{...valid,status:'trialing'}]),'trial');assert.equal(a.voiceEntitlement([{status:'lifetime',current_period_end:null}]),'paid');
});
function serverFn(){return {middleware(){return this},inputValidator(fn){this.validate=fn;return this},handler(fn){const validate=this.validate;return args=>fn({...args,data:validate(args.data)});}};}
function usage({rows=[valid],readError=null,used=10,usageError=null,rpcError=null}={}){
 let writes=0;
 const db={from(table){const q={select(){return q},eq(){return q},then(resolve){return Promise.resolve(resolve({data:rows,error:readError}))},async maybeSingle(){return {data:{voice_seconds_used:used},error:usageError}}};return q;},async rpc(){writes++;return {data:40,error:rpcError}}};
 const api=load('src/lib/realtime/trial-usage.functions.ts',{
 '@tanstack/react-start':{createServerFn:serverFn},'@/integrations/supabase/auth-middleware':{},'./access.server':a,
 '@/lib/trial-limits':{TRIAL_VOICE_SECONDS_CAP:3600},'@/integrations/supabase/client.server':{supabaseAdmin:db}});
 return {...api,writes:()=>writes};
}
test('subscription backend errors do not become paid passthrough',async()=>await assert.rejects(usage({readError:{}}).loadTrialUsageState('user','sandbox'),/unavailable/));
test('trial usage backend failure prevents a new session',async()=>await assert.rejects(usage({rows:[{...valid,status:'trialing'}],usageError:{}}).loadTrialUsageState('user','sandbox'),/unavailable/));
test('exhausted trial reports a hard admission stop',async()=>assert.equal((await usage({rows:[{...valid,status:'trialing'}],used:3600}).loadTrialUsageState('user','sandbox')).limitReached,true));
test('failed atomic heartbeat never reports successful accounting',async()=>await assert.rejects(usage({rows:[{...valid,status:'trialing'}],rpcError:{}}).recordTrialVoiceUsage({data:{seconds:30,environment:'sandbox'},context:{userId:'user'}}),/could not be recorded/));
for(const seconds of [-1,NaN,'30',3601,1.5])test('invalid heartbeat duration rejected '+seconds,async()=>{
 const u=usage();await assert.rejects(async()=>u.recordTrialVoiceUsage({data:{seconds,environment:'sandbox'},context:{userId:'user'}}),/Invalid/);assert.equal(u.writes(),0);
});

test('existing cancellation grace period remains available until paid-through date',()=>assert.equal(a.voiceEntitlement([{...valid,status:'canceled'}]),'paid'));

const betaId='00000000-0000-4000-8000-000000000001';
test('private beta requires an owner-selected authenticated account and fixed sandbox accounting',()=>{
 const b=access({PRIVATE_BETA_USER_IDS:betaId});
 assert.equal(b.realtimeEnvironment(),'sandbox');assert.equal(b.privateBetaAccess(betaId),true);
 assert.throws(()=>b.privateBetaAccess('00000000-0000-4000-8000-000000000002'),/not enrolled/);
 assert.throws(()=>b.realtimeEnvironment('live'),/Invalid/);
 assert.throws(()=>access({PRIVATE_BETA_USER_IDS:'*'}).privateBetaAccess(betaId),/not configured correctly/);
 assert.equal(access({}).privateBetaAccess(betaId),false);
});
