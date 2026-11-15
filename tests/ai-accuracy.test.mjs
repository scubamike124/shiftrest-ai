import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import vm from "node:vm";
import test from "node:test";
import * as core from "../src/lib/schedule-core.ts";
import * as tz from "../src/lib/time/tz.ts";

// Issue 1: estimates must be labelled, and wearable readings must never be
// invented or reused when stale.
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const strip = (p) =>
  stripTypeScriptTypes(read(p))
    .replace(/^import[\s\S]*?;\n/gm, "")
    .replace(/^export /gm, "");
const endAbsolute = (s) => (s.end <= s.start ? s.end + 1440 : s.end);
const ctx = vm.createContext({
  ...core,
  ...tz,
  Date,
  Math,
  Number,
  String,
  Intl,
  DAYS: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
  endAbsolute,
  fmt: String,
});
vm.runInContext(strip("src/lib/sleep-engine.ts"), ctx);
vm.runInContext(strip("src/lib/schedule.ts"), ctx);
const { computeInsights } = vm.runInContext(
  `${strip("src/lib/insights.ts")}\n({computeInsights})`,
  ctx,
);
// Each module in its own context (top-level names would clash in one).
const load = (file, names, globals = {}) =>
  vm.runInContext(
    `${strip(file)}\n({${names.join(",")}})`,
    vm.createContext({ Date, Math, Number, String, ...globals }),
  );
const { estimateSourceLabel, pickObservation } = load("src/lib/insight-labels.ts", [
  "estimateSourceLabel",
  "pickObservation",
]);
const { lastNightFrom, recentNights } = load("src/lib/health/apple-health.ts", [
  "lastNightFrom",
  "recentNights",
]);
const { computeDeviceInsights } = load(
  "src/lib/health/device-insights.ts",
  ["computeDeviceInsights"],
  {
    computeInsights,
    lastNightFrom,
    recentNights,
  },
);
const providers = (i) => [...i.dataSources.wearableProviders];

const prefs = { sleepHours: 8, windDownMin: 60, cycleWeeks: 1, cycleAnchor: null };
const shifts = [{ id: "n", day: 0, weekIndex: 0, start: 23 * 60, end: 7 * 60 }];
const now = new Date(2026, 10, 16, 12, 0); // Monday
const night = (date, min) => ({
  provider: "oura",
  date,
  sleepDurationMin: min,
  sleepEfficiency: 0.9,
  hrvMs: 40,
  restingHr: 55,
});

test("without wearable data, sleep debt is unknown and the AI is told not to invent readings", () => {
  const i = computeInsights(shifts, prefs, now);
  assert.equal(i.dataSources.sleepNights, 0);
  assert.deepEqual(providers(i), []);
  assert.equal(
    estimateSourceLabel(i),
    "Calculated from your shift schedule. No wearable sleep data is used.",
  );
  assert.equal(i.sleepDebtHours, 0);
  assert.match(
    i.contextString,
    /Data sources for this summary: shifts entered by the user; it contains no recent wearable readings/,
  );
  assert.match(i.contextString, /contains no recent wearable readings/);
  assert.match(
    i.contextString,
    /Only cite a wearable measurement if it appears explicitly elsewhere in this prompt; never guess one\./,
  );
  assert.doesNotMatch(
    i.contextString,
    /Do not state/,
    "no blanket ban: the coach prompt may carry real server-side measurements",
  );
  assert.doesNotMatch(i.contextString, /Last night \(/);
});

test("a recent night is used and labelled with its provider and night count", () => {
  const i = computeInsights(shifts, prefs, now, [], night("2026-11-16", 300));
  assert.deepEqual(providers(i), ["oura"]);
  assert.equal(
    estimateSourceLabel(i),
    "Calculated from your shift schedule, adjusted with 1 night of Oura data.",
  );
  assert.equal(i.dataSources.sleepNights, 1);
  assert.equal(i.sleepDebtHours, 3);
  assert.match(i.contextString, /Last night \(oura, 2026-11-16\)/);
  // Sleep debt is a calculation against the sleep target, never a measurement
  // (same rule as DATA_HONESTY's [estimate] values).
  assert.match(
    i.contextString,
    /Estimated sleep debt: 3\.0h, calculated from 1 night of measured wearable sleep/,
  );
  assert.doesNotMatch(i.contextString, /Measured sleep debt/i);
  assert.ok(i.signals.some((s) => /from the last 1 night of measured wearable sleep/.test(s)));
  assert.ok(
    !i.signals.some((s) => /last 7 nights/.test(s)),
    "one night must not be called 7 nights",
  );
});

test("a stale wearable reading is not treated as last night", () => {
  const i = computeInsights(shifts, prefs, now, [], night("2026-10-01", 240));
  assert.equal(i.dataSources.sleepNights, 0);
  assert.equal(i.dataSources.wearableStale, true);
  assert.equal(i.sleepDebtHours, 0);
  assert.doesNotMatch(i.contextString, /Last night/);
  assert.match(i.contextString, /more than 3 days old/);
  const fresh = computeInsights(shifts, prefs, now);
  assert.equal(
    i.fatigueToday.score,
    fresh.fatigueToday.score,
    "stale data must not change the estimate",
  );
});

test("working schedule-based calculations are unchanged when no wearable data exists", () => {
  const i = computeInsights(shifts, prefs, now);
  // Monday night shift: 45 (night) with no carry-over; recovery blends circadian debt.
  assert.equal(i.fatigueToday.score, 45);
  assert.equal(i.fatigueToday.band, "moderate");
  assert.equal(i.recoveryScore, Math.round(100 - 9 * 0.45 - 45 * 0.35));
});

test("screens label estimates and their sources", () => {
  const brief = read("src/components/AIBriefCard.tsx");
  assert.match(brief, /Estimates, not measurements\./);
  assert.match(brief, /sleep debt unknown \(no recent wearable sleep data\)/);
  assert.match(
    read("src/components/home/CompanionHero.tsx"),
    /Circadian debt\{" "\}\s*\{Math\.round\(context\.debtScore\)\}\/100 · estimates/,
  );
  assert.doesNotMatch(read("src/components/home/CompanionHero.tsx"), /Sleep debt \{/);
  assert.match(read("src/routes/dashboard.tsx"), /Not a sleep measurement\./);
  assert.match(read("src/components/home/HydrationCard.tsx"), /Logged by you/);
  assert.match(read("src/routes/health.tsx"), /Measured by your wearable/);
});

test("AI recap never shows an invented readiness number and gates sleep numbers on real data", () => {
  const card = read("src/components/DailyReviewCard.tsx");
  assert.doesNotMatch(card, /readinessDelta/);
  assert.doesNotMatch(card, />Readiness/);
  assert.match(card, /hasWearableSleep && data\.metrics\.sleepRecoveredMin != null/);
  assert.match(card, /AI-written/);
  // The recap reads the context string, which never carries Apple Health
  // (computeDeviceInsights pins it to baseInsights), so the gate must too.
  assert.match(
    read("src/routes/dashboard.tsx"),
    /hasWearableSleep=\{[^}]*device\?\.baseInsights\.dataSources\.sleepNights/,
  );
});

test("Apple Health nights are named as Apple Health, never as an undefined provider", () => {
  const r = {
    provider: "apple-health",
    date: "2026-11-16",
    sleepDurationMin: 420,
    sleepEfficiency: 0.88,
    hrvMs: 45,
    restingHr: 54,
  };
  const i = computeInsights(shifts, prefs, now, [], r, [r]);
  assert.deepEqual(providers(i), ["apple-health"]);
  assert.equal(i.dataSources.wearableNights, 1);
  assert.equal(
    estimateSourceLabel(i),
    "Calculated from your shift schedule, adjusted with 1 night of Apple Health data.",
  );
});

test("freshness: a 3-day-old night is used, a 4-day-old night is not", () => {
  assert.equal(
    computeInsights(shifts, prefs, now, [], night("2026-11-13", 300)).dataSources.sleepNights,
    1,
  );
  const old = computeInsights(shifts, prefs, now, [], night("2026-11-12", 300));
  assert.equal(old.dataSources.sleepNights, 0);
  assert.equal(old.dataSources.wearableStale, true);
});

test("a night with efficiency/HRV but no duration is labelled as used wearable data", () => {
  const r = {
    provider: "fitbit",
    date: "2026-11-16",
    sleepDurationMin: null,
    sleepEfficiency: 0.7,
    hrvMs: 30,
    restingHr: null,
  };
  const i = computeInsights(shifts, prefs, now, [], r);
  assert.equal(i.dataSources.sleepNights, 0);
  assert.equal(i.dataSources.wearableNights, 1);
  assert.match(i.contextString, /fitbit wearable readings for 1 night/);
  assert.ok(
    i.fatigueToday.score > computeInsights(shifts, prefs, now).fatigueToday.score,
    "efficiency still adjusts the estimate",
  );
  assert.equal(
    estimateSourceLabel(i),
    "Calculated from your shift schedule, adjusted with 1 night of Fitbit data.",
  );
});

test("a resting-HR-only night is not claimed as adjusting the estimates", () => {
  const r = {
    provider: "oura",
    date: "2026-11-16",
    sleepDurationMin: null,
    sleepEfficiency: null,
    hrvMs: null,
    restingHr: 52,
  };
  const i = computeInsights(shifts, prefs, now, [], r);
  assert.equal(i.dataSources.wearableNights, 0);
  assert.match(i.contextString, /contains no recent wearable readings/);
  assert.equal(
    estimateSourceLabel(i),
    "Calculated from your shift schedule. No wearable sleep data is used.",
  );
});

test("fresh history with a stale newest night is labelled from the history, without a contradiction", () => {
  const hist = [night("2026-11-14", 360), night("2026-11-15", 400)];
  const i = computeInsights(shifts, prefs, now, [], night("2026-11-01", 200), hist);
  assert.equal(i.dataSources.wearableNights, 2);
  assert.match(i.contextString, /oura wearable readings for 2 nights/);
  assert.doesNotMatch(i.contextString, /contains no recent wearable readings/);
});

test("stale only: the label says the reading is too old instead of claiming it", () => {
  const i = computeInsights(shifts, prefs, now, [], night("2026-11-01", 300));
  assert.equal(
    estimateSourceLabel(i),
    "Calculated from your shift schedule. Your newest wearable reading is more than 3 days old, so it isn't used.",
  );
  assert.equal(
    estimateSourceLabel(computeInsights([], prefs, now)),
    "No shifts entered yet, so these are defaults. No wearable sleep data is used.",
  );
});

// Apple Health nights as useAppleHealth() returns them (oldest first).
const ahNight = (date, min) => ({
  provider: "apple-health",
  date,
  sleepStart: `${date}T00:00:00`,
  sleepEnd: `${date}T07:00:00`,
  sleepDurationMin: min,
  sleepEfficiency: 0.9,
  deepMin: null,
  remMin: null,
  lightMin: null,
  hrvMs: 42,
  restingHr: 56,
});

test("Oura last night plus older Apple Health nights names both sources", () => {
  const d = computeDeviceInsights({
    shifts,
    prefs,
    now,
    serverLastNight: night("2026-11-15", 420),
    appleHealthNights: [
      ahNight("2026-11-11", 400),
      ahNight("2026-11-12", 380),
      ahNight("2026-11-13", 410),
    ],
  });
  assert.equal(d.source, "apple-health");
  assert.equal(d.appleHealthLastNight, null, "no Apple Health night since yesterday");
  assert.deepEqual(providers(d.insights), ["oura", "apple-health"]);
  assert.equal(d.insights.dataSources.wearableNights, 4);
  assert.equal(
    estimateSourceLabel(d.insights),
    "Calculated from your shift schedule, adjusted with 4 nights of Oura and Apple Health data.",
  );
});

test("privacy: nothing from Apple Health reaches the AI-bound context string", () => {
  const d = computeDeviceInsights({
    shifts,
    prefs,
    now,
    serverLastNight: null,
    appleHealthNights: [ahNight("2026-11-15", 333), ahNight("2026-11-16", 347)],
  });
  assert.equal(d.source, "apple-health");
  assert.deepEqual(providers(d.insights), ["apple-health"]);
  assert.equal(d.insights.contextString, d.baseInsights.contextString);
  assert.doesNotMatch(d.insights.contextString, /apple|5\.8h|333|347/i);
  assert.match(d.insights.contextString, /contains no recent wearable readings/);
});

test("the dashboard whisper calls sleep debt an estimate and names the real night count", () => {
  const i = computeInsights(shifts, prefs, now, [], night("2026-11-16", 300));
  const obs = pickObservation(i);
  assert.equal(obs.text, "Estimated sleep debt: about 3.0h, from 1 night of wearable sleep.");
  assert.doesNotMatch(obs.text, /7 nights|You slept/);
  const ahead = pickObservation({ ...i, sleepDebtHours: -2.5 });
  assert.equal(
    ahead.text,
    "You're about 2.5h ahead of your sleep target (an estimate from 1 night of wearable sleep).",
  );
});

test("efficiency-only night: the AI sees the reading it is told about, and is told not to guess", () => {
  const r = {
    provider: "oura",
    date: "2026-11-16",
    sleepDurationMin: null,
    sleepEfficiency: 0.82,
    hrvMs: null,
    restingHr: null,
  };
  const i = computeInsights(shifts, prefs, now, [], r);
  assert.match(
    i.contextString,
    /Last night \(oura, 2026-11-16\): no sleep duration recorded, 82% efficiency\./,
  );
  assert.match(i.contextString, /oura wearable readings for 1 night/);
  assert.match(
    i.contextString,
    /Only cite a wearable measurement that is written out in this prompt; never guess one\./,
  );
});

test("no shifts: the AI is told the schedule values are defaults", () => {
  const i = computeInsights([], prefs, now);
  assert.match(
    i.contextString,
    /Data sources for this summary: no shifts entered yet, so schedule values are defaults;/,
  );
  assert.doesNotMatch(i.contextString, /shifts entered by the user/);
});

test("the sleep-debt recommendation says estimated and how many nights", () => {
  const rec = read("src/lib/recommendations.ts");
  assert.doesNotMatch(rec, /You're carrying/);
  assert.match(rec, /of estimated sleep debt \(from \$\{/);
});
