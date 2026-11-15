import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

function loadExtractor(chatResult) {
  const js = ts.transpileModule(readFileSync(new URL('../src/lib/ai/memory-extractor.server.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  const calls = { chat: 0, logs: 0 };
  const mocks = {
    './gateway.server': { FAST_MODEL: 'fast', chatJSON: async () => { calls.chat++; return { text: JSON.stringify(chatResult), promptTokens: 1, completionTokens: 1, model: 'fast' }; } },
    './models.server': { modelForTask: () => 'fast' },
    './log.server': { logAIRequest: async () => { calls.logs++; } },
  };
  vm.runInNewContext(js, { exports: module.exports, module, Date, JSON, Math, Promise, console, require: (n) => { if (n in mocks) return mocks[n]; throw new Error('Unexpected import ' + n); } });
  return { mod: module.exports, calls };
}

/** Minimal Supabase stand-in that records every write by table. */
function fakeAdmin({ prefs, memories = [], declined = [], pending = null }) {
  const writes = [];
  const builder = (table, op, payload) => {
    const b = {
      select: () => b, eq: () => b, is: () => b, gte: () => b, in: () => b,
      maybeSingle: async () => ({ data: table === 'user_prefs' ? prefs : table === 'ai_memory_proposals' ? pending : null, error: null }),
      single: async () => ({ data: { id: 'new' }, error: null }),
      then: (ok) => Promise.resolve({ data: table === 'ai_memory' ? memories : table === 'ai_memory_proposals' ? declined : [], error: null }).then(ok),
    };
    if (op) writes.push({ table, op, payload });
    return b;
  };
  return {
    writes,
    from: (table) => ({
      select: (...a) => builder(table).select(...a),
      insert: (payload) => builder(table, 'insert', payload),
      update: (payload) => builder(table, 'update', payload),
      upsert: (payload) => builder(table, 'upsert', payload),
    }),
  };
}

const turn = { userId: 'u1', userTurn: 'I work nights at Mercy and take melatonin', assistantTurn: 'Got it.' };
const MEMS = { memories: [
  { content: 'Works night shifts in the ER', category: 'employer', importance: 5, ttl_days: null },
  { content: 'Takes melatonin before daytime sleep', category: 'preferences', importance: 3 },
  { content: 'Has sleep apnea', category: 'health', importance: 4 },
  { content: 'On call this week', category: 'schedule', importance: 3, ttl_days: 7 },
  { content: 'Prefers decaf after midnight', category: 'caffeine', importance: 4 },
] };

test('memory off or learning paused: no model call, no writes', async () => {
  for (const prefs of [{ memory_enabled: false, memory_learning_paused: false }, { memory_enabled: true, memory_learning_paused: true }, null]) {
    const { mod, calls } = loadExtractor(MEMS);
    const admin = fakeAdmin({ prefs });
    assert.equal(await mod.proposeMemoriesFromChat({ admin, ...turn }), 0);
    assert.equal(calls.chat, 0);
    assert.deepEqual(admin.writes, []);
  }
});

test('chat never saves memories directly: only pending proposals, never health or medical', async () => {
  const { mod } = loadExtractor(MEMS);
  const admin = fakeAdmin({ prefs: { memory_enabled: true, memory_learning_paused: false } });
  assert.equal(await mod.proposeMemoriesFromChat({ admin, ...turn }), 2);
  assert.ok(admin.writes.every((w) => w.table === 'ai_memory_proposals'), 'no write may touch ai_memory');
  const inserted = admin.writes.filter((w) => w.op === 'insert').map((w) => w.payload);
  assert.deepEqual(inserted.map((p) => p.content), ['Works night shifts in the ER', 'Prefers decaf after midnight']);
  for (const p of inserted) {
    assert.equal(p.status, 'pending');
    assert.notEqual(p.category, 'health');
    assert.match(p.dedupe_key, /^chat:/);
  }
});

test('declined within 30 days, already-kept facts, and existing pending proposals are not re-inserted', async () => {
  const { mod } = loadExtractor({ memories: [{ content: 'Prefers decaf after midnight', category: 'caffeine' }, { content: 'Works night shifts in the ER', category: 'employer' }, { content: 'Has two kids under five', category: 'family' }] });
  const admin = fakeAdmin({
    prefs: { memory_enabled: true, memory_learning_paused: false },
    memories: [{ content: 'Prefers decaf after midnight!', embedding_hash: null }],
    declined: [{ dedupe_key: 'chat:works night shifts in the er' }],
    pending: { id: 'p1', observed_count: 1 },
  });
  assert.equal(await mod.proposeMemoriesFromChat({ admin, ...turn }), 0);
  assert.equal(admin.writes.filter((w) => w.op === 'insert').length, 0);
  const bumps = admin.writes.filter((w) => w.op === 'update');
  assert.equal(bumps.length, 1, 'the pending "two kids" proposal is bumped, not duplicated');
  assert.equal(bumps[0].payload.observed_count, 2);
});

test('the filter refuses health category, medical wording and temporary facts', () => {
  const { mod } = loadExtractor(MEMS);
  assert.equal(mod.proposalAllowed({ content: 'Has diabetes', category: 'general' }), false);
  assert.equal(mod.proposalAllowed({ content: 'Prefers a cool dark room', category: 'health' }), false);
  assert.equal(mod.proposalAllowed({ content: 'Sees a therapist on Tuesdays', category: 'schedule' }), false);
  assert.equal(mod.proposalAllowed({ content: 'Covering a colleague this week', category: 'schedule', ttl_days: 7 }), false);
  assert.equal(mod.proposalAllowed({ content: 'Prefers rain sounds for daytime sleep', category: 'preferences' }), true);
});

test('the extractor prompt no longer offers a health category; route uses proposals; readiness is not requested', () => {
  const src = readFileSync(new URL('../src/lib/ai/memory-extractor.server.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /schedule\|health\|/);
  assert.doesNotMatch(src, /from\("ai_memory"\)\s*\.insert/);
  const route = readFileSync(new URL('../src/routes/api/ai.ts', import.meta.url), 'utf8');
  assert.match(route, /proposeMemoriesFromChat/);
  assert.doesNotMatch(route, /extractAndStoreMemories/);
  const review = route.match(/const DAILY_REVIEW_SYSTEM = `([\s\S]*?)`;/)[1];
  assert.doesNotMatch(review, /readinessDelta/);
  const schemas = readFileSync(new URL('../src/lib/ai/intent-schemas.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(schemas, /readinessDelta/, 'the daily-review schema strips any readiness figure');
});
