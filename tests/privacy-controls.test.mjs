import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
import test from 'node:test';
import { z } from 'zod';
import { clearPersonalDeviceData, clearDeviceAiCaches, personalLocalKeys } from '../src/lib/user/device-data.ts';

// Issue 8: privacy and account controls, exercised against the real handlers
// with only framework and provider IO replaced.
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const serverFn = () => {
  let validator = (d) => d;
  const b = { middleware() { return b; }, inputValidator(fn) { validator = fn; return b; }, handler(fn) { return async (args) => fn({ ...args, data: validator(args.data) }); } };
  return b;
};

// ── Wearable permission revocation ─────────────────────────────────────
function wearableHarness(fail = {}) {
  const calls = [];
  const src = stripTypeScriptTypes(read('src/lib/wearables/wearables.functions.ts'))
    .replace(/^import[\s\S]*?;\n/gm, '').replaceAll('export const ', 'const ');
  const ctx = vm.createContext({ createServerFn: serverFn, requireSupabaseAuth: {}, z, process, crypto, TextEncoder, btoa, Uint8Array, Array, String });
  const { disconnectWearable } = vm.runInContext(`${src}\n({disconnectWearable})`, ctx);
  const supabase = { from(table) { return { delete() { const q = { filters: [], eq(k, v) { q.filters.push(`${k}=${v}`); if (q.filters.length === 2) { calls.push(`${table}:${q.filters.join('&')}`); return Promise.resolve({ error: fail[table] ? { message: 'db' } : null }); } return q; } }; return q; } }; } };
  return { calls, run: (provider = 'oura') => disconnectWearable({ context: { supabase, userId: 'u1' }, data: { provider } }) };
}

test('disconnecting a wearable deletes its tokens AND its synced readings', async () => {
  const h = wearableHarness();
  assert.deepEqual(JSON.parse(JSON.stringify(await h.run())), { ok: true, deletedReadings: true });
  assert.deepEqual(h.calls, ['wearable_readings:user_id=u1&provider=oura', 'wearable_connections:user_id=u1&provider=oura', 'wearable_readings:user_id=u1&provider=oura']);
});

test('wearable disconnect reports failure instead of a false success', async () => {
  const a = wearableHarness({ wearable_connections: true });
  await assert.rejects(a.run(), /couldn't disconnect/);
  const b = wearableHarness({ wearable_readings: true });
  await assert.rejects(b.run(), /couldn't delete this wearable's data/);
  assert.deepEqual(b.calls, ['wearable_readings:user_id=u1&provider=oura'], 'the connection (and the retry button) stays when readings fail');
});

test('existing wearable connections can be revoked from Profile', () => {
  const card = read('src/components/WearableCard.tsx');
  assert.match(card, /disconnectWearable/);
  assert.match(card, /Disconnect and delete data/);
  assert.match(card, /orphaned: true/, 'readings without a connection still get a delete control');
});

// ── Account deletion ───────────────────────────────────────────────────
test('the owner alert written on account deletion contains no email address', async () => {
  const alerts = [];
  const src = stripTypeScriptTypes(read('src/lib/account.functions.ts'))
    .replace(/^import .*;\n/gm, '').replaceAll('export const ', 'const ').replace(/import\(("[^"]+")\)/g, 'deps.load($1)');
  const admin = {
    from() { return { select() { return { async eq() { return { data: [], error: null }; } }; }, delete() { return { async eq() { return { error: null }; } }; } }; },
    auth: { admin: { async getUserById() { return { data: { user: { email: 'person@example.invalid' } } }; }, async deleteUser() { return { error: null }; } } },
  };
  const deps = { async load(p) {
    if (p.includes('client.server')) return { supabaseAdmin: admin };
    if (p.includes('email/send.server')) return { async sendTransactionalEmailServer() {} };
    if (p.includes('alert.server')) return { async notifyOwner(a) { alerts.push(a); } };
    throw new Error(p);
  } };
  const ctx = vm.createContext({ createServerFn: serverFn, requireSupabaseAuth: {}, deps, console });
  const { deleteAccountFn } = vm.runInContext(`${src}\n({deleteAccountFn})`, ctx);
  await deleteAccountFn({ context: { userId: 'user-test' } });
  assert.equal(alerts.length, 1);
  assert.doesNotMatch(JSON.stringify(alerts[0]), /person@example\.invalid/);
});

// ── Device storage ─────────────────────────────────────────────────────
function memStorage(init) {
  const m = new Map(Object.entries(init));
  return { get length() { return m.size; }, key: (i) => [...m.keys()][i] ?? null, removeItem: (k) => m.delete(k), clear: () => m.clear(), getItem: (k) => m.get(k) ?? null, map: m };
}

test('sign-out clears personal device data but keeps device settings', () => {
  const local = memStorage({
    'restpilot.cookie-consent.v1': '{}', 'restpilot:alarm:audio': 'chime', 'rp.coach.voice': 'calm',
    'rp.hydration.2026-11-14': '5', 'restpilot.companion.history.v1': '[...]', 'shiftrest.shifts.v1': '[...]',
    'rp.offline:snapshot:user-1': '{}', 'brief:lastSeenISO': 'x',
  });
  const session = memStorage({ rp_daily_review_v1: '{"headline":"private"}', rp_tomorrow_v1: '{}' });
  clearPersonalDeviceData({ local, session });
  assert.deepEqual([...local.map.keys()].sort(), ['restpilot.cookie-consent.v1', 'restpilot:alarm:audio', 'rp.coach.voice']);
  assert.equal(session.map.size, 0);
});

test('device storage errors never break sign-out', () => {
  const broken = { get length() { throw new Error('denied'); }, key() { throw new Error('denied'); }, removeItem() { throw new Error('denied'); }, clear() { throw new Error('denied'); } };
  assert.doesNotThrow(() => clearPersonalDeviceData({ local: broken, session: broken }));
  assert.doesNotThrow(() => clearDeviceAiCaches({ local: broken, session: broken }));
  assert.deepEqual(personalLocalKeys(memStorage({})), []);
});

test('erasing AI memory also clears AI content cached on the device', () => {
  const local = memStorage({ 'restpilot.companion.history.v1': '[]', 'rp.hydration.x': '1' });
  const session = memStorage({ rp_daily_review_v1: '{}', rp_right_now_v1: '{}', rp_rightnow_v1: '{}', rp_tomorrow_v1: '{}', other: '1' });
  clearDeviceAiCaches({ local, session });
  assert.deepEqual([...local.map.keys()], ['rp.hydration.x']);
  assert.deepEqual([...session.map.keys()], ['other']);
});

test('profile wires sign-out, deletion and memory erase to device clearing', () => {
  const p = read('src/routes/profile.tsx');
  assert.match(p, /await supabase\.auth\.signOut\(\);\n[\s\S]{0,200}clearPersonalDeviceData\(\);/);
  assert.match(p, /localStorage\.clear\(\);[\s\S]{0,120}clearPersonalDeviceData\(\)/);
  assert.match(p, /await purgeAiMemory\(\{ data: undefined \}\);\n\s*clearDeviceAiCaches\(\);/);
  assert.match(p, /aria-label="New password"/);
});

// ── AI memory consent ──────────────────────────────────────────────────
async function runExtractor(prefsRow, error = null) {
  const src = stripTypeScriptTypes(read('src/lib/ai/memory-extractor.server.ts')).replace(/^import .*;\n/gm, '').replace(/^export /gm, '');
  let modelCalls = 0;
  const ctx = vm.createContext({ chatJSON: async () => { modelCalls++; return { memories: [] }; }, FAST_MODEL: 'm', logAIRequest: async () => {}, Date, Math, JSON, String, Number, Array, Set, Map });
  const { extractAndStoreMemories } = vm.runInContext(`${src}\n({extractAndStoreMemories})`, ctx);
  const admin = { from() { const q = { select() { return q; }, eq() { return q; }, async maybeSingle() { return { data: prefsRow, error }; }, upsert: async () => ({ error: null }), insert: async () => ({ error: null }), in() { return q; }, order() { return q; }, limit() { return q; }, then: undefined }; return q; } };
  const n = await extractAndStoreMemories({ admin, userId: 'u1', userTurn: 'I work nights at Mercy', assistantTurn: 'ok' });
  return { n, modelCalls };
}

test('paused or disabled memory learning stores nothing and sends nothing to the model', async () => {
  for (const row of [{ memory_enabled: true, memory_learning_paused: true }, { memory_enabled: false, memory_learning_paused: false }, null]) {
    const r = await runExtractor(row);
    assert.deepEqual(r, { n: 0, modelCalls: 0 }, JSON.stringify(row));
  }
  assert.deepEqual(await runExtractor(null, { message: 'db down' }), { n: 0, modelCalls: 0 });
  const allowed = await runExtractor({ memory_enabled: true, memory_learning_paused: false });
  assert.equal(allowed.modelCalls, 1);
});
