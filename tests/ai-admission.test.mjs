import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

function load(path, mocks = {}, env = {}, fetchOverride) {
  const output = ts.transpileModule(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  mocks = {
    '@/lib/api/ratelimit.server': { enforceRateLimit: async () => null, RATE_LIMITS: {ai:{},tts:{},stt:{}} },
    '@/lib/api/lab-gate.server': { requireLabAccess: async () => null },
    ...mocks,
  };
  const noProvider = () => { throw new Error('Unexpected provider call'); };
  vm.runInNewContext(output, {
    exports: module.exports, module,
    require: name => {
      if (name in mocks) return mocks[name];
      throw new Error(`Unexpected dependency: ${name}`);
    },
    Response, Request, Headers, FormData, Blob, TextDecoder, URL,
    console, process: { env }, fetch: fetchOverride ?? noProvider,
  }, { filename: path });
  return module.exports;
}

const { checkAIAdmission, requireAIAdmission } = load('src/lib/ai/admission.server.ts', {
  '@supabase/supabase-js': { createClient: () => { throw new Error('Invalid config'); } },
});

test('admission accepts only verified budget and atomic allowance', async () => {
  const calls = [];
  const result = await checkAIAdmission({ rpc: async (name, args) => {
    calls.push([name, args]);
    return { data: name === 'has_ai_budget' ? true : { allowed: true, retry_after_seconds: 0 }, error: null };
  } }, 'user-a');
  assert.equal(result, null);
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [
    ['has_ai_budget', { _user_id: 'user-a' }], ['consume_ai_request', { _user_id: 'user-a' }],
  ]);
});

test('budget denial does not consume request allowance', async () => {
  let calls = 0;
  const result = await checkAIAdmission({ rpc: async () => { calls++; return { data: false, error: null }; } }, 'user-a');
  assert.equal(result.status, 429);
  assert.equal(calls, 1);
});

test('atomic limit denial returns retry time', async () => {
  const result = await checkAIAdmission({ rpc: async name => ({ data: name === 'has_ai_budget' ? true : { allowed: false, retry_after_seconds: 43 }, error: null }) }, 'user-a');
  assert.equal(result.status, 429);
  assert.equal(result.headers.get('Retry-After'), '43');
});

for (const [label, value] of [
  ['error', { data: true, error: { message: 'private database details' } }],
  ['null', { data: null, error: null }],
  ['string true', { data: 'true', error: null }],
]) test(`budget ${label} fails closed`, async () => {
  const result = await checkAIAdmission({ rpc: async () => value }, 'user-a');
  assert.equal(result.status, 503);
  assert.doesNotMatch(await result.text(), /private database/);
});
for (const value of [null, true, { allowed: 'true' }, { allowed: false }, { allowed: false, retry_after_seconds: NaN }]) {
  test(`malformed admission ${JSON.stringify(value)} fails closed`, async () => {
    const result = await checkAIAdmission({ rpc: async name => ({ data: name === 'has_ai_budget' ? true : value, error: null }) }, 'user-a');
    assert.equal(result.status, 503);
  });
}
test('RPC exception and missing configuration fail closed', async () => {
  assert.equal((await checkAIAdmission({ rpc: async () => { throw new Error('offline'); } }, 'user-a')).status, 503);
  assert.equal((await requireAIAdmission('user-a')).status, 503);
});

const requestModule = load('src/lib/ai/request.server.ts');

const routes = ['ai', 'brief', 'tts', 'tts-elevenlabs', 'stt', 'insights', 'swap', 'lab/simli/session', 'lab/simli/speak'];
for (const route of routes) {
  for (const mode of ['signed-out', 'limited', 'unavailable']) {
    test(`${route}: ${mode} cannot reach a paid provider`, async () => {
      let admissions = 0;
      const dependencies = {
        '@tanstack/react-router': { createFileRoute: () => config => config },
        '@supabase/supabase-js': { createClient: () => ({ auth: { getUser: async () => ({ data: { user: mode === 'signed-out' ? null : { id: 'verified-user' } } }) } }) },
        '@/lib/api/auth.server': { requireUser: async () => mode === 'signed-out' ? { response: new Response(null, { status: 401 }) } : { userId: 'verified-user' } },
        '@/lib/ai/request.server': requestModule,
        '@/lib/ai/admission.server': { requireAIAdmission: async id => { admissions++; assert.equal(id, 'verified-user'); return new Response(null, { status: mode === 'limited' ? 429 : 503 }); } },
        '@/lib/ai/gateway.server': { AIError: class extends Error {} },
        '@/lib/ai/context.server': {}, '@/lib/ai/log.server': {},
        '@/lib/ai/memory-extractor.server': {}, '@/lib/ops/alert.server': {},
        '@/lib/ai/recommendations.server': {}, '@/lib/ai/prompts.server': {},
        '@/lib/ai/time-directive': {}, '@/lib/ai/intent-hint.server': {},
        '@/lib/voice/profile': { VOICE_OPTIONS: [] },
      };
      const { Route } = load(`src/routes/api/${route}.ts`, dependencies, {
        SUPABASE_URL: 'https://example.test', SUPABASE_SERVICE_ROLE_KEY: 'test-only',
      });
      const response = await Route.server.handlers.POST({ request: new Request(`https://example.test/api/${route}`, {
        method: 'POST', headers: { Authorization: 'Bearer test', 'Content-Type': 'application/json' }, body: JSON.stringify({ intent: 'coach', messages: [{ role: 'user', content: 'hello' }] }),
      }) });
      assert.equal(response.status, mode === 'signed-out' ? 401 : mode === 'limited' ? 429 : 503);
      assert.equal(admissions, mode === 'signed-out' ? 0 : 1);
    });
  }
}

for (const [body, status] of [
  [JSON.stringify({ text: 'a'.repeat(65536) }), 413],
  ['null', 400], ['[]', 400], ['{"text":', 400],
]) test(`JSON body validation rejects ${status}`, async () => {
  const result = await requestModule.readAIJson(new Request('https://example.test', { method: 'POST', body }));
  assert.equal(result.response.status, status);
});
test('JSON limit counts UTF-8 bytes, not characters', async () => {
  const result = await requestModule.readAIJson(new Request('https://example.test', { method: 'POST', body: JSON.stringify({ text: '😀'.repeat(18000) }) }));
  assert.equal(result.response.status, 413);
});
test('JSON parser preserves valid object', async () => {
  const result = await requestModule.readAIJson(new Request('https://example.test', { method: 'POST', body: '{"text":"hello"}' }));
  assert.equal(result.body.text, 'hello');
});
test('gateway bounds output and preserves shorter voice limit', async () => {
  const bodies = [];
  const gateway = load('src/lib/ai/gateway.server.ts', {}, { LOVABLE_API_KEY: 'test-only' }, async (_url, opts) => {
    bodies.push(JSON.parse(opts.body));
    return Response.json({ choices: [{ message: { content: 'ok' } }] });
  });
  const messages = [{ role: 'user', content: 'hello' }];
  await gateway.chatJSON({ messages });
  await gateway.chatStream({ messages });
  await gateway.chatStream({ messages, maxTokens: 180 });
  assert.deepEqual(bodies.map(b => b.max_tokens), [2048, 2048, 180]);
  for (const bad of [0, -1, 2049, NaN, 1.5]) await assert.rejects(gateway.chatStream({ messages, maxTokens: bad }), /Invalid output limit/);
  await assert.rejects(gateway.chatJSON({ messages: [{ role: 'user', content: 'x'.repeat(64001) }] }), /too large/);
  await assert.rejects(gateway.chatStream({ messages: [{ role: 'tool', content: 'hi' }] }), /invalid/);
  assert.equal(bodies.length, 3);
});

test('Simli rejects unbounded or invalid session durations before provider', async () => {
  let providerCalls = 0;
  const { Route } = load('src/routes/api/lab/simli/session.ts', {
    '@tanstack/react-router': { createFileRoute: () => config => config },
    '@/lib/api/auth.server': { requireUser: async () => ({ userId: 'verified-user' }) },
    '@/lib/ai/admission.server': { requireAIAdmission: async () => null },
    '@/lib/ai/request.server': requestModule,
  }, { SIMLI_API_KEY: 'test-only' }, async () => { providerCalls++; return Response.json({}); });
  for (const duration of [-1, 0, 601, '600', 1.5]) {
    const result = await Route.server.handlers.POST({ request: new Request('https://example.test/api/lab/simli/session', {
      method: 'POST', body: JSON.stringify({ faceId: 'face', maxSessionLength: duration }),
    }) });
    assert.equal(result.status, 400);
  }
  assert.equal(providerCalls, 0);
});

test('legacy coach rejects oversize before forwarding', async () => {
  const { Route } = load('src/routes/api/coach.ts', {
    '@tanstack/react-router': { createFileRoute: () => config => config },
    '@/lib/ai/request.server': requestModule,
  });
  const result = await Route.server.handlers.POST({ request: new Request('https://example.test/api/coach', {
    method: 'POST', body: JSON.stringify({ messages: ['a'.repeat(65536)] }),
  }) });
  assert.equal(result.status, 413);
});

test('bounded reader cancels chunked stream without Content-Length', async () => {
  let cancelled = false;
  let chunks = 0;
  const stream = new ReadableStream({
    pull(controller) { chunks++; controller.enqueue(new Uint8Array(1024)); },
    cancel() { cancelled = true; },
  });
  const result = await requestModule.readAIRequestBody(new Request('https://example.test', { method: 'POST', body: stream, duplex: 'half' }), 2048);
  assert.equal(result.response.status, 413);
  assert.equal(cancelled, true);
  assert.ok(chunks <= 4);
});

test('STT rejects oversized multipart before parsing or provider', async () => {
  const { Route } = load('src/routes/api/stt.ts', {
    '@tanstack/react-router': { createFileRoute: () => config => config },
    '@/lib/api/auth.server': { requireUser: async () => ({ userId: 'verified-user' }) },
    '@/lib/ai/admission.server': { requireAIAdmission: async () => null },
    '@/lib/ai/request.server': requestModule,
    '@supabase/supabase-js': {}, '@/lib/ai/log.server': {},
  }, { LOVABLE_API_KEY: 'test-only' });
  const result = await Route.server.handlers.POST({ request: new Request('https://example.test/api/stt', {
    method: 'POST', headers: { 'Content-Type': 'multipart/form-data; boundary=test' }, body: new Uint8Array(25 * 1024 * 1024 + 1),
  }) });
  assert.equal(result.status, 413);
});
