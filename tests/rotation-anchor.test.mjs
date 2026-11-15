// A 2-6 week rotation must advance from week to week even when the user
// never saved a "Week A starts" date (prefs.cycleAnchor === null).
process.env.TZ = "America/New_York";

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import vm from "node:vm";
import * as core from "../src/lib/schedule-core.ts";
import * as tz from "../src/lib/time/tz.ts";

const src = stripTypeScriptTypes(
  readFileSync(new URL("../src/lib/schedule.ts", import.meta.url), "utf8"),
)
  .replace(/^import[\s\S]*?;\n/gm, "")
  .replace(/^export /gm, "");
const ctx = vm.createContext({
  ...core,
  ...tz,
  Date,
  Math,
  Number,
  String,
  Intl,
  Object,
  Array,
  Set,
  Map,
  sunTimes: () => ({ sunrise: null, sunset: null }),
  sunriseAfter: () => null,
  detectDeviceTz: () => "America/New_York",
});
const { weekIndexFor, shiftsForDate, mondayIso } = vm.runInContext(
  `${src}\n({ weekIndexFor, shiftsForDate, mondayIso })`,
  ctx,
);
const addDays = (d, n) => {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
};

test("without an anchor, the current week is Week A and the next week is Week B", () => {
  const today = new Date();
  assert.equal(weekIndexFor(today, null, 2), 0);
  assert.equal(weekIndexFor(addDays(today, 7), null, 2), 1);
  assert.equal(weekIndexFor(addDays(today, 14), null, 2), 0);
  assert.equal(weekIndexFor(addDays(today, 7), undefined, 3), 1);
  assert.equal(weekIndexFor(addDays(today, 14), undefined, 3), 2);
});

test("rotationWeekIndex falls back to the week of `today`, not of `day`", () => {
  const day = (y, m, d) => core.civilDay(y, m, d);
  const today = day(2026, 11, 15); // Sunday; its week starts Mon 9 Nov
  assert.equal(core.rotationWeekIndex(day(2026, 11, 9), null, 2, today), 0);
  assert.equal(core.rotationWeekIndex(day(2026, 11, 16), null, 2, today), 1);
  assert.equal(core.rotationWeekIndex(day(2026, 11, 23), null, 2, today), 0);
  assert.equal(core.rotationWeekIndex(day(2026, 11, 2), null, 2, today), 1);
});

test("Week B shifts are scheduled next week when no anchor is saved", () => {
  const today = new Date();
  const nextWeek = addDays(today, 7);
  const weekday = (nextWeek.getDay() + 6) % 7;
  const shifts = [
    { id: "a", day: weekday, weekIndex: 0, start: 420, end: 1140 },
    { id: "b", day: weekday, weekIndex: 1, start: 1080, end: 360 },
  ];
  assert.deepEqual(
    shiftsForDate(shifts, today, null, 2).map((s) => s.id),
    ["a"],
  );
  assert.deepEqual(
    shiftsForDate(shifts, nextWeek, null, 2).map((s) => s.id),
    ["b"],
  );
});

test("mondayIso gives the local Monday of the week", () => {
  assert.equal(mondayIso(new Date(2026, 10, 15)), "2026-11-09");
  assert.equal(mondayIso(new Date(2026, 10, 16)), "2026-11-16");
  assert.equal(mondayIso(new Date(2026, 2, 8, 3, 0)), "2026-03-02");
});
