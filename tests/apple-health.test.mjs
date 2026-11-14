// Apple Health (HealthKit) data mapping and its privacy rule. Pure logic.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.env.TZ = 'America/New_York';

async function load(entry) {
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'rp-ah-')), 'm.mjs');
  await build({
    entryPoints: [path.join(root, entry)],
    bundle: true,
    format: 'esm',
    platform: 'node',
    outfile: out,
    alias: { '@': path.join(root, 'src') },
    // The supabase client is imported (type-only in practice) through prefs/shifts.
    external: ['@supabase/*'],
    logLevel: 'silent',
  });
  return import(pathToFileURL(out).href);
}

const AH = await load('src/lib/health/apple-health.ts');
const DI = await load('src/lib/health/device-insights.ts');

// Local-time ISO helper (TZ above): t('2026-11-14 23:00') -> ISO string.
const t = (s) => new Date(s.replace(' ', 'T')).toISOString();
const S = (start, end, value) => ({ start: t(start), end: t(end), value });

// A Watch night with stages + the iPhone's overlapping "asleep" + an "inBed" span.
const night = [
  S('2026-11-14 22:30', '2026-11-15 06:30', 'inBed'),
  S('2026-11-14 23:00', '2026-11-15 01:00', 'core'),
  S('2026-11-15 01:00', '2026-11-15 02:00', 'deep'),
  S('2026-11-15 02:00', '2026-11-15 02:30', 'awake'),
  S('2026-11-15 02:30', '2026-11-15 04:30', 'core'),
  S('2026-11-15 04:30', '2026-11-15 06:00', 'rem'),
  S('2026-11-14 23:00', '2026-11-15 02:00', 'asleep'), // iPhone, overlaps the Watch
];

test('one night: union of sources, awake excluded, stages, efficiency, wake date', () => {
  const [n, ...rest] = AH.mapAppleHealthNights({ sleep: night });
  assert.equal(rest.length, 0);
  assert.equal(n.provider, 'apple-health');
  assert.equal(n.date, '2026-11-15');
  assert.equal(n.sleepDurationMin, 6.5 * 60, '23:00–06:00 minus 30 min awake, overlaps counted once');
  assert.equal(n.awakeMin, 30);
  assert.equal(n.deepMin, 60);
  assert.equal(n.remMin, 90);
  assert.equal(n.lightMin, 240);
  assert.equal(n.sleepEfficiency, Math.round((390 / 480) * 100) / 100, 'asleep ÷ 22:30–06:30 in bed');
  assert.equal(n.sleepStart, t('2026-11-14 22:30'));
  assert.equal(n.sleepEnd, t('2026-11-15 06:30'));
});

test('in-bed only (an iPhone bedtime schedule) is not measured sleep', () => {
  assert.deepEqual(AH.mapAppleHealthNights({ sleep: [S('2026-11-14 22:00', '2026-11-15 06:00', 'inBed')] }), []);
});

test('day sleep after a night shift is dated to the day it ends; a nap adds to that day', () => {
  const nights = AH.mapAppleHealthNights({
    sleep: [S('2026-11-15 08:30', '2026-11-15 14:30', 'asleep'), S('2026-11-15 19:00', '2026-11-15 19:40', 'asleep')],
  });
  assert.equal(nights.length, 1);
  assert.equal(nights[0].date, '2026-11-15');
  assert.equal(nights[0].sleepDurationMin, 6 * 60 + 40);
  assert.equal(nights[0].sleepStart, t('2026-11-15 08:30'), 'main session is the longest one');
  assert.equal(nights[0].deepMin, null, 'no stage data from an unspecified "asleep" source');
});

test('HRV averages SDNN inside the main sleep; resting HR is that day\'s latest', () => {
  const [n] = AH.mapAppleHealthNights({
    sleep: night,
    hrv: [
      { start: t('2026-11-15 01:30'), end: t('2026-11-15 01:31'), ms: 40 },
      { start: t('2026-11-15 05:00'), end: t('2026-11-15 05:00'), ms: 50 }, // instantaneous reading
      { start: t('2026-11-15 15:00'), end: t('2026-11-15 15:01'), ms: 90 }, // daytime: ignored
      { start: t('2026-11-15 03:00'), end: t('2026-11-15 03:01'), ms: -5 }, // invalid: ignored
    ],
    restingHeartRate: [
      { start: t('2026-11-14 08:00'), end: t('2026-11-14 08:00'), bpm: 70 },
      { start: t('2026-11-15 07:00'), end: t('2026-11-15 07:00'), bpm: 55 },
      { start: t('2026-11-15 20:00'), end: t('2026-11-15 20:00'), bpm: 57.4 },
    ],
  });
  assert.equal(n.hrvMs, 45);
  assert.equal(n.restingHr, 57);
});

test('garbage and unknown values are ignored, never thrown on', () => {
  assert.deepEqual(AH.mapAppleHealthNights(null), []);
  assert.deepEqual(
    AH.mapAppleHealthNights({ sleep: [{ start: 'x', end: 'y', value: 'asleep' }, { start: t('2026-11-15 01:00'), end: t('2026-11-15 00:00'), value: 'asleep' }, S('2026-11-15 01:00', '2026-11-15 05:00', 'mystery')] }),
    [],
  );
});

test('last night means ended today or yesterday; older nights are history only', () => {
  const nights = AH.mapAppleHealthNights({ sleep: night });
  assert.equal(AH.lastNightFrom(nights, new Date(2026, 10, 15, 12)).date, '2026-11-15');
  assert.equal(AH.lastNightFrom(nights, new Date(2026, 10, 16, 12)).date, '2026-11-15');
  assert.equal(AH.lastNightFrom(nights, new Date(2026, 10, 18, 12)), null);
  assert.equal(AH.recentNights(nights, new Date(2026, 11, 15)).length, 0, 'a month later it is dropped');
});

// ---- device insights: privacy rule and labels ----
const prefs = { windDownMin: 60, sleepHours: 8, cycleWeeks: 1, cycleAnchor: null, currentTz: null, homeTz: null };
const shifts = [0, 1, 2, 3, 4].map((day) => ({ id: `s${day}`, day, weekIndex: 0, start: 7 * 60, end: 19 * 60 }));
const now = new Date(2026, 10, 15, 12);
// Seven short nights with falling HRV: sleep debt and an HRV drop.
const shortNights = Array.from({ length: 7 }, (_, i) => ({
  provider: 'apple-health', date: `2026-11-${String(9 + i).padStart(2, '0')}`,
  sleepStart: t(`2026-11-${String(8 + i).padStart(2, '0')} 23:30`), sleepEnd: t(`2026-11-${String(9 + i).padStart(2, '0')} 04:30`),
  sleepDurationMin: 300, sleepEfficiency: 0.78, deepMin: 40, remMin: 50, lightMin: 210, awakeMin: 20,
  hrvMs: i < 4 ? 60 : 40, restingHr: 61,
}));

test('Apple Health changes what the phone shows, but never the context sent to the AI', () => {
  const without = DI.computeDeviceInsights({ shifts, prefs, now });
  const withAH = DI.computeDeviceInsights({ shifts, prefs, now, appleHealthNights: shortNights });
  assert.equal(without.source, null);
  assert.equal(withAH.source, 'apple-health');
  assert.ok(withAH.insights.sleepDebtHours >= 3, 'sleep debt from measured nights');
  assert.ok(withAH.insights.hrvTrend < -0.07, 'HRV trend from measured nights');
  assert.ok(withAH.insights.recoveryScore < without.insights.recoveryScore);
  assert.equal(withAH.insights.contextString, without.insights.contextString, 'AI context is identical');
  assert.doesNotMatch(withAH.insights.contextString, /apple|HRV trend|sleep debt|slept/i);
  assert.equal(withAH.appleHealthLastNight.date, '2026-11-15');
});

test('only the wearable-driven recommendations get the "from Apple Health" label', async () => {
  const { buildRecommendations } = await load('src/lib/recommendations.ts');
  const { insights, source } = DI.computeDeviceInsights({ shifts, prefs, now, appleHealthNights: shortNights });
  const recs = DI.labelRecommendations(buildRecommendations(insights, prefs, now), source);
  const labelled = recs.filter((r) => r.dataSource);
  assert.ok(labelled.length >= 1, 'sleep debt / HRV recommendation present');
  assert.ok(labelled.every((r) => r.dataSource === 'Measured · from Apple Health' && r.basedOnWearable));
  assert.ok(recs.filter((r) => !r.basedOnWearable).every((r) => !r.dataSource));
  const plain = DI.labelRecommendations(buildRecommendations(insights, prefs, now), null);
  assert.ok(plain.every((r) => !r.dataSource));
});

test('web fallback: the Apple Health connector stays hidden outside the iPhone app', async () => {
  const store = await load('src/lib/health/apple-health-store.ts');
  assert.equal(await store.appleHealthAvailable(), false, 'no window/Capacitor: hidden');
  globalThis.window = { Capacitor: { isNativePlatform: () => false, Plugins: { RestPilotHealth: {} } } };
  try {
    assert.equal(await store.appleHealthAvailable(), false, 'browser with a Capacitor web runtime: hidden');
    globalThis.window = { Capacitor: { isNativePlatform: () => true, getPlatform: () => 'android', isPluginAvailable: () => true, Plugins: { RestPilotHealth: { isAvailable: async () => ({ available: true }) } } } };
    assert.equal(await store.appleHealthAvailable(), false, 'Android shell: hidden');
    globalThis.window = { Capacitor: { isNativePlatform: () => true, getPlatform: () => 'ios', isPluginAvailable: () => false, Plugins: {} } };
    assert.equal(await store.appleHealthAvailable(), false, 'older iPhone build without the plugin: hidden');
    globalThis.window = { Capacitor: { isNativePlatform: () => true, getPlatform: () => 'ios', isPluginAvailable: () => true, Plugins: { RestPilotHealth: { isAvailable: async () => ({ available: true }) } } } };
    assert.equal(await store.appleHealthAvailable(), true, 'iPhone app with the plugin: shown');
  } finally {
    delete globalThis.window;
  }
});

test('stored data is tied to the account and Disconnect deletes it', async () => {
  const store = await load('src/lib/health/apple-health-store.ts');
  const mem = new Map();
  globalThis.window = {
    localStorage: { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) },
    dispatchEvent: () => true,
  };
  globalThis.CustomEvent ??= class { constructor(n) { this.type = n; } };
  try {
    mem.set('rp:apple-health:v1', JSON.stringify({ v: 1, ownerUserId: 'alice', connectedAt: 'x', lastReadAt: 'x', nights: shortNights }));
    assert.equal(store.loadAppleHealth('alice').nights.length, 7);
    assert.equal(store.loadAppleHealth('bob'), null, 'another account never sees it');
    assert.equal(mem.size, 0, 'and it is purged');
    mem.set('rp:apple-health:v1', JSON.stringify({ v: 1, ownerUserId: 'alice', connectedAt: 'x', lastReadAt: 'x', nights: shortNights }));
    store.clearAppleHealth();
    assert.equal(mem.size, 0);
    assert.equal(store.loadAppleHealth('alice'), null);
  } finally {
    delete globalThis.window;
  }
});
