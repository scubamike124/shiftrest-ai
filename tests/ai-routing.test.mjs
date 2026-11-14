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
    exports: module.exports, module, process: { env }, URL, Response, JSON, Date,
    fetch: fetcher ?? (() => { throw new Error('Unexpected network call'); }),
    require: (name) => { if (name in mocks) return mocks[name]; throw new Error('Unexpected import ' + name); },
  });
  return module.exports;
}

const models = (env) => load('src/lib/ai/models.server.ts', { env });
const plain = (v) => JSON.parse(JSON.stringify(v));

test('default routing is unchanged: chat model everywhere, fast model for background', () => {
  const env = { AI_CHAT_MODEL: 'gemini-3-flash-preview', AI_FAST_MODEL: 'gemini-3.1-flash-lite' };
  const m = models(env);
  for (const task of ['coach', 'voice', 'structured', 'brief']) assert.equal(m.modelForTask(task, env), 'gemini-3-flash-preview');
  assert.equal(m.modelForTask('background', env), 'gemini-3.1-flash-lite');
  assert.equal(m.modelForTask('background', { AI_CHAT_MODEL: 'x-model' }), 'x-model');
  assert.equal(m.modelForTask('coach', {}), undefined);
  for (const task of m.AI_TASKS) assert.equal(m.reasoningForTask(task, env), undefined);
});

test('per-task overrides apply only when set; AI_ROUTING=off rolls all of them back', () => {
  const env = { AI_CHAT_MODEL: 'base', AI_FAST_MODEL: 'fast', AI_MODEL_VOICE: 'voice-model', AI_MODEL_BACKGROUND: 'bg-model', AI_REASONING_VOICE: 'low' };
  const m = models(env);
  assert.equal(m.modelForTask('voice', env), 'voice-model');
  assert.equal(m.modelForTask('coach', env), 'base');
  assert.equal(m.modelForTask('background', env), 'bg-model');
  assert.equal(m.reasoningForTask('voice', env), 'low');
  for (const off of ['off', 'OFF', '0', 'false', 'legacy']) {
    const rolled = { ...env, AI_ROUTING: off };
    assert.equal(m.modelForTask('voice', rolled), 'base');
    assert.equal(m.modelForTask('background', rolled), 'fast');
    assert.equal(m.reasoningForTask('voice', rolled), undefined);
  }
});

test('invalid model ids and reasoning values are ignored, never sent', () => {
  const env = { AI_CHAT_MODEL: 'base', AI_MODEL_COACH: 'bad model; rm -rf', AI_REASONING_COACH: 'extreme' };
  const m = models(env);
  assert.equal(m.modelForTask('coach', env), 'base');
  assert.equal(m.reasoningForTask('coach', env), undefined);
});

test('Lovable-style vendor prefixes are stripped only for hosts that need bare ids', () => {
  const google = { AI_BASE_URL: 'https://generativelanguage.googleapis.com/v1beta/openai/', AI_CHAT_MODEL: 'google/gemini-3-flash-preview' };
  assert.equal(models(google).modelForTask('coach', google), 'gemini-3-flash-preview');
  const other = { AI_BASE_URL: 'https://router.example.test/v1', AI_CHAT_MODEL: 'google/gemini-3-flash-preview' };
  assert.equal(models(other).modelForTask('coach', other), 'google/gemini-3-flash-preview');
});

test('request bodies keep the current Gemini shape and add a streamed usage frame', () => {
  const m = models({});
  const msgs = [{ role: 'user', content: 'hi' }];
  assert.deepEqual(plain(m.buildChatBody({ model: 'gemini-3-flash-preview', messages: msgs, maxTokens: 2048, jsonMode: true, temperature: 0.1 }, {})),
    { model: 'gemini-3-flash-preview', messages: msgs, max_tokens: 2048, temperature: 0.1, response_format: { type: 'json_object' } });
  assert.deepEqual(plain(m.buildChatBody({ model: 'gemini-3-flash-preview', messages: msgs, maxTokens: 180, stream: true }, {})),
    { model: 'gemini-3-flash-preview', messages: msgs, max_tokens: 180, stream: true, stream_options: { include_usage: true } });
  const noUsage = plain(m.buildChatBody({ model: 'gemini-3-flash-preview', messages: msgs, stream: true }, { AI_STREAM_USAGE: 'off' }));
  assert.equal(noUsage.stream_options, undefined);
});

test('provider families get parameters they accept', () => {
  const m = models({});
  const msgs = [{ role: 'user', content: 'hi' }];
  const openai = plain(m.buildChatBody({ model: 'gpt-6-luna', messages: msgs, maxTokens: 180, temperature: 0.1, jsonMode: true, reasoningEffort: 'low' }, {}));
  assert.equal(openai.max_completion_tokens, 180); assert.equal(openai.max_tokens, undefined);
  assert.equal(openai.temperature, undefined); assert.equal(openai.reasoning_effort, 'low');
  assert.deepEqual(openai.response_format, { type: 'json_object' });
  const claude = plain(m.buildChatBody({ model: 'claude-haiku-5-5', messages: msgs, maxTokens: 180, temperature: 0.1, jsonMode: true, reasoningEffort: 'low' }, {}));
  assert.equal(claude.max_tokens, 180); assert.equal(claude.temperature, undefined);
  assert.equal(claude.response_format, undefined); assert.equal(claude.reasoning_effort, undefined);
  assert.equal(m.modelFamily('openai/gpt-5-mini'), 'openai-reasoning');
  assert.equal(m.modelFamily('google/gemini-3-flash-preview'), 'gemini');
});

test('gateway sends the routed model and reports it for usage logging', async () => {
  const calls = [];
  const env = { AI_API_KEY: 'k', AI_BASE_URL: 'https://chat.example.test/v1', AI_CHAT_MODEL: 'base', AI_MODEL_BRIEF: 'brief-model' };
  const provider = load('src/lib/ai/provider.server.ts', { env });
  const modelsMod = load('src/lib/ai/models.server.ts', { env });
  const gateway = load('src/lib/ai/gateway.server.ts', {
    env,
    mocks: { './provider.server': provider, './models.server': modelsMod },
    fetch: async (url, init) => { calls.push({ url, body: JSON.parse(init.body) }); return Response.json({ choices: [{ message: { content: ' ok ' }, finish_reason: 'stop' }], usage: { prompt_tokens: 3, completion_tokens: 2 } }); },
  });
  const out = await gateway.chatJSON({ task: 'brief', messages: [{ role: 'user', content: 'x' }] });
  assert.equal(calls[0].url, 'https://chat.example.test/v1/chat/completions');
  assert.equal(calls[0].body.model, 'brief-model');
  assert.equal(out.model, 'brief-model'); assert.equal(out.text, 'ok'); assert.equal(out.finishReason, 'stop');
  await gateway.chatStream({ task: 'voice', maxTokens: 180, messages: [{ role: 'user', content: 'x' }] });
  assert.equal(calls[1].body.model, 'base');
  assert.deepEqual(calls[1].body.stream_options, { include_usage: true });
});

test('companion context objects are serialized, not "[object Object]"', () => {
  const g = load('src/lib/ai/intent-guards.ts');
  assert.equal(g.normalizeLiveContext('Next shift 19:00'), 'Next shift 19:00');
  assert.equal(g.normalizeLiveContext({ surface: 'companion', companion_name: 'Lisa', max_tokens: 180 }), '{"surface":"companion","companion_name":"Lisa"}');
  assert.equal(g.normalizeLiveContext({ max_tokens: 180 }), undefined);
  assert.equal(g.normalizeLiveContext(['x']), undefined);
  assert.equal(g.normalizeLiveContext({ big: 'x'.repeat(9000) }).length, 4000);
});

test('commute times are exact arithmetic', () => {
  const g = load('src/lib/ai/intent-guards.ts');
  assert.deepEqual(plain(g.commuteTimes('2026-11-14T19:00:00.000Z', 35, 20)), { leaveAt: '2026-11-14T18:25:00.000Z', prepStartAt: '2026-11-14T18:05:00.000Z' });
  assert.deepEqual(plain(g.commuteTimes('2026-11-14T07:00:00.000Z', 45)), { leaveAt: '2026-11-14T06:15:00.000Z', prepStartAt: '2026-11-14T05:50:00.000Z' });
  assert.equal(g.commuteTimes('not a date', 10), null);
  assert.equal(g.commuteTimes('2026-11-14T07:00:00.000Z', -5), null);
});

test('health-data signal lines carry provenance tags at the end', () => {
  const src = readFileSync(new URL('../src/lib/ai/personal-signals.server.ts', import.meta.url), 'utf8');
  for (const prefix of ['Last sleep:', 'HRV last night:', 'Resting HR last night:', 'Sleep-goal streak:', 'Hit sleep goal ']) {
    const line = src.split('\n').find((l) => l.includes('`' + prefix));
    assert.ok(line && line.includes('wearableTag('), prefix + ' must be tagged as a wearable measurement');
  }
  assert.match(src, /behind goal\.`[\s\S]{0,120}estimateTag\(/);
  const guard = readFileSync(new URL('../src/lib/ai/guardrails.ts', import.meta.url), 'utf8');
  assert.match(guard, /\[wearable: …\]/); assert.match(guard, /Never invent/);
});
