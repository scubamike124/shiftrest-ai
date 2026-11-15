// Home "Today" summary: next shift, sleep window, next reminder, and one-off
// "my shift ran late" changes, all derived from the shared schedule engine.
import { test } from "node:test";
import assert from "node:assert/strict";
import { computeHomeSummary, parseOverrides, RECENT_END_MS } from "../src/lib/home-summary.ts";

const tz = "America/New_York";
const prefs = { sleepHours: 7, windDownMin: 45, cycleWeeks: 1, cycleAnchor: null };
// Monday (day 0) night shift 19:00 -> 07:00, and Wednesday day shift 07:00 -> 19:00.
const shifts = [
  { id: "mon-night", day: 0, weekIndex: 0, start: 19 * 60, end: 7 * 60, title: "ICU nights" },
  { id: "wed-day", day: 2, weekIndex: 0, start: 7 * 60, end: 19 * 60 },
];
// 2026-11-16 is a Monday. New York is UTC-5 in November.
const at = (iso) => new Date(iso);

test("before a shift: next shift, the sleep after it, and the next reminder", () => {
  const s = computeHomeSummary({ shifts, prefs, tz, now: at("2026-11-16T15:00:00Z") }); // Mon 10:00 local
  assert.equal(s.onShift, null);
  assert.equal(s.nextShift.id, "mon-night@2026-11-16");
  assert.equal(s.nextShift.startsAt.toISOString(), "2026-11-17T00:00:00.000Z"); // 19:00 local
  assert.equal(s.nextShift.endsAt.toISOString(), "2026-11-17T12:00:00.000Z"); // Tue 07:00 local
  // Sleep opens after shift end + wind-down and lasts the 7 h target.
  assert.equal(s.sleep.sleepStart.toISOString(), "2026-11-17T12:45:00.000Z");
  assert.equal(s.sleep.sleepEnd.getTime() - s.sleep.sleepStart.getTime(), 7 * 3_600_000);
  assert.ok(s.reminder && s.reminder.at.getTime() > Date.parse("2026-11-16T15:00:00Z"));
  assert.equal(s.changeTarget.id, "mon-night@2026-11-16");
});

test("during an overnight shift (crossing midnight) it is the shift in progress", () => {
  const s = computeHomeSummary({ shifts, prefs, tz, now: at("2026-11-17T06:30:00Z") }); // Tue 01:30 local
  assert.equal(s.onShift.id, "mon-night@2026-11-16");
  assert.equal(s.changeTarget.id, "mon-night@2026-11-16");
  assert.equal(s.nextShift.id, "wed-day@2026-11-18");
});

test("a shift that just ended can still be marked as extended", () => {
  const now = at("2026-11-17T13:00:00Z"); // Tue 08:00 local, 1 h after the night shift ended
  const s = computeHomeSummary({ shifts, prefs, tz, now });
  assert.equal(s.onShift, null);
  assert.equal(s.changeTarget.id, "mon-night@2026-11-16");
  assert.ok(RECENT_END_MS >= 3_600_000);
});

test("'ran late' override moves the sleep window and is reported as changed", () => {
  const now = at("2026-11-17T11:00:00Z"); // Tue 06:00 local, on shift
  const base = computeHomeSummary({ shifts, prefs, tz, now });
  const overrides = [
    {
      kind: "extend",
      shiftId: "mon-night@2026-11-16",
      endsAt: "2026-11-17T14:00:00.000Z",
      savedAt: now.toISOString(),
    },
  ];
  const s = computeHomeSummary({ shifts, prefs, tz, now, overrides });
  assert.deepEqual(s.changedShiftIds, ["mon-night@2026-11-16"]);
  assert.equal(s.onShift.endsAt.toISOString(), "2026-11-17T14:00:00.000Z");
  assert.equal(s.sleep.sleepStart.getTime() - base.sleep.sleepStart.getTime(), 2 * 3_600_000);
});

test("cancel override removes the shift; stale overrides are ignored", () => {
  const now = at("2026-11-16T15:00:00Z");
  const s = computeHomeSummary({
    shifts,
    prefs,
    tz,
    now,
    overrides: [
      { kind: "cancel", shiftId: "mon-night@2026-11-16", savedAt: now.toISOString() },
      {
        kind: "extend",
        shiftId: "gone@2026-01-01",
        endsAt: "2026-01-02T00:00:00Z",
        savedAt: now.toISOString(),
      },
    ],
  });
  assert.equal(s.nextShift.id, "wed-day@2026-11-18");
  assert.deepEqual(s.changedShiftIds, ["mon-night@2026-11-16"]);
});

test("no shifts: nothing scheduled, no crash", () => {
  const s = computeHomeSummary({ shifts: [], prefs, tz, now: at("2026-11-16T15:00:00Z") });
  assert.equal(s.nextShift, null);
  assert.equal(s.sleep, null);
  assert.equal(s.reminder, null);
  assert.equal(s.changeTarget, null);
});

test("DST: a sleep window across the fall-back change is still 7 real hours", () => {
  // 2026-11-01 02:00 New York falls back. Saturday (day 5) night shift 19:00 -> 07:00 Sunday.
  const dst = [{ id: "sat-night", day: 5, weekIndex: 0, start: 19 * 60, end: 7 * 60 }];
  const s = computeHomeSummary({ shifts: dst, prefs, tz, now: at("2026-10-31T16:00:00Z") });
  assert.equal(s.sleep.sleepEnd.getTime() - s.sleep.sleepStart.getTime(), 7 * 3_600_000);
});

test("stored overrides are validated and expire", () => {
  const now = new Date("2026-11-17T12:00:00Z");
  const ok = {
    kind: "extend",
    shiftId: "a@2026-11-16",
    endsAt: "2026-11-17T14:00:00Z",
    savedAt: "2026-11-17T11:00:00Z",
  };
  const old = { ...ok, shiftId: "b", savedAt: "2026-11-10T00:00:00Z" };
  const bad = [
    { kind: "extend", shiftId: 5 },
    { kind: "explode", shiftId: "x", savedAt: ok.savedAt },
    null,
    "x",
  ];
  assert.deepEqual(parseOverrides(JSON.stringify([ok, old, ...bad]), now), [ok]);
  assert.deepEqual(parseOverrides("{", now), []);
  assert.deepEqual(parseOverrides('{"a":1}', now), []);
});

test("back-to-back rotation: the shift about to start comes first, yesterday's is offered second", () => {
  // 07:00-19:00 every day; at 06:30 the previous shift ended 11.5 h ago.
  const daily = [0, 1, 2, 3, 4, 5, 6].map((day) => ({
    id: `s${day}`,
    day,
    weekIndex: 0,
    start: 7 * 60,
    end: 19 * 60,
  }));
  const s = computeHomeSummary({
    shifts: daily,
    prefs,
    tz: "UTC",
    now: new Date("2026-11-16T06:30:00Z"),
  });
  assert.equal(s.changeTarget.id, "s0@2026-11-16");
  assert.deepEqual(
    s.changeCandidates.map((c) => c.id),
    ["s0@2026-11-16", "s6@2026-11-15"],
  );
  // An hour after clock-out, the shift that just ended is the likelier one.
  const later = computeHomeSummary({
    shifts: daily,
    prefs,
    tz: "UTC",
    now: new Date("2026-11-16T20:00:00Z"),
  });
  assert.equal(later.changeTarget.id, "s0@2026-11-16");
});

test("a cancelled shift stays listed in appliedChanges (so Undo remains available)", () => {
  const now = at("2026-11-16T15:00:00Z");
  const s = computeHomeSummary({
    shifts,
    prefs,
    tz,
    now,
    overrides: [{ kind: "cancel", shiftId: "mon-night@2026-11-16", savedAt: now.toISOString() }],
  });
  assert.equal(s.appliedChanges.length, 1);
  assert.equal(s.appliedChanges[0].override.kind, "cancel");
  assert.equal(s.appliedChanges[0].original.startsAt.toISOString(), "2026-11-17T00:00:00.000Z");
  assert.notEqual(s.changeTarget.id, "mon-night@2026-11-16");
});
