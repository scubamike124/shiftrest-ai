import assert from 'node:assert/strict';
import test from 'node:test';
import {
  SCHEDULE_RULES, shiftAnchors, minuteOfDay, buildSchedule, buildSleepPlan, buildReminders,
  applyShiftChange, rotationWeekIndex, ShiftChangeError,
} from '../src/lib/schedule-core.ts';
import { utcFromLocal } from '../src/lib/time/tz.ts';

const NY = 'America/New_York';
const prefs = { sleepHours: 8, windDownMin: 120 };
const iso = (d) => d.toISOString();
const at = (y, m, d, min, tz = NY) => utcFromLocal(y, m, d, min, tz);
const H = 3_600_000;

// ── Anchors (minute-of-day layer) ───────────────────────────────────────
test('night shift 19:00-07:00 crosses midnight: sleep, cutoff and wake agree', () => {
  const a = shiftAnchors({ start: 19 * 60, end: 7 * 60 }, prefs);
  assert.equal(a.shiftEnd, 1440 + 7 * 60);
  assert.equal(minuteOfDay(a.windDownStart), 7 * 60);
  assert.equal(minuteOfDay(a.sleepStart), 9 * 60);
  assert.equal(minuteOfDay(a.sleepEnd), 17 * 60);
  assert.equal(minuteOfDay(a.caffeineCutoff), 3 * 60); // 6h before 09:00
  assert.equal(minuteOfDay(a.wake), 17 * 60 + 30);
  assert.equal(minuteOfDay(a.caffeineOn), 18 * 60 + 30);
  assert.equal(a.isNight, false); // 19:00 start is an evening start by the shared rule
});

test('shift starting 00:30 puts wake and meal on the previous evening', () => {
  const a = shiftAnchors({ start: 30, end: 8 * 60 + 30 }, prefs);
  assert.equal(a.isNight, true);
  assert.equal(a.wake, -60);
  assert.equal(minuteOfDay(a.wake), 23 * 60);
  assert.equal(minuteOfDay(a.meal), 23 * 60 + 15);
});

test('caffeine cutoff is always 6h before sleep (one rule for every screen)', () => {
  assert.equal(SCHEDULE_RULES.caffeineCutoffBeforeSleepMin, 360);
  for (const s of [{ start: 420, end: 1140 }, { start: 1380, end: 420 }, { start: 900, end: 60 }]) {
    const a = shiftAnchors(s, prefs);
    assert.equal(a.sleepStart - a.caffeineCutoff, 360);
  }
});

// ── Rotation ───────────────────────────────────────────────────────────
test('rotation week index alternates by Monday-anchored week', () => {
  const day = (y, m, d) => Math.floor(Date.UTC(y, m - 1, d) / 86_400_000);
  assert.equal(rotationWeekIndex(day(2026, 11, 2), '2026-11-02', 2), 0); // Monday
  assert.equal(rotationWeekIndex(day(2026, 11, 8), '2026-11-02', 2), 0); // Sunday same week
  assert.equal(rotationWeekIndex(day(2026, 11, 9), '2026-11-02', 2), 1);
  assert.equal(rotationWeekIndex(day(2026, 11, 16), '2026-11-02', 2), 0);
  assert.equal(rotationWeekIndex(day(2026, 10, 26), '2026-11-02', 2), 1); // before anchor
  assert.equal(rotationWeekIndex(day(2026, 11, 23), '2026-11-04', 3), 0); // mid-week anchor
  assert.equal(rotationWeekIndex(day(2026, 11, 9), null, 1), 0);
});

test('two-week rotation expands A and B weeks to the right dates', () => {
  const shifts = [
    { id: 'a', day: 0, weekIndex: 0, start: 7 * 60, end: 19 * 60 }, // Mon week A day
    { id: 'b', day: 0, weekIndex: 1, start: 19 * 60, end: 7 * 60 }, // Mon week B night
  ];
  const s = buildSchedule({ shifts, tz: NY, from: at(2026, 11, 2, 0), days: 14, cycleAnchor: '2026-11-02', cycleWeeks: 2 });
  assert.deepEqual(s.shifts.map((x) => x.id), ['a@2026-11-02', 'b@2026-11-09']);
  assert.equal(iso(s.shifts[1].endsAt), iso(at(2026, 11, 10, 7 * 60)));
});

test('overnight shift that started yesterday is still in the schedule', () => {
  const shifts = [{ id: 'n', day: 6, start: 23 * 60, end: 7 * 60 }]; // Sunday 23:00
  const s = buildSchedule({ shifts, tz: NY, from: at(2026, 6, 15, 2 * 60), days: 1 }); // Mon 02:00
  assert.equal(s.shifts.length, 1);
  assert.equal(s.shifts[0].id, 'n@2026-06-14');
});

// ── DST ────────────────────────────────────────────────────────────────
test('fall-back night: 19:00-07:00 wall clock is 13h, sleep is still 8h elapsed', () => {
  const shifts = [{ id: 'n', day: 5, start: 19 * 60, end: 7 * 60 }]; // Sat Oct 31 2026
  const s = buildSchedule({ shifts, tz: NY, from: at(2026, 10, 31, 12 * 60), days: 1 });
  const [shift] = s.shifts;
  assert.equal(shift.endsAt.getTime() - shift.startsAt.getTime(), 13 * H);
  assert.equal(iso(shift.endsAt), '2026-11-01T12:00:00.000Z'); // 07:00 EST
  const [sleep] = buildSleepPlan(s, prefs, at(2026, 10, 31, 12 * 60));
  assert.equal(iso(sleep.sleepStart), '2026-11-01T14:00:00.000Z'); // 09:00 EST
  assert.equal(sleep.sleepMinutes, 480);
  assert.equal(sleep.sleepEnd.getTime() - sleep.sleepStart.getTime(), 8 * H);
});

test('spring-forward night: 19:00-07:00 wall clock is 11h; cutoff is 6h elapsed before sleep', () => {
  const shifts = [{ id: 'n', day: 5, start: 19 * 60, end: 7 * 60 }]; // Sat Mar 7 2026
  const s = buildSchedule({ shifts, tz: NY, from: at(2026, 3, 7, 12 * 60), days: 1 });
  const [shift] = s.shifts;
  assert.equal(shift.endsAt.getTime() - shift.startsAt.getTime(), 11 * H);
  const [sleep] = buildSleepPlan(s, prefs, at(2026, 3, 7, 12 * 60));
  assert.equal(sleep.sleepStart.getTime() - sleep.caffeineCutoff.getTime(), 6 * H);
  assert.equal(iso(sleep.caffeineCutoff), '2026-03-08T07:00:00.000Z'); // 03:00 EDT (02:00 does not exist)
});

test('utcFromLocal resolves the hour after a DST change and normalizes negative minutes', () => {
  assert.equal(iso(at(2026, 3, 8, 3 * 60 + 30)), '2026-03-08T07:30:00.000Z'); // 03:30 EDT
  assert.equal(iso(at(2026, 3, 8, 2 * 60 + 30)), '2026-03-08T07:30:00.000Z'); // gap → 03:30 EDT
  assert.equal(iso(at(2026, 11, 1, 3 * 60)), '2026-11-01T08:00:00.000Z'); // 03:00 EST
  assert.equal(iso(at(2026, 6, 1, -30)), '2026-06-01T03:30:00.000Z'); // 23:30 EDT previous day
  assert.equal(iso(at(2026, 6, 1, 1500)), '2026-06-02T05:00:00.000Z');
});

// ── Reminders ──────────────────────────────────────────────────────────
test('reminders use the same anchors as the sleep plan', () => {
  const shifts = [{ id: 'd', day: 0, start: 7 * 60, end: 19 * 60 }];
  const now = at(2026, 6, 15, 0);
  const s = buildSchedule({ shifts, tz: NY, from: now, days: 1 });
  const r = Object.fromEntries(buildReminders(s, prefs, now).map((x) => [x.kind, x]));
  const [sleep] = buildSleepPlan(s, prefs, now);
  assert.equal(iso(r['bright-light'].at), iso(at(2026, 6, 15, 5 * 60 + 30)));
  assert.equal(iso(r['shift-start'].at), iso(at(2026, 6, 15, 6 * 60 + 45)));
  assert.equal(iso(r['caffeine-cutoff'].at), iso(sleep.caffeineCutoff));
  assert.equal(iso(r['wind-down'].at), iso(at(2026, 6, 15, 19 * 60)));
  assert.ok(r['caffeine-cutoff'].why.includes('6 hours'));
});

test('short turnaround trims the sleep window and leaves the wake lead', () => {
  const shifts = [
    { id: 'x', day: 0, start: 15 * 60, end: 23 * 60 },
    { id: 'y', day: 1, start: 7 * 60, end: 15 * 60 },
  ];
  const now = at(2026, 6, 15, 0);
  const s = buildSchedule({ shifts, tz: NY, from: now, days: 2 });
  const [first] = buildSleepPlan(s, prefs, now);
  assert.equal(first.shortTurnaround, true);
  assert.equal(iso(first.sleepStart), iso(at(2026, 6, 16, 60)));
  assert.equal(iso(first.sleepEnd), iso(at(2026, 6, 16, 5 * 60 + 30)));
  assert.equal(first.sleepMinutes, 270);
});

// ── One-tap overtime / shift change ────────────────────────────────────
const baseSchedule = () => buildSchedule({
  shifts: [
    { id: 'eve', day: 0, start: 15 * 60, end: 23 * 60 },
    { id: 'day', day: 1, start: 15 * 60, end: 23 * 60 },
  ],
  tz: NY, from: at(2026, 6, 15, 16 * 60), days: 2,
});
const now = at(2026, 6, 15, 16 * 60);

test('extension past midnight moves wind-down, sleep and cutoff; input is untouched', () => {
  const sched = baseSchedule();
  const res = applyShiftChange(sched, { kind: 'extend', shiftId: 'eve@2026-06-15', extraMinutes: 150 }, { prefs, now });
  assert.equal(iso(sched.shifts[0].endsAt), iso(at(2026, 6, 15, 23 * 60))); // pure
  assert.equal(iso(res.schedule.shifts[0].endsAt), iso(at(2026, 6, 16, 90))); // 01:30 next day
  const wind = res.reminders.find((r) => r.id === 'wind-down:eve@2026-06-15');
  assert.equal(iso(wind.at), iso(at(2026, 6, 16, 90)));
  const sleep = res.sleepPlan.find((p) => p.afterShiftId === 'eve@2026-06-15');
  assert.equal(iso(sleep.sleepStart), iso(at(2026, 6, 16, 3 * 60 + 30)));
  assert.equal(iso(sleep.caffeineCutoff), iso(at(2026, 6, 15, 21 * 60 + 30)));
  assert.match(res.summary, /150 min/);
  assert.deepEqual(res.cancelledReminderIds, []);
});

test('extension by explicit end time; shortening is refused', () => {
  const sched = baseSchedule();
  const res = applyShiftChange(sched, { kind: 'extend', shiftId: 'eve@2026-06-15', endsAt: at(2026, 6, 16, 60) }, { prefs, now });
  assert.equal(iso(res.schedule.shifts[0].endsAt), iso(at(2026, 6, 16, 60)));
  assert.throws(() => applyShiftChange(sched, { kind: 'extend', shiftId: 'eve@2026-06-15', endsAt: at(2026, 6, 15, 22 * 60) }, { prefs, now }), ShiftChangeError);
  assert.throws(() => applyShiftChange(sched, { kind: 'extend', shiftId: 'missing', extraMinutes: 30 }, { prefs, now }), ShiftChangeError);
});

test('cancelled shift removes its reminders and its sleep window', () => {
  const res = applyShiftChange(baseSchedule(), { kind: 'cancel', shiftId: 'day@2026-06-16' }, { prefs, now });
  assert.deepEqual(res.schedule.shifts.map((s) => s.id), ['eve@2026-06-15']);
  assert.ok(res.reminders.every((r) => r.shiftId !== 'day@2026-06-16'));
  assert.deepEqual(res.cancelledReminderIds.sort(), [
    'bright-light:day@2026-06-16', 'caffeine-cutoff:day@2026-06-16', 'shift-end-recovery:day@2026-06-16',
    'shift-start:day@2026-06-16', 'wind-down:day@2026-06-16',
  ]);
  assert.ok(res.sleepPlan.every((p) => p.afterShiftId !== 'day@2026-06-16'));
});

test('swapped shift: reminders follow the shift taken, not the one given away', () => {
  const take = { id: 'swap-1', startsAt: at(2026, 6, 16, 7 * 60), endsAt: at(2026, 6, 16, 15 * 60) };
  const res = applyShiftChange(baseSchedule(), { kind: 'swap', shiftId: 'day@2026-06-16', take }, { prefs, now });
  assert.deepEqual(res.schedule.shifts.map((s) => s.id), ['eve@2026-06-15', 'swap-1']);
  assert.equal(iso(res.reminders.find((r) => r.id === 'bright-light:swap-1').at), iso(at(2026, 6, 16, 5 * 60 + 30)));
  // The 07:00 swap is now a short turnaround after the 23:00 finish.
  assert.equal(res.sleepPlan.find((p) => p.afterShiftId === 'eve@2026-06-15').shortTurnaround, true);
});

test('reschedule ("shift changed") and add; overlaps are refused', () => {
  const sched = baseSchedule();
  const moved = applyShiftChange(sched, { kind: 'reschedule', shiftId: 'day@2026-06-16', startsAt: at(2026, 6, 16, 17 * 60), endsAt: at(2026, 6, 17, 60) }, { prefs, now });
  assert.equal(iso(moved.reminders.find((r) => r.id === 'wind-down:day@2026-06-16').at), iso(at(2026, 6, 17, 60)));
  const added = applyShiftChange(sched, { kind: 'add', shift: { id: 'ot', startsAt: at(2026, 6, 17, 7 * 60), endsAt: at(2026, 6, 17, 11 * 60) } }, { prefs, now });
  assert.equal(added.schedule.shifts.length, 3);
  assert.throws(() => applyShiftChange(sched, { kind: 'add', shift: { startsAt: at(2026, 6, 15, 22 * 60), endsAt: at(2026, 6, 16, 2 * 60) } }, { prefs, now }), /overlap/);
  assert.throws(() => applyShiftChange(sched, { kind: 'reschedule', shiftId: 'day@2026-06-16', endsAt: at(2026, 6, 16, 14 * 60) }, { prefs, now }), /end after/);
});

test('extension across the fall-back DST change keeps sleep 8h elapsed', () => {
  const sched = buildSchedule({ shifts: [{ id: 'n', day: 5, start: 19 * 60, end: 23 * 60 }], tz: NY, from: at(2026, 10, 31, 12 * 60), days: 1 });
  // Extended to 02:30 EST on Nov 1 (wall clock passes 01:00-02:00 twice).
  const endsAt = at(2026, 11, 1, 2 * 60 + 30);
  const res = applyShiftChange(sched, { kind: 'extend', shiftId: 'n@2026-10-31', endsAt }, { prefs, now: at(2026, 10, 31, 20 * 60) });
  assert.equal(res.schedule.shifts[0].endsAt.getTime() - sched.shifts[0].endsAt.getTime(), 4.5 * H); // 23:00 EDT → 02:30 EST
  const [sleep] = res.sleepPlan;
  assert.equal(sleep.sleepEnd.getTime() - sleep.sleepStart.getTime(), 8 * H);
  assert.equal(iso(sleep.sleepStart), '2026-11-01T09:30:00.000Z'); // 04:30 EST
});

test('past reminders are never returned', () => {
  const res = applyShiftChange(baseSchedule(), { kind: 'extend', shiftId: 'eve@2026-06-15', extraMinutes: 60 }, { prefs, now });
  assert.ok(res.reminders.every((r) => r.at.getTime() > now.getTime()));
  assert.ok(!res.reminders.some((r) => r.id === 'bright-light:eve@2026-06-15'));
});
