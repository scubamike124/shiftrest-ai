import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

function load(file, mocks = {}) {
  const js = ts.transpileModule(readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(js, { exports: module.exports, module, Promise, require: (n) => { if (n in mocks) return mocks[n]; throw new Error('Unexpected import ' + n); } });
  return module.exports;
}
const name = load('src/lib/companion/name.ts');

test('Aura is the default; a customer-chosen name always wins', () => {
  assert.equal(name.companionName('Lisa'), 'Lisa');
  assert.equal(name.companionName('  Lisa  ', 'atlas'), 'Lisa');
  assert.equal(name.companionName('RestPilot'), 'Aura', 'the stored default means "not personalised"');
  assert.equal(name.companionName('restpilot'), 'Aura');
  assert.equal(name.companionName(''), 'Aura');
  assert.equal(name.companionName(null), 'Aura');
  assert.equal(name.companionName('Pilot'), 'Pilot', 'an explicit choice of "Pilot" is kept');
});

test('an unnamed companion takes the chosen look\'s name', () => {
  assert.equal(name.companionName('RestPilot', 'nova'), 'Nova');
  assert.equal(name.companionName(undefined, 'sage'), 'Sage');
  assert.equal(name.companionName('RestPilot', 'custom:https://example.test/me.png'), 'Aura');
  assert.equal(name.companionName('RestPilot', 'unknown'), 'Aura');
  assert.equal(name.customCompanionName('RestPilot'), '');
  assert.equal(name.customCompanionName('Lisa'), 'Lisa');
});

test('preset names match the avatar catalog', () => {
  const src = readFileSync(new URL('../src/lib/companion/avatars.ts', import.meta.url), 'utf8');
  const presets = [...src.matchAll(/id: "([a-z]+)", name: "([A-Za-z]+)"/g)].map((m) => [m[1], m[2]]);
  assert.ok(presets.length >= 4);
  assert.deepEqual(Object.fromEntries(presets), JSON.parse(JSON.stringify(name.PRESET_COMPANION_NAMES)));
  assert.match(src, /DEFAULT_AVATAR_ID = "aura"/);
});

function admin(prefsRow, avatarId, { profileFails = false } = {}) {
  const chain = (result) => { const b = { select: () => b, eq: () => b, maybeSingle: async () => result }; return b; };
  return { from: (t) => t === 'user_prefs' ? chain({ data: prefsRow, error: null }) : (profileFails ? { select: () => { throw new Error('offline'); } } : chain({ data: avatarId ? { companion_avatar_id: avatarId } : null, error: null })) };
}

test('the AI is told the same name the app shows, and customer data is untouched', async () => {
  const ctx = load('src/lib/ai/context.server.ts', {
    './memory-rank.server': {}, './patterns.server': {}, './recommendations.server': {}, './guardrails': { DATA_HONESTY: '' },
    '@/lib/companion/name': name,
  });
  const row = (assistant_name) => ({ assistant_name, assistant_mode: 'companion', memory_enabled: true, voice_language: 'en-US', voice_accent: null });
  assert.equal((await ctx.loadAssistantProfile(admin(row('Lisa'), 'nova'), 'u')).name, 'Lisa');
  assert.equal((await ctx.loadAssistantProfile(admin(row('RestPilot'), null), 'u')).name, 'Aura');
  assert.equal((await ctx.loadAssistantProfile(admin(row('RestPilot'), 'atlas'), 'u')).name, 'Atlas');
  assert.equal((await ctx.loadAssistantProfile(admin(null, null), 'u')).name, 'Aura');
  const failed = await ctx.loadAssistantProfile(admin(row('RestPilot'), 'nova', { profileFails: true }), 'u');
  assert.equal(failed.name, 'Aura');
  assert.equal(failed.mode, 'companion'); assert.equal(failed.memoryEnabled, true);
  assert.equal(ctx.DEFAULT_ASSISTANT_PROFILE.name, 'Aura');
});

test('no hard-coded "Aura" remains where the customer\'s name should appear', () => {
  const page = readFileSync(new URL('../src/routes/companion.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(page, /Aura's voice|Tap Aura|— Aura is/);
  const intro = readFileSync(new URL('../src/components/companion/CompanionIntroSheet.tsx', import.meta.url), 'utf8');
  assert.match(intro, /props\.name \?\? companionName\(prefs\?\.assistantName, avatarId\)/, 'intro sheet resolves the name even when a call site passes no props (dashboard)');
  const realtime = readFileSync(new URL('../src/lib/realtime/openai.functions.ts', import.meta.url), 'utf8');
  assert.match(
    realtime,
    /buildRealtimeInstructions\(\s*voiceProfile,\s*await loadCompanionNameServer\(context\.userId\),?\s*\)/,
  );
  const instructions = readFileSync(
    new URL("../src/lib/realtime/instructions.ts", import.meta.url),
    "utf8",
  );
  assert.match(instructions, /REPLY_SHAPE\.replace\("\{\{NAME\}\}"/);
});
