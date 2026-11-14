import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
import test from 'node:test';
import * as core from '../src/lib/schedule-core.ts';
import * as tz from '../src/lib/time/tz.ts';

// Issue 1: estimates must be labelled, and wearable readings must never be
// invented or reused when stale.
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const strip = (p) => stripTypeScriptTypes(read(p)).replace(/^import[\s\S]*?;\n/gm, '').replace(/^export /gm, '');
const endAbsolute = (s) => (s.end <= s.start ? s.end + 1440 : s.end);
const ctx = vm.createContext({ ...core, ...tz, Date, Math, Number, String, Intl, DAYS: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'], endAbsolute, fmt: String });
vm.runInContext(strip('src/lib/sleep-engine.ts'), ctx);
vm.runInContext(strip('src/lib/schedule.ts'), ctx);
const { computeInsights } = vm.runInContext(`${strip('src/lib/insights.ts')}\n({computeInsights})`, ctx);

const prefs = { sleepHours: 8, windDownMin: 60, cycleWeeks: 1, cycleAnchor: null };
const shifts = [{ id: 'n', day: 0, weekIndex: 0, start: 23 * 60, end: 7 * 60 }];
const now = new Date(2026, 10, 16, 12, 0); // Monday
const night = (date, min) => ({ provider: 'oura', date, sleepDurationMin: min, sleepEfficiency: 0.9, hrvMs: 40, restingHr: 55 });

test('without wearable data, sleep debt is unknown and the AI is told not to invent readings', () => {
  const i = computeInsights(shifts, prefs, now);
  assert.equal(i.dataSources.sleepNights, 0);
  assert.equal(i.dataSources.wearableProvider, null);
  assert.equal(i.sleepDebtHours, 0);
  assert.match(i.contextString, /shifts entered by the user only/);
  assert.match(i.contextString, /Do not state or guess any sleep duration, HRV, heart rate, readiness/);
  assert.doesNotMatch(i.contextString, /Last night \(/);
});

test('a recent night is used and labelled with its provider and night count', () => {
  const i = computeInsights(shifts, prefs, now, [], night('2026-11-16', 300));
  assert.equal(i.dataSources.wearableProvider, 'oura');
  assert.equal(i.dataSources.sleepNights, 1);
  assert.equal(i.sleepDebtHours, 3);
  assert.match(i.contextString, /Last night \(oura, 2026-11-16\)/);
  assert.match(i.contextString, /over 1 night of wearable data/);
  assert.ok(i.signals.some((s) => /over the last 1 night of wearable data/.test(s)));
  assert.ok(!i.signals.some((s) => /last 7 nights/.test(s)), 'one night must not be called 7 nights');
});

test('a stale wearable reading is not treated as last night', () => {
  const i = computeInsights(shifts, prefs, now, [], night('2026-10-01', 240));
  assert.equal(i.dataSources.sleepNights, 0);
  assert.equal(i.dataSources.wearableStale, true);
  assert.equal(i.sleepDebtHours, 0);
  assert.doesNotMatch(i.contextString, /Last night/);
  assert.match(i.contextString, /older than 2 days/);
  const fresh = computeInsights(shifts, prefs, now);
  assert.equal(i.fatigueToday.score, fresh.fatigueToday.score, 'stale data must not change the estimate');
});

test('working schedule-based calculations are unchanged when no wearable data exists', () => {
  const i = computeInsights(shifts, prefs, now);
  // Monday night shift: 45 (night) with no carry-over; recovery blends circadian debt.
  assert.equal(i.fatigueToday.score, 45);
  assert.equal(i.fatigueToday.band, 'moderate');
  assert.equal(i.recoveryScore, Math.round(100 - 9 * 0.45 - 45 * 0.35));
});

test('screens label estimates and their sources', () => {
  const brief = read('src/components/AIBriefCard.tsx');
  assert.match(brief, /Estimates, not measurements\./);
  assert.match(brief, /sleep debt unknown \(no recent wearable sleep data\)/);
  assert.match(read('src/components/home/CompanionHero.tsx'), /Schedule strain .* estimates/);
  assert.doesNotMatch(read('src/components/home/CompanionHero.tsx'), /Sleep debt \{/);
  assert.match(read('src/routes/dashboard.tsx'), /Not a sleep measurement\./);
  assert.match(read('src/components/home/HydrationCard.tsx'), /Logged by you/);
  assert.match(read('src/routes/health.tsx'), /Measured by your wearable/);
});

test('AI recap never shows an invented readiness number and gates sleep numbers on real data', () => {
  const card = read('src/components/DailyReviewCard.tsx');
  assert.doesNotMatch(card, /readinessDelta[^\n]*&&/);
  assert.match(card, /hasWearableSleep && data\.metrics\.sleepRecoveredMin != null/);
  assert.match(card, /AI-written/);
  assert.match(read('src/routes/dashboard.tsx'), /hasWearableSleep=\{\(insights\?\.dataSources\.sleepNights \?\? 0\) > 0\}/);
});
