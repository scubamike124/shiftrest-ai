import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {injectManifest} from 'workbox-build';
const worker='dist/sw-src.js';
assert.ok(fs.existsSync(worker),'Compiled service worker is missing');
assert.ok(fs.existsSync('.output/server/index.mjs'),'Node server entry is missing');
for(const p of ['.output/public/sw-src.ts','.output/public/sw-src.js'])fs.rmSync(p,{force:true});
const revision=createHash('sha256').update(fs.readFileSync(worker)).digest('hex');
const {count,warnings}=await injectManifest({
  swSrc:worker,swDest:'.output/public/sw.js',globDirectory:'.output/public',
  globPatterns:['**/*.{js,css,html,svg,png,ico,woff,woff2,webmanifest}'],
  globIgnores:['**/sw-src.*','**/sw.js','**/*.map','**/*.ts'],
  maximumFileSizeToCacheInBytes:5*1024*1024,
  additionalManifestEntries:[{url:'/',revision}],
});
assert.ok(count>1,'Service worker precache is missing static assets');
assert.match(fs.readFileSync('.output/public/sw.js','utf8'),/assets\//,'Client bundles absent from precache');
if(warnings.length)throw new Error(warnings.join('\n'));
console.log(`Verified Node entry and service worker with ${count} precache entries.`);
