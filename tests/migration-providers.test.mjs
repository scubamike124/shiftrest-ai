import assert from 'node:assert/strict';
import {test} from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {Webhook} from 'standardwebhooks';
function load(file,{env={},mocks={},fetch:fetcher}={}) {
 const module={exports:{}};
 const js=ts.transpileModule(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 vm.runInNewContext(js,{exports:module.exports,module,process:{env},URL,Response,Request,Headers,TextDecoder,TextEncoder,AbortSignal,Buffer,fetch:fetcher??(()=>{throw new Error('Unexpected network call')}),require:name=>{if(name in mocks)return mocks[name];throw new Error('Unexpected import '+name)}});
 return module.exports;
}
const provider=env=>load('src/lib/ai/provider.server.ts',{env});
test('AI uses explicitly selected direct providers and models',()=>{
 const p=provider({AI_API_KEY:'chat-key',AI_BASE_URL:'https://chat.example.test/v1',AI_AUDIO_API_KEY:'audio-key',AI_AUDIO_BASE_URL:'https://voice.example.test/v1/',AI_TTS_MODEL:'tts-test'});
 assert.equal(p.aiApiKey(),'chat-key');assert.equal(p.aiApiKey(true),'audio-key');
 assert.equal(p.aiEndpoint('chat/completions'),'https://chat.example.test/v1/chat/completions');
 assert.equal(p.aiEndpoint('audio/speech'),'https://voice.example.test/v1/audio/speech');assert.equal(p.aiAudioModel('tts'),'tts-test');
 assert.throws(()=>p.aiAudioModel('stt'),/not configured/);
});
for(const endpoint of ['http://example.test/v1','https://key@example.test/v1','https://example.test/v1?key=secret','https://example.test/v1#x','https://ai.gateway.lovable.dev/v1'])test('reject unsafe or retired AI endpoint '+endpoint,()=>assert.throws(()=>provider({AI_BASE_URL:endpoint}).aiEndpoint('chat/completions')));
test('no silent provider choice without OpenAI configuration',()=>{
 assert.throws(()=>provider({AI_API_KEY:'key'}).aiEndpoint('chat/completions'),/not configured/);
 assert.equal(provider({OPENAI_API_KEY:'key'}).aiEndpoint('audio/speech'),'https://api.openai.com/v1/audio/speech');
});
const email={to:'tester@example.test',from:'RestPilot <mail@example.test>',subject:'Test',html:'<p>Test</p>',text:'Test',idempotency_key:'test-delivery'};
test('email retries preserve idempotency; credentials are only in auth header',async()=>{
 const calls=[];
 const p=load('src/lib/email/provider.server.ts',{fetch:async(url,options)=>{calls.push({url,options});return Response.json({id:'email-test'});}});
 for(let i=0;i<2;i++)await p.sendProviderEmail(email,{apiKey:'secret-test'});
 assert.equal(calls[0].url,'https://api.resend.com/emails');
 assert.equal(calls[0].options.headers['Idempotency-Key'],calls[1].options.headers['Idempotency-Key']);
 assert.equal(calls[0].options.headers.Authorization,'Bearer secret-test');assert.ok(!calls[0].options.body.includes('secret-test'));
});
test('email failures retain retry metadata without leaking provider body',async()=>{
 const p=load('src/lib/email/provider.server.ts',{fetch:async()=>new Response('private provider data',{status:429,headers:{'Retry-After':'120'}})});
 await assert.rejects(p.sendProviderEmail(email,{apiKey:'test'}),e=>e.status===429&&e.retryAfterSeconds===120&&!e.message.includes('private'));
});
test('secure email change uses both correct recipient and hash pairs',()=>{
 const {authDeliveries}=load('src/lib/email/auth-payload.server.ts');
 const d=authDeliveries({user:{email:'old@example.test',new_email:'new@example.test'},email_data:{email_action_type:'email_change',token:'old-otp',token_new:'new-otp',token_hash:'new-hash',token_hash_new:'old-hash'}});
 assert.equal(d.length,2);assert.equal(d[0].email,'old@example.test');assert.equal(d[0].hash,'old-hash');assert.equal(d[1].email,'new@example.test');assert.equal(d[1].hash,'new-hash');
});
const requestModule=load('src/lib/ai/request.server.ts');
const {verifyWebhookRequest}=load('src/lib/email/webhook.server.ts',{mocks:{standardwebhooks:{Webhook},'@/lib/ai/request.server':requestModule}});
const secret='whsec_'+Buffer.from('test-signing-secret-at-least-32-bytes').toString('base64');
function signedRequest({body='{"ok":true}',age=0,tamper=false}={}) {
 const date=new Date(Date.now()-age*1000),id='msg_test';
 const signature=new Webhook(secret).sign(id,date,body);
 return new Request('https://app.example.test/hook',{method:'POST',body:tamper?body+' ':body,headers:{'webhook-id':id,'webhook-timestamp':String(Math.floor(date.getTime()/1000)),'webhook-signature':signature}});
}
test('webhook validates original bytes and timestamp before parsing',async()=>{
 assert.equal((await verifyWebhookRequest({req:signedRequest(),secret:'v1,'+secret,parser:JSON.parse})).payload.ok,true);
 for(const req of [signedRequest({tamper:true}),signedRequest({age:601})])await assert.rejects(verifyWebhookRequest({req,secret,parser:()=>{throw new Error('Parser must not run')}}),/Invalid webhook signature/);
});
test('webhook refuses oversized body before parsing',async()=>await assert.rejects(verifyWebhookRequest({req:signedRequest({body:'x'.repeat(262145)}),secret,parser:JSON.parse}),/Invalid webhook body/));
test('native app build cannot create a Stripe client even with legacy keys present',()=>{
 let calls=0;
 const p=load('src/lib/stripe.server.ts',{env:{STRIPE_LIVE_SECRET_KEY:'sk_live_test'},mocks:{stripe:class {constructor(){calls++}}}});
 assert.throws(()=>p.createStripeClient('live'),/disabled/);assert.equal(calls,0);
});

test('transactional email retains working unsubscribe link and one-click headers',async()=>{
 let sent;
 const p=load('src/lib/email/provider.server.ts',{env:{PUBLIC_APP_URL:'https://app.example.test'},fetch:async(_url,options)=>{sent=JSON.parse(options.body);return Response.json({id:'email-test'});}});
 await p.sendProviderEmail({...email,unsubscribe_token:'test-token'},{apiKey:'test'});
 assert.equal(sent.headers['List-Unsubscribe'],'<https://app.example.test/email/unsubscribe?token=test-token>');
 assert.equal(sent.headers['List-Unsubscribe-Post'],'List-Unsubscribe=One-Click');
 assert.match(sent.html,/Unsubscribe/);assert.match(sent.text,/https:\/\/app.example.test\/email\/unsubscribe\?token=test-token/);
});
