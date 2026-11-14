import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
import test from 'node:test';
import * as core from '../src/lib/schedule-core.ts';
import * as tz from '../src/lib/time/tz.ts';

// Load the real screen builders with their app imports replaced by the real
// shared module (and tiny stand-ins for shifts.ts helpers), then check that
// every screen shows the same times for the same shift.
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const load = (path, names, extra = {}) => {
  const src = stripTypeScriptTypes(read(path)).replace(/^import[\s\S]*?;\n/gm, '').replace(/^export /gm, '');
  const fmt = (min) => { const m = ((min % 1440) + 1440) % 1440; const h = Math.floor(m / 60); return `${((h + 11) % 12) + 1}:${String(m % 60).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`; };
  const ctx = vm.createContext({
    ...core, ...tz, Date, Math, Number, String, Intl,
    DAYS: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'], fmt,
    endAbsolute: (s) => (s.end <= s.start ? s.end + 1440 : s.end),
    ...extra,
  });
  return vm.runInContext(`${src}\n({${names.join(',')}})`, ctx);
};
const engine = load('src/lib/sleep-engine.ts', ['buildLightPlan', 'sunTimes', 'sunriseAfter']);
const schedule = load('src/lib/schedule.ts', ['buildLongClock'], { sunTimes: engine.sunTimes, sunriseAfter: engine.sunriseAfter });
const recs = load('src/lib/recommendations.ts', ['buildRecommendations'], { sunTimes: engine.sunTimes });

const prefs = { sleepHours: 7.5, windDownMin: 60, cycleWeeks: 1, cycleAnchor: null, currentTz: 'UTC' };
const minuteOf = (d) => d.getHours() * 60 + d.getMinutes();

for (const shift of [
  { id: 's1', day: 0, weekIndex: 0, start: 7 * 60, end: 19 * 60 },
  { id: 's2', day: 0, weekIndex: 0, start: 23 * 60, end: 7 * 60 },
  { id: 's3', day: 0, weekIndex: 0, start: 30, end: 8 * 60 + 30 },
  { id: 's4', day: 0, weekIndex: 0, start: 15 * 60, end: 23 * 60 + 30 },
]) {
  test(`Plan, Long Clock / 7-day plan and recommendations agree for ${shift.start}-${shift.end}`, () => {
    const a = core.shiftAnchors(shift, prefs);
    const want = {
      wake: core.minuteOfDay(a.wake), meal: core.minuteOfDay(a.meal), 'caffeine-on': core.minuteOfDay(a.caffeineOn),
      'caffeine-cutoff': core.minuteOfDay(a.caffeineCutoff), sleep: core.minuteOfDay(a.sleepStart), 'wind-down': core.minuteOfDay(a.windDownStart),
    };
    const plan = Object.fromEntries(engine.buildLightPlan(shift, prefs).map((e) => [e.kind, e.time]));
    assert.equal(plan.wake, want.wake); assert.equal(plan.meal, want.meal); assert.equal(plan['caffeine-on'], want['caffeine-on']);
    assert.equal(plan['caffeine-cutoff'], want['caffeine-cutoff']); assert.equal(plan.blackout, want.sleep); assert.equal(plan['shift-end'], want['wind-down']);

    const lc = Object.fromEntries(schedule.buildLongClock(shift, new Date(2026, 5, 15), prefs).map((e) => [e.kind, minuteOf(e.at)]));
    assert.equal(lc.wake, want.wake); assert.equal(lc.meal, want.meal); assert.equal(lc['caffeine-on'], want['caffeine-on']);
    assert.equal(lc['caffeine-cutoff'], want['caffeine-cutoff']); assert.equal(lc.blackout, want.sleep); assert.equal(lc['wind-down'], want['wind-down']);

    const insights = { todayShift: shift, nextShift: undefined, fatigueToday: { band: 'low' }, sleepDebtHours: 0, hrvTrend: null };
    // Ask at 00:00 so every recommendation is still in the next 24h.
    const all = recs.buildRecommendations(insights, prefs, new Date(2026, 5, 15, 0, 0));
    const r = Object.fromEntries(all.map((x) => [x.kind, x]));
    for (const [kind, key] of [['caffeine-on', 'caffeine-on'], ['wind-down', 'wind-down'], ['anchor-sleep', 'sleep']]) {
      if (r[kind]) assert.equal(r[kind].whenMinutes, want[key], kind);
    }
    if (r['caffeine-cutoff']) assert.match(r['caffeine-cutoff'].detail, new RegExp(engine.buildLightPlan(shift, prefs).find((e) => e.kind === 'caffeine-cutoff').detail.match(/by (.*) so/)[1]));
  });
}

test('every screen explains its times', () => {
  const plan = engine.buildLightPlan({ start: 23 * 60, end: 7 * 60 }, prefs, { sunrise: 6 * 60, sunset: 20 * 60 });
  for (const e of plan.filter((x) => x.kind !== 'shift-start')) assert.ok(e.why, e.kind);
  const lc = schedule.buildLongClock({ start: 23 * 60, end: 7 * 60 }, new Date(2026, 5, 15), prefs, { sunrise: 6 * 60, sunset: 20 * 60 });
  for (const e of lc.filter((x) => !['shift-start', 'shift-end'].includes(x.kind))) assert.ok(e.why, e.kind);
});

test('after a 23:00 night shift the amber-glasses sunrise is the NEXT morning', () => {
  const lc = schedule.buildLongClock({ start: 23 * 60, end: 7 * 60 }, new Date(2026, 5, 15), prefs, { sunrise: 5 * 60 + 30, sunset: 20 * 60 });
  const amber = lc.find((e) => e.kind === 'amber-light');
  assert.equal(amber.at.getDate(), 16);
  const plan = engine.buildLightPlan({ start: 23 * 60, end: 7 * 60 }, prefs, { sunrise: 5 * 60 + 30, sunset: 20 * 60 });
  const order = plan.map((e) => e.kind);
  assert.ok(order.indexOf('shift-start') < order.indexOf('amber') && order.indexOf('amber') < order.indexOf('shift-end'));
});

test('dashboard Long Clock uses the shared anchors (no 8h cutoff, no sunrise light after nights)', () => {
  const src = read('src/components/LongClock.tsx');
  assert.match(src, /shiftAnchors\(shift, prefs\)/);
  assert.doesNotMatch(src, /8 \* 60/);
  assert.doesNotMatch(src, /8h half-life/);
});
