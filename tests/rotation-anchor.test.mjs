// A 2-6 week rotation must advance from week to week even when the user
// never saved a "Week A starts" date (prefs.cycleAnchor === null).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

function loadSchedule() {
  const src = readFileSync(new URL("../src/lib/schedule.ts", import.meta.url), "utf8");
  const js = ts.transpileModule(src, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const module = { exports: {} };
  // schedule.ts's other imports are not used by the functions under test.
  vm.runInNewContext(js, {
    module,
    exports: module.exports,
    require: () => ({}),
    Date,
    Math,
    Number,
    String,
  });
  return module.exports;
}

const { weekIndexFor, shiftsForDate, mondayIso } = loadSchedule();
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

test("a saved anchor still decides the rotation; one-week schedules are unchanged", () => {
  assert.equal(weekIndexFor(new Date(2026, 10, 16), "2026-11-09", 2), 1);
  assert.equal(weekIndexFor(new Date(2026, 10, 22), "2026-11-09", 2), 1); // Sunday of the same week
  assert.equal(weekIndexFor(new Date(2026, 10, 23), "2026-11-09", 2), 0);
  assert.equal(weekIndexFor(new Date(2026, 10, 23), null, 1), 0);
});

test("mondayIso gives the local Monday of the week", () => {
  assert.equal(mondayIso(new Date(2026, 10, 15)), "2026-11-09"); // Sunday
  assert.equal(mondayIso(new Date(2026, 10, 16)), "2026-11-16"); // Monday
  assert.equal(mondayIso(new Date(2026, 2, 8, 3, 0)), "2026-03-02"); // DST change day (US)
});
