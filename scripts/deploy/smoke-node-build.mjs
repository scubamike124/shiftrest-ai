import {spawn} from 'node:child_process';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const port='43433';
const child=spawn(process.execPath,['.output/server/index.mjs'],{env:{...process.env,PORT:port,HOST:'127.0.0.1'},stdio:['ignore','pipe','pipe']});
let logs='';
child.stdout.on('data',d=>logs+=d);child.stderr.on('data',d=>logs+=d);
const base=`http://127.0.0.1:${port}`;
try {
 let healthy=false;
 for(let i=0;i<60;i++){
  if(child.exitCode!==null)throw new Error('Production server exited before readiness');
  try{const r=await fetch(base+'/api/public/health');if(r.ok){healthy=true;break;}}catch{}
  await new Promise(r=>setTimeout(r,250));
 }
 assert.ok(healthy,'Production server did not become healthy');
 for(const path of ['/','/auth','/pricing','/paywall','/manifest.webmanifest','/sw.js']) {
  const r=await fetch(base+path);const body=await r.text();
  assert.equal(r.status,200,`${path}: expected HTTP 200`);
  assert.ok(body.length>0,`${path}: empty response`);
  if(path==='/paywall'||path==='/pricing'){assert.match(body,/White Glove test/);assert.doesNotMatch(body,/js\.stripe\.com|EmbeddedCheckout|Choose Monthly|Choose Annual/);}
  if(path==='/sw.js'){assert.doesNotMatch(body,/__WB_MANIFEST|reference lib="webworker"/);assert.match(body,/assets\//);}
  if(path==='/manifest.webmanifest'){assert.ok(JSON.parse(body).name);}
  if(['/', '/auth','/paywall'].includes(path)){assert.ok(r.headers.get('content-security-policy'));assert.doesNotMatch(body,/Something went wrong|Missing Supabase/);}
  console.log(`PASS ${path}`);
 }
 const assets=fs.readdirSync('.output/public/assets').filter(name=>/\.(js|css)$/.test(name));
 assert.ok(assets.length>0,'No client assets');
 for(const name of assets) {
  const r=await fetch(base+'/assets/'+name);
  assert.equal(r.status,200,`Missing production asset ${name}`);
  assert.doesNotMatch(r.headers.get('content-type')||'',/text\/html/,`HTML returned for asset ${name}`);
  await r.arrayBuffer();
 }
 console.log(`PASS ${assets.length} client JS/CSS assets`);
 const sw=fs.readFileSync('.output/public/sw.js','utf8');
 assert.match(sw,/assets\//,'Compiled assets absent from precache');
 console.log('Node production smoke passed; backend integrations were not exercised.');
} finally {child.kill('SIGTERM');}
