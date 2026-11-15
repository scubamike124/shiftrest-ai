// Failover for the direct AI provider: mocked fetch only, no network.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

function load(file, { env = {}, mocks = {}, fetch: fetcher } = {}) {
  const js = ts.transpileModule(readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(js, {
    exports: module.exports, module, process: { env }, URL, Response, JSON, Date, console: { error() {} },
    fetch: fetcher ?? (() => { throw new Error('Unexpected network call'); }),
    require: (name) => { if (name in mocks) return mocks[name]; throw new Error('Unexpected import ' + name); },
  });
  return module.exports;
}

const ok = (text, extra = {}) => Response.json({ choices: [{ message: { content: text }, finish_reason: extra.finish ?? 'stop' }], usage: { prompt_tokens: extra.p ?? 10, completion_tokens: extra.c ?? 5 } });
const msgs = [{ role: 'user', content: 'hi' }];

function setup(extraEnv, script) {
  const env = { AI_API_KEY: 'primary-key', AI_BASE_URL: 'https://primary.example.test/v1', AI_CHAT_MODEL: 'main-model', ...extraEnv };
  const calls = [];
  const fetcher = async (url, init) => {
    const call = { url, auth: init.headers.Authorization, body: JSON.parse(init.body) };
    calls.push(call);
    const step = script[calls.length - 1];
    if (!step) throw new Error('unexpected extra call #' + calls.length);
    if (step instanceof Error) throw step;
    return typeof step === 'function' ? step(call) : step;
  };
  const provider = load('src/lib/ai/provider.server.ts', { env });
  const models = load('src/lib/ai/models.server.ts', { env });
  const gateway = load('src/lib/ai/gateway.server.ts', { env, mocks: { './provider.server': provider, './models.server': models }, fetch: fetcher });
  return { gateway, models, calls, env };
}
const FB = { AI_FALLBACK_MODEL: 'backup-model' };

test('fallbackConfig is off by default and has explicit off switches', () => {
  const { models } = setup({}, []);
  assert.equal(models.fallbackConfig({ AI_CHAT_MODEL: 'a' }), undefined);
  assert.equal(models.fallbackConfig({ AI_CHAT_MODEL: 'a', AI_FALLBACK_MODEL: 'b' }).model, 'b');
  assert.equal(models.fallbackConfig({ AI_CHAT_MODEL: 'a', AI_FALLBACK_MODEL: 'b', AI_FALLBACK: 'off' }), undefined);
  assert.equal(models.fallbackConfig({ AI_CHAT_MODEL: 'a', AI_FALLBACK_MODEL: 'b', AI_ROUTING: 'off' }), undefined);
  assert.equal(models.fallbackConfig({ AI_FALLBACK_MODEL: 'bad model!' }), undefined);
});

test('a different fallback endpoint needs its own key; the primary key is never reused for it', () => {
  const { models } = setup({}, []);
  assert.equal(models.fallbackConfig({ AI_FALLBACK_MODEL: 'b', AI_FALLBACK_BASE_URL: 'https://other.example.test/v1' }), undefined);
  const cfg = models.fallbackConfig({ AI_BASE_URL: 'https://generativelanguage.googleapis.com/v1beta/openai', AI_FALLBACK_MODEL: 'openai/gpt-6-luna', AI_FALLBACK_BASE_URL: 'https://api.openai.com/v1', AI_FALLBACK_API_KEY: 'fb-key' });
  assert.equal(cfg.model, 'gpt-6-luna'); assert.equal(cfg.apiKey, 'fb-key'); assert.equal(cfg.baseUrl, 'https://api.openai.com/v1');
});

test('without AI_FALLBACK_MODEL a failure behaves exactly as before: one call, error thrown', async () => {
  const { gateway, calls } = setup({}, [new Response('x', { status: 503 })]);
  await assert.rejects(gateway.chatJSON({ messages: msgs }), (e) => e.status === 503);
  assert.equal(calls.length, 1);
});

test('429 and 5xx fall back once to the second model; usage is the fallback only', async () => {
  for (const status of [429, 500, 503, 402]) {
    const { gateway, calls } = setup(FB, [new Response('x', { status }), ok('hello', { p: 7, c: 3 })]);
    const out = await gateway.chatJSON({ messages: msgs });
    assert.equal(calls.length, 2);
    assert.equal(calls[0].body.model, 'main-model'); assert.equal(calls[1].body.model, 'backup-model');
    assert.equal(out.text, 'hello'); assert.equal(out.model, 'backup-model'); assert.equal(out.fellBack, true);
    assert.equal(out.promptTokens, 7); assert.equal(out.completionTokens, 3);
  }
});

test('network error or timeout falls back', async () => {
  const { gateway, calls } = setup(FB, [new TypeError('fetch failed'), ok('fine')]);
  assert.equal((await gateway.chatJSON({ messages: msgs })).text, 'fine');
  assert.equal(calls.length, 2);
});

test('retries are bounded: primary + one fallback, then the primary error is thrown', async () => {
  const { gateway, calls } = setup(FB, [new Response('x', { status: 429 }), new Response('x', { status: 500 }), ok('never reached')]);
  await assert.rejects(gateway.chatJSON({ messages: msgs }), (e) => e.status === 429);
  assert.equal(calls.length, 2);
});

test('auth and validation errors do not fall back (not a capacity problem)', async () => {
  for (const status of [401, 403, 404]) {
    const { gateway, calls } = setup(FB, [new Response('x', { status })]);
    await assert.rejects(gateway.chatJSON({ messages: msgs }), (e) => e.status === status);
    assert.equal(calls.length, 1);
  }
  const { gateway, calls } = setup(FB, [new Response('x', { status: 400 })]);
  await assert.rejects(gateway.chatJSON({ messages: msgs }), (e) => e.status === 400);
  assert.equal(calls.length, 1, '400 without JSON mode is our bug, not a provider refusal');
});

test('empty reply falls back; if the fallback is also empty the original empty reply is returned', async () => {
  const a = setup(FB, [ok(''), ok('recovered')]);
  assert.equal((await a.gateway.chatJSON({ messages: msgs })).text, 'recovered');
  const b = setup(FB, [ok(''), ok('')]);
  const out = await b.gateway.chatJSON({ messages: msgs });
  assert.equal(out.text, ''); assert.equal(out.model, 'main-model'); assert.equal(b.calls.length, 2);
});

test('truncated or unparseable JSON in JSON mode falls back; plain text mode does not', async () => {
  const a = setup(FB, [ok('{"a": 1', { finish: 'length', c: 2048 }), ok('{"a":1}')]);
  const out = await a.gateway.chatJSON({ messages: msgs, jsonMode: true });
  assert.equal(out.text, '{"a":1}'); assert.equal(out.completionTokens, 5, 'the truncated attempt is not charged');
  const fenced = setup(FB, [ok('```json\n{"a":1}\n```')]);
  assert.equal((await fenced.gateway.chatJSON({ messages: msgs, jsonMode: true })).fellBack, undefined);
  assert.equal(fenced.calls.length, 1);
  const prose = setup(FB, [ok('not json at all but fine')]);
  assert.equal((await prose.gateway.chatJSON({ messages: msgs })).text, 'not json at all but fine');
  assert.equal(prose.calls.length, 1);
});

test('a provider refusing JSON mode (400) falls back only when JSON mode was requested', async () => {
  const { gateway, calls } = setup(FB, [new Response('bad response_format', { status: 400 }), ok('{"ok":true}')]);
  const out = await gateway.chatJSON({ messages: msgs, jsonMode: true });
  assert.equal(out.model, 'backup-model'); assert.equal(calls.length, 2);
});

test('fallback to another provider uses its URL and key and its own request shape', async () => {
  const { gateway, calls } = setup({ AI_FALLBACK_MODEL: 'claude-haiku-5-5', AI_FALLBACK_BASE_URL: 'https://api.anthropic.com/v1/', AI_FALLBACK_API_KEY: 'fb-key' },
    [new Response('x', { status: 503 }), ok('{"ok":1}')]);
  await gateway.chatJSON({ messages: msgs, jsonMode: true, temperature: 0.1 });
  assert.equal(calls[0].url, 'https://primary.example.test/v1/chat/completions'); assert.equal(calls[0].auth, 'Bearer primary-key');
  assert.equal(calls[1].url, 'https://api.anthropic.com/v1/chat/completions'); assert.equal(calls[1].auth, 'Bearer fb-key');
  assert.equal(calls[1].body.response_format, undefined, 'Claude body has no json_object');
  assert.equal(calls[0].body.response_format.type, 'json_object');
});

test('explicit model argument (coach path) still falls back; fallback equal to primary is skipped', async () => {
  const a = setup(FB, [new Response('x', { status: 500 }), ok('x')]);
  assert.equal((await a.gateway.chatJSON({ model: 'chosen', messages: msgs })).model, 'backup-model');
  const b = setup({ AI_FALLBACK_MODEL: 'main-model' }, [new Response('x', { status: 500 })]);
  await assert.rejects(b.gateway.chatJSON({ messages: msgs }));
  assert.equal(b.calls.length, 1);
});

test('streaming falls back before the first byte only, once', async () => {
  const a = setup(FB, [new Response('x', { status: 429 }), new Response('data: [DONE]\n\n', { status: 200 })]);
  const res = await a.gateway.chatStream({ messages: msgs, maxTokens: 180 });
  assert.equal(res.status, 200); assert.equal(a.calls.length, 2);
  assert.equal(a.calls[1].body.model, 'backup-model'); assert.equal(a.calls[1].body.max_tokens, 180);
  assert.deepEqual(JSON.parse(JSON.stringify(a.calls[1].body.stream_options)), { include_usage: true });
  const b = setup(FB, [new Response('x', { status: 500 }), new Response('x', { status: 500 })]);
  await assert.rejects(b.gateway.chatStream({ messages: msgs }), (e) => e.status === 500);
  assert.equal(b.calls.length, 2);
  const c = setup(FB, [new Response('x', { status: 401 })]);
  await assert.rejects(c.gateway.chatStream({ messages: msgs }), (e) => e.status === 401);
  assert.equal(c.calls.length, 1);
});

test('failover never touches admission or budget: gateway has no budget or log imports', () => {
  const src = readFileSync(new URL('../src/lib/ai/gateway.server.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /import[^;]*log\.server|\.rpc\(|\.from\("ai_log"\)/);
});
