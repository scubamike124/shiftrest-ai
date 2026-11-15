// Native reminders + offline plan for the iPhone app shell (pure logic).
// Bundles the TS modules with esbuild (already a dev dependency through Vite)
// so the real code runs, imports and all.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
process.env.TZ = "America/New_York";

async function load(entry) {
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "rp-native-")), "m.mjs");
  await build({
    entryPoints: [path.join(root, entry)],
    bundle: true,
    format: "esm",
    platform: "node",
    outfile: out,
    alias: { "@": path.join(root, "src") },
    logLevel: "silent",
  });
  return import(pathToFileURL(out).href);
}

const R = await load("src/lib/native/reminders.ts");
const O = await load("src/lib/native/offline-plan.ts");
const L = await load("src/lib/native/links.ts");

const prefs = {
  windDownMin: 60,
  sleepHours: 7,
  cycleWeeks: 1,
  cycleAnchor: null,
  currentTz: null,
  homeTz: null,
};
const hm = (h, m = 0) => h * 60 + m;
// Day shifts Mon–Wed 07:00–15:00, then night shifts Thu–Fri 23:00–07:00 (weekly rotation).
const shifts = [
  { id: "a", day: 0, weekIndex: 0, start: hm(7), end: hm(15) },
  { id: "b", day: 1, weekIndex: 0, start: hm(7), end: hm(15) },
  { id: "c", day: 2, weekIndex: 0, start: hm(7), end: hm(15) },
  { id: "d", day: 3, weekIndex: 0, start: hm(23), end: hm(7) },
  { id: "e", day: 4, weekIndex: 0, start: hm(23), end: hm(7) },
];
const sunday = new Date(2026, 10, 15, 9, 0); // Sun 15 Nov 2026, 09:00 local
const on = (patch = {}) =>
  R.normalizeSettings({ ...R.DEFAULT_NATIVE_REMINDER_SETTINGS, enabled: true, ...patch });
const fmt = (d) =>
  `${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;

test("nothing is planned while reminders are off or there are no shifts", () => {
  assert.deepEqual(
    R.planNativeReminders({
      shifts,
      prefs,
      settings: R.DEFAULT_NATIVE_REMINDER_SETTINGS,
      now: sunday,
    }),
    [],
  );
  assert.deepEqual(R.planNativeReminders({ shifts: [], prefs, settings: on(), now: sunday }), []);
});

test("times match the plan the app shows: shift lead, wind-down at clock-out, bedtime after wind-down", () => {
  const plan = R.planNativeReminders({ shifts, prefs, settings: on({ dailyCap: 8 }), now: sunday });
  const mon = plan.filter((r) => r.at.getDate() === 16).map((r) => `${r.kind} ${fmt(r.at)}`);
  assert.deepEqual(mon, ["upcoming-shift 16 06:00", "wind-down 16 15:00", "bedtime 16 16:00"]);
  assert.ok(
    plan.every((r) => r.at > sunday),
    "future only",
  );
  assert.ok(
    plan.every((r) => r.at - sunday < 7 * 86400000),
    "7-day horizon",
  );
  assert.ok(
    plan.every((r, i) => i === 0 || plan[i - 1].at <= r.at),
    "sorted by time",
  );
});

test("a switch from day to night shifts gets one heads-up at noon the day before", () => {
  const plan = R.planNativeReminders({ shifts, prefs, settings: on({ dailyCap: 8 }), now: sunday });
  const change = plan.filter((r) => r.kind === "shift-change");
  assert.equal(change.length, 1);
  assert.equal(fmt(change[0].at), "18 12:00"); // Wed noon, before Thu's first night shift
  assert.match(change[0].title, /night shift at 23:00/);
});

test("each kind can be switched off, and the shift lead time is honoured", () => {
  const plan = R.planNativeReminders({
    shifts,
    prefs,
    now: sunday,
    settings: on({
      kinds: {
        "upcoming-shift": true,
        bedtime: false,
        "wind-down": false,
        "shift-change": false,
        recovery: false,
      },
      upcomingShiftLeadMin: 30,
    }),
  });
  assert.ok(plan.length > 0 && plan.every((r) => r.kind === "upcoming-shift"));
  assert.equal(fmt(plan[0].at), "16 06:30");
});

test("quiet hours drop reminders inside the window, including across midnight", () => {
  const q = { enabled: true, start: "22:00", end: "07:00" };
  assert.equal(R.inQuietHours(new Date(2026, 10, 16, 23, 30), q), true);
  assert.equal(R.inQuietHours(new Date(2026, 10, 16, 6, 59), q), true);
  assert.equal(R.inQuietHours(new Date(2026, 10, 16, 7, 0), q), false);
  assert.equal(R.inQuietHours(new Date(2026, 10, 16, 23, 30), { ...q, enabled: false }), false);
  const plan = R.planNativeReminders({
    shifts,
    prefs,
    settings: on({ dailyCap: 8, quietHours: q }),
    now: sunday,
  });
  assert.ok(plan.length > 0);
  assert.ok(plan.every((r) => !R.inQuietHours(r.at, q)));
  assert.ok(
    !plan.some((r) => fmt(r.at) === "16 06:00"),
    "the 06:00 shift reminder is inside quiet hours",
  );
});

test("the daily cap keeps the most important reminders", () => {
  const plan = R.planNativeReminders({ shifts, prefs, settings: on({ dailyCap: 1 }), now: sunday });
  const perDay = new Map();
  for (const r of plan) perDay.set(r.at.toDateString(), (perDay.get(r.at.toDateString()) ?? 0) + 1);
  assert.ok([...perDay.values()].every((n) => n === 1));
  assert.equal(plan.find((r) => r.at.getDate() === 16).kind, "upcoming-shift");
});

test("duplicates are removed and ids are stable, positive 31-bit integers", () => {
  // The same shift entered twice must not double the reminders.
  const dup = [...shifts, { ...shifts[0], id: "a2" }];
  const a = R.planNativeReminders({
    shifts: dup,
    prefs,
    settings: on({ dailyCap: 8 }),
    now: sunday,
  });
  const b = R.planNativeReminders({ shifts, prefs, settings: on({ dailyCap: 8 }), now: sunday });
  assert.deepEqual(
    a.map((r) => r.id),
    b.map((r) => r.id),
  );
  assert.equal(new Set(b.map((r) => r.id)).size, b.length);
  assert.ok(b.every((r) => Number.isInteger(r.id) && r.id > 0 && r.id < 2 ** 31));
  const again = R.planNativeReminders({
    shifts,
    prefs,
    settings: on({ dailyCap: 8 }),
    now: new Date(sunday.getTime() + 60000),
  });
  assert.equal(again[0].id, b[0].id, "re-planning a minute later replaces, not duplicates");
});

test("never more pending than iOS allows", () => {
  const many = Array.from({ length: 7 }, (_, d) => [
    { id: `x${d}`, day: d, weekIndex: 0, start: hm(6), end: hm(10) },
    { id: `y${d}`, day: d, weekIndex: 0, start: hm(18), end: hm(22) },
  ]).flat();
  const plan = R.planNativeReminders({
    shifts: many,
    prefs,
    settings: on({ dailyCap: 8 }),
    now: sunday,
    days: 30,
  });
  assert.ok(plan.length <= R.MAX_PENDING);
});

test("stored settings are validated and clamped", () => {
  const s = R.normalizeSettings({
    enabled: "yes",
    dailyCap: 99,
    upcomingShiftLeadMin: 7,
    quietHours: { enabled: true, start: "25:00", end: "06:30" },
    kinds: { bedtime: false, bogus: true },
  });
  assert.equal(s.enabled, false);
  assert.equal(s.dailyCap, R.DAILY_CAP_RANGE.max);
  assert.equal(s.upcomingShiftLeadMin, 60);
  assert.deepEqual(s.quietHours, { enabled: true, start: "23:00", end: "06:30" });
  assert.equal(s.kinds.bedtime, false);
  assert.equal("bogus" in s.kinds, false);
});

test("offline plan: two weeks of concrete shifts and sleep windows, no notes", () => {
  const withNotes = shifts.map((s) => ({
    ...s,
    title: s.id === "d" ? "ICU nights" : null,
    notes: "private",
    employerId: "emp1",
  }));
  const plan = O.buildOfflinePlan({
    shifts: withNotes,
    prefs,
    employers: [{ id: "emp1", name: "St. Mary" }],
    now: sunday,
  });
  assert.equal(plan.v, 1);
  assert.equal(plan.days.length, 14);
  assert.equal(plan.days[0].date, "2026-11-15");
  assert.deepEqual(plan.days[0].shifts, []);
  const thu = plan.days.find((d) => d.date === "2026-11-19");
  assert.deepEqual(thu.shifts, [
    { start: "23:00", end: "07:00", overnight: true, title: "ICU nights", employer: "St. Mary" },
  ]);
  assert.deepEqual(thu.sleep, { start: "08:00", end: "15:00" });
  assert.ok(!JSON.stringify(plan).includes("private"), "notes never leave the site");
});

test("only our own https links and same-site paths open inside the app", () => {
  assert.equal(
    L.safeInAppPath("https://restpilotai.com/plan?x=1#t", "restpilotai.com"),
    "/plan?x=1#t",
  );
  assert.equal(L.safeInAppPath("https://www.restpilotai.com/coach", "restpilotai.com"), "/coach");
  assert.equal(L.safeInAppPath("/dashboard", "restpilotai.com"), "/dashboard");
  assert.equal(L.safeInAppPath("https://staging.example.app/plan", "staging.example.app"), "/plan");
  for (const bad of [
    "https://evil.com/plan",
    "http://restpilotai.com/plan",
    "//evil.com/x",
    "/\\evil.com",
    "javascript:alert(1)",
    "",
    "plan",
  ]) {
    assert.equal(L.safeInAppPath(bad, "restpilotai.com"), null, bad);
  }
});

test("nothing fires inside a planned sleep window: moved to wake-up when still useful, else dropped", async () => {
  const S = await load("src/lib/schedule.ts");
  // Nights Mon–Wed 23:00–07:00 (sleep 08:00–15:00), then a day shift Thu 15:30–23:00.
  const nightsThenDay = [
    { id: "n0", day: 0, weekIndex: 0, start: hm(23), end: hm(7) },
    { id: "n1", day: 1, weekIndex: 0, start: hm(23), end: hm(7) },
    { id: "n2", day: 2, weekIndex: 0, start: hm(23), end: hm(7) },
    { id: "d3", day: 3, weekIndex: 0, start: hm(15, 30), end: hm(23) },
  ];
  const plan = R.planNativeReminders({
    shifts: nightsThenDay,
    prefs,
    settings: on({ dailyCap: 8 }),
    now: sunday,
  });
  const change = plan.filter((r) => r.kind === "shift-change");
  assert.equal(change.length, 1);
  assert.equal(
    fmt(change[0].at),
    "18 15:00",
    "Wed noon is inside 08:00–15:00 sleep: moved to wake-up",
  );
  const thu = plan.find((r) => r.kind === "upcoming-shift" && r.at.getDate() === 19);
  assert.equal(
    fmt(thu.at),
    "19 15:00",
    "14:30 would be inside Thu sleep (after Wed night): moved to 15:00",
  );

  const from = new Date(sunday);
  from.setDate(from.getDate() - 1);
  const windows = S.buildMultiDayPlan(nightsThenDay, prefs, from, 10).flatMap((d) =>
    d.sleep ? [d.sleep] : [],
  );
  for (const r of plan) {
    assert.ok(
      !windows.some((w) => r.at > w.start && r.at < w.end),
      `${r.kind} ${fmt(r.at)} is inside a sleep window`,
    );
  }
  assert.ok(
    plan.every((r) => !("deadline" in r)),
    "internal fields do not reach the plugin",
  );
});

test("a reminder that cannot move before its shift is dropped", () => {
  const w = { start: new Date(2026, 10, 16, 8), end: new Date(2026, 10, 16, 15) };
  const c = {
    kind: "upcoming-shift",
    at: new Date(2026, 10, 16, 12),
    title: "",
    body: "",
    path: "/",
    deadline: new Date(2026, 10, 16, 14),
  };
  assert.deepEqual(R.avoidSleep(c, [w]), []);
  assert.deepEqual(R.avoidSleep({ ...c, kind: "wind-down", deadline: undefined }, [w]), []);
  assert.equal(
    R.avoidSleep({ ...c, deadline: new Date(2026, 10, 16, 16) }, [w])[0].at.getHours(),
    15,
  );
  assert.equal(
    R.avoidSleep({ ...c, at: new Date(2026, 10, 16, 8) }, [w]).length,
    1,
    "the window start (bedtime) is not inside",
  );
});

test("quiet hours move a shift reminder to their end when that is still before clock-in", () => {
  const q = { enabled: true, start: "22:00", end: "06:00" };
  const plan = R.planNativeReminders({
    shifts,
    prefs,
    now: sunday,
    settings: on({ dailyCap: 8, quietHours: q, upcomingShiftLeadMin: 90 }),
  });
  const mon = plan.find((r) => r.kind === "upcoming-shift" && r.at.getDate() === 16);
  assert.equal(fmt(mon.at), "16 06:00", "05:30 is quiet: moved to 06:00, before the 07:00 shift");
  assert.ok(plan.every((r) => !R.inQuietHours(r.at, q)));
});

test("a sync still running when the person signs out leaves nothing behind", async () => {
  const S = await load("src/lib/native/sync.ts");
  const pending = new Map();
  let release;
  const gate = new Promise((r) => {
    release = r;
  });
  const ln = {
    checkPermissions: async () => ({ display: "granted" }),
    getPending: async () => ({ notifications: [...pending.values()] }),
    cancel: async ({ notifications }) => {
      for (const n of notifications) pending.delete(n.id);
    },
    schedule: async ({ notifications }) => {
      await gate;
      for (const n of notifications) pending.set(n.id, n);
    },
  };
  const prefsStore = new Map();
  const pref = {
    set: async ({ key, value }) => {
      prefsStore.set(key, value);
    },
    remove: async ({ key }) => {
      prefsStore.delete(key);
    },
    get: async ({ key }) => ({ value: prefsStore.get(key) ?? null }),
  };
  globalThis.window = {
    Capacitor: {
      isNativePlatform: () => true,
      isPluginAvailable: () => true,
      Plugins: { LocalNotifications: ln, Preferences: pref },
    },
  };
  try {
    const planned = R.planNativeReminders({ shifts, prefs, settings: on(), now: sunday });
    const sync = S.syncNativeReminders(planned); // blocks inside schedule()
    await new Promise((r) => setTimeout(r, 10));
    await S.clearNativeUserData(); // sign-out while scheduling
    release();
    assert.deepEqual(await sync, { status: "cleared" });
    assert.equal(pending.size, 0, "reminders from before sign-out were taken back");
    const result = await S.syncNativeReminders(planned);
    assert.equal(result.status, "scheduled", "a later sync for the next account works normally");
    assert.equal(pending.size, planned.length);
  } finally {
    delete globalThis.window;
  }
});
