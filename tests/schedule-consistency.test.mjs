// Every screen and the reminder engine must show the same times for the same
// shift, including on DST nights, in both hemispheres. Each case sets the
// runtime zone itself, so the host's TZ does not matter.
process.env.TZ = 'America/New_York';

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
import test from 'node:test';
import * as core from '../src/lib/schedule-core.ts';
import * as tz from '../src/lib/time/tz.ts';

// Load the real screen builders with their app imports replaced by the real
// shared module (and tiny stand-ins for shifts.ts helpers).
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const fmt = (min) => { const m = ((min % 1440) + 1440) % 1440; const h = Math.floor(m / 60); return `${((h + 11) % 12) + 1}:${String(m % 60).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`; };
const load = (path, names, extra = {}) => {
  const src = stripTypeScriptTypes(read(path)).replace(/^import[\s\S]*?;\n/gm, '').replace(/^export /gm, '');
  const ctx = vm.createContext({
    ...core, ...tz, Date, Math, Number, String, Intl, Object, Array, Set, Map,
    detectDeviceTz: () => Intl.DateTimeFormat().resolvedOptions().timeZone,
    DAYS: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'], fmt,
    endAbsolute: (s) => (s.end <= s.start ? s.end + 1440 : s.end),
    ...extra,
  });
  return vm.runInContext(`${src}\n({${names.join(',')}})`, ctx);
};
const engine = load('src/lib/sleep-engine.ts', ['buildLightPlan', 'sunTimes', 'sunriseAfter']);
const schedule = load('src/lib/schedule.ts', ['buildLongClock', 'weekIndexFor'], { sunTimes: engine.sunTimes, sunriseAfter: engine.sunriseAfter });
const recs = load('src/lib/recommendations.ts', ['buildRecommendations'], { sunTimes: engine.sunTimes });
const clock = load('src/lib/clock-bands.ts', ['buildClockBands']);
const notif = load('src/lib/notifications/schedule.ts', ['computeDueReminders']);

const prefs = { sleepHours: 8, windDownMin: 120, cycleWeeks: 1, cycleAnchor: null, currentTz: null };
const minuteOf = (d) => d.getHours() * 60 + d.getMinutes();
const NOTIF = { enabled: true, wind_down: true, caffeine_cutoff: true, bright_light: true, shift_start: true, shift_end_recovery: true, smart_alarm: false, commute: false, calendar: false, quiet_start: '00:00:00', quiet_end: '00:00:00', daily_cap: 99 };

/** Every reminder the server cron would send in the 48h after `from`. */
function cronReminders(shifts, from, zone) {
  const out = [];
  for (let t = from.getTime(); t < from.getTime() + 48 * 3_600_000; t += 5 * 60_000) {
    for (const r of notif.computeDueReminders({ shifts, prefs, notif: { ...NOTIF, timezone: zone }, events: [], now: new Date(t) })) out.push(r);
  }
  const byKind = {};
  for (const r of out) (byKind[r.kind] ??= []).push(r.scheduledFor.getTime());
  for (const k of Object.keys(byKind)) assert.equal(new Set(byKind[k]).size, 1, `cron sent exactly one ${k}`);
  return Object.fromEntries(Object.entries(byKind).map(([k, v]) => [k, new Date(v[0])]));
}

const CASES = [
  // [zone, label, Y, M(1-12), D, shift]
  ['America/New_York', 'ordinary day shift', 2026, 6, 15, { start: 7 * 60, end: 19 * 60 }],
  ['America/New_York', 'ordinary night shift', 2026, 6, 15, { start: 23 * 60, end: 7 * 60 }],
  ['America/New_York', '00:30 start', 2026, 6, 15, { start: 30, end: 8 * 60 + 30 }],
  ['America/New_York', 'evening shift into fall-back night', 2026, 10, 31, { start: 15 * 60, end: 23 * 60 }],
  ['America/New_York', 'night shift across fall-back', 2026, 10, 31, { start: 19 * 60, end: 7 * 60 }],
  ['America/New_York', 'night shift across spring-forward', 2026, 3, 7, { start: 19 * 60, end: 7 * 60 }],
  ['Australia/Sydney', 'night shift across fall-back (April)', 2026, 4, 4, { start: 19 * 60, end: 7 * 60 }],
  ['Australia/Sydney', 'evening shift into spring-forward (October)', 2026, 10, 3, { start: 15 * 60, end: 23 * 60 + 30 }],
  ['Australia/Sydney', 'ordinary 00:30 start', 2026, 6, 15, { start: 30, end: 8 * 60 + 30 }],
];

for (const [zone, label, y, m, d, times] of CASES) {
  test(`all screens and reminders agree: ${zone} ${label}`, () => {
    process.env.TZ = zone;
    const date = new Date(y, m - 1, d);
    const weekday = (date.getDay() + 6) % 7;
    const shift = { id: 's', day: weekday, weekIndex: 0, ...times };
    const inst = core.anchorInstants(shift, prefs, { y, m, d }, zone);
    const want = {
      wake: minuteOf(inst.wake), meal: minuteOf(inst.meal), caffeineOn: minuteOf(inst.caffeineOn),
      cutoff: minuteOf(inst.caffeineCutoff), windDown: minuteOf(inst.windDownStart),
      sleepStart: minuteOf(inst.sleepStart), sleepEnd: minuteOf(inst.sleepEnd),
    };

    // Plan screen
    const plan = Object.fromEntries(engine.buildLightPlan(shift, prefs, undefined, { date }).map((e) => [e.kind, e]));
    assert.equal(plan.wake.time, want.wake, 'plan wake');
    assert.equal(plan.meal.time, want.meal, 'plan meal');
    assert.equal(plan['caffeine-on'].time, want.caffeineOn, 'plan caffeine-on');
    assert.equal(plan['caffeine-cutoff'].time, want.cutoff, 'plan cutoff');
    assert.equal(plan['shift-end'].time, want.windDown, 'plan wind-down');
    assert.equal(plan.blackout.time, want.sleepStart, 'plan sleep start');
    assert.match(plan.blackout.detail, new RegExp(`Sleep until ${fmt(want.sleepEnd)}`), 'plan sleep end');

    // 7-day plan
    const lc = Object.fromEntries(schedule.buildLongClock(shift, date, prefs).map((e) => [e.kind, e.at]));
    for (const [kind, key] of [['wake', 'wake'], ['meal', 'meal'], ['caffeine-on', 'caffeineOn'], ['caffeine-cutoff', 'cutoff'], ['wind-down', 'windDown'], ['blackout', 'sleepStart'], ['recovery', 'sleepEnd']]) {
      assert.equal(minuteOf(lc[kind]), want[key], `7-day ${kind}`);
    }
    assert.equal(lc.blackout.getTime(), inst.sleepStart.getTime());
    assert.equal(lc.recovery.getTime(), inst.sleepEnd.getTime());

    // Dashboard Long Clock (behaviour, not source)
    const { bands, markers } = clock.buildClockBands({ shift, prefs, now: date, tz: zone, sunrise: null, sunset: null });
    const band = Object.fromEntries(bands.map((b) => [b.id, b]));
    const mark = Object.fromEntries(markers.map((x) => [x.id, x]));
    assert.equal(band.light.start, want.wake, 'clock light');
    assert.equal(band.wind.start, want.windDown, 'clock wind');
    assert.equal(band.sleep.start, want.sleepStart, 'clock sleep start');
    assert.equal(band.sleep.end, want.sleepEnd, 'clock sleep end');
    assert.equal(mark.caffeine.at, want.cutoff, 'clock cutoff');
    assert.equal(mark.alarm.at, want.sleepEnd, 'clock alarm');

    // Recommendations (ask at the start of the shift day; return them all)
    const insights = { todayShift: shift, nextShift: undefined, fatigueToday: { band: 'low' }, sleepDebtHours: 0, hrvTrend: null };
    const r = Object.fromEntries(recs.buildRecommendations(insights, prefs, date, undefined, 50).map((x) => [x.kind, x]));
    for (const kind of ['bright-light', 'meal', 'caffeine-on', 'caffeine-cutoff', 'wind-down', 'anchor-sleep']) assert.ok(r[kind], `recommendation ${kind} present`);
    const nowMin = 0;
    const at = (x) => (nowMin + x.whenMinutes) % 1440;
    assert.equal(at(r['bright-light']), want.wake, 'rec bright light');
    assert.equal(at(r.meal), want.meal, 'rec meal');
    assert.equal(at(r['caffeine-on']), want.caffeineOn, 'rec caffeine-on');
    assert.equal(at(r['caffeine-cutoff']), want.cutoff, 'rec cutoff');
    assert.equal(at(r['wind-down']), want.windDown, 'rec wind-down');
    assert.equal(at(r['anchor-sleep']), want.sleepStart, 'rec sleep');
    assert.match(r['anchor-sleep'].detail, new RegExp(`→ ${fmt(want.sleepEnd)}`), 'rec sleep end');

    // Server reminders (the cron), run every 5 minutes across the period
    const cron = cronReminders([shift], new Date(inst.wake.getTime() - 60 * 60_000), zone);
    assert.equal(cron['bright-light'].getTime(), inst.wake.getTime(), 'cron bright light');
    assert.equal(cron['shift-start'].getTime(), inst.shiftStart.getTime() - 15 * 60_000, 'cron shift start');
    assert.equal(cron['shift-end-recovery'].getTime(), inst.shiftEnd.getTime(), 'cron shift end');
    assert.equal(cron['wind-down'].getTime(), inst.windDownStart.getTime(), 'cron wind-down');
    assert.equal(cron['caffeine-cutoff'].getTime(), inst.caffeineCutoff.getTime() - 10 * 60_000, 'cron cutoff (10 min lead)');
  });
}

test('every screen explains its times', () => {
  process.env.TZ = 'America/New_York';
  const plan = engine.buildLightPlan({ start: 23 * 60, end: 7 * 60 }, prefs, { sunrise: 6 * 60, sunset: 20 * 60 });
  for (const e of plan.filter((x) => x.kind !== 'shift-start')) assert.ok(e.why, e.kind);
  const lc = schedule.buildLongClock({ start: 23 * 60, end: 7 * 60 }, new Date(2026, 5, 15), prefs, { sunrise: 6 * 60, sunset: 20 * 60 });
  for (const e of lc.filter((x) => !['shift-start', 'shift-end'].includes(x.kind))) assert.ok(e.why, e.kind);
  const { bands, markers } = clock.buildClockBands({ shift: { start: 23 * 60, end: 7 * 60 }, prefs, now: new Date(2026, 5, 15), tz: 'America/New_York', sunrise: 6 * 60, sunset: 20 * 60 });
  for (const b of [...bands, ...markers].filter((x) => x.id !== 'work')) assert.ok(b.reason.length > 40, b.id);
});

test('after a 23:00 night shift the amber-glasses sunrise is the NEXT morning', () => {
  const lc = schedule.buildLongClock({ start: 23 * 60, end: 7 * 60 }, new Date(2026, 5, 15), prefs, { sunrise: 5 * 60 + 30, sunset: 20 * 60 });
  assert.equal(lc.find((e) => e.kind === 'amber-light').at.getDate(), 16);
  const order = engine.buildLightPlan({ start: 23 * 60, end: 7 * 60 }, prefs, { sunrise: 5 * 60 + 30, sunset: 20 * 60 }).map((e) => e.kind);
  assert.ok(order.indexOf('shift-start') < order.indexOf('amber') && order.indexOf('amber') < order.indexOf('shift-end'));
});

test('dashboard Long Clock: no 8h cutoff, and no sunrise light band on a shift day', () => {
  const { bands, markers } = clock.buildClockBands({ shift: { start: 23 * 60, end: 7 * 60 }, prefs, now: new Date(2026, 5, 15), tz: 'America/New_York', sunrise: 5 * 60 + 30, sunset: 20 * 60 });
  const light = bands.find((b) => b.id === 'light');
  assert.equal(light.start, 21 * 60 + 30); // wake, not sunrise
  assert.ok(markers.find((x) => x.id === 'amber'), 'amber glasses at sunrise after a night shift');
  const caff = markers.find((x) => x.id === 'caffeine');
  assert.equal(caff.at, (7 * 60 + 120 - 360 + 1440) % 1440);
  const off = clock.buildClockBands({ prefs, now: new Date(2026, 5, 15), tz: 'America/New_York', sunrise: 5 * 60 + 30, sunset: 20 * 60 });
  assert.equal(off.bands.find((b) => b.id === 'light').start, 5 * 60 + 30); // day off keeps sunrise daylight
});

test('rotation: the 7-day plan and the core use one week-index rule', () => {
  for (let i = 0; i < 60; i++) {
    const date = new Date(2026, 9, 1 + i); // spans the fall-back change
    const c = core.localCivilDate(date);
    const day = core.civilDay(c.y, c.m, c.d);
    assert.equal(schedule.weekIndexFor(date, '2026-10-05', 3), core.rotationWeekIndex(day, '2026-10-05', 3));
  }
});

test('the in-app wind-down notification fires AT clock-out, like every screen', async () => {
  process.env.TZ = 'America/New_York';
  const shift = { id: 'tmpl', day: 0, weekIndex: 0, start: 7 * 60, end: 19 * 60 };
  const { nextWindDownAt } = load('src/lib/notify.ts', ['nextWindDownAt'], {
    fetchShifts: async () => [shift],
    fetchPrefs: async () => prefs,
  });
  const next = await nextWindDownAt(new Date(2026, 5, 15, 12, 0)); // Monday noon
  assert.equal(next.at.getTime(), new Date(2026, 5, 15, 19, 0).getTime());
  assert.equal(next.shift.id, 'tmpl');
  // Rotation-aware: a week-B-only shift does not fire in week A.
  const rotating = load('src/lib/notify.ts', ['nextWindDownAt'], {
    fetchShifts: async () => [{ ...shift, weekIndex: 1 }],
    fetchPrefs: async () => ({ ...prefs, cycleWeeks: 2, cycleAnchor: '2026-06-15' }),
  });
  const r = await rotating.nextWindDownAt(new Date(2026, 5, 15, 12, 0));
  assert.equal(r.at.getTime(), new Date(2026, 5, 22, 19, 0).getTime());
});
