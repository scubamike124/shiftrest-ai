// The Apple Health availability probe is retried (bounded) inside the iPhone app, so a
// plugin that answers "not available" before it is ready no longer hides the
// Connect Apple Health card for the life of the page (Maestro flow 20).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import vm from "node:vm";
import test from "node:test";

const read = (p) => readFileSync(new URL("../" + p, import.meta.url), "utf8");
function load(src = read("src/lib/health/availability-watch.ts")) {
  const js = stripTypeScriptTypes(src)
    .replaceAll("export const ", "const ")
    .replaceAll("export function ", "function ");
  return vm.runInContext(
    `${js}\n({watchAppleHealthAvailability, AVAILABILITY_RETRY_DELAYS_MS})`,
    vm.createContext({ setTimeout, clearTimeout, Promise }),
  );
}

// Fake clock: timers run only when we advance, so there is no real waiting.
function clock() {
  let next = 1;
  const timers = new Map();
  return {
    setTimer: (fn, ms) => {
      const id = next++;
      timers.set(id, { fn, ms });
      return id;
    },
    clearTimer: (id) => timers.delete(id),
    pending: () => timers.size,
    delaysQueued: () => [...timers.values()].map((t) => t.ms),
    async fire() {
      const [id, t] = [...timers.entries()][0] ?? [];
      if (!t) return false;
      timers.delete(id);
      t.fn();
      await flush();
      return true;
    },
  };
}
const flush = async () => {
  for (let i = 0; i < 6; i++) await Promise.resolve();
};

function run(mod, { answers, native = true }) {
  const c = clock();
  const calls = [];
  const changes = [];
  let i = 0;
  const probe = async () => {
    calls.push(i);
    const a = answers[Math.min(i++, answers.length - 1)];
    if (a === "throw") throw new Error("plugin not ready");
    return a;
  };
  const stop = mod.watchAppleHealthAvailability({
    probe,
    native,
    onChange: (a) => changes.push(a),
    setTimer: c.setTimer,
    clearTimer: c.clearTimer,
  });
  return { c, calls, changes, stop };
}

test("in the app: retries until the plugin reports available, then stops", async () => {
  const m = load();
  const r = run(m, { answers: [false, "throw", false, true] });
  await flush();
  assert.equal(r.calls.length, 1);
  while (await r.c.fire());
  assert.equal(r.calls.length, 4);
  assert.deepEqual(r.changes, [true]);
  assert.equal(r.c.pending(), 0, "no timer left after success");
});

test("in the app: gives up after the maximum attempts and settles false", async () => {
  const m = load();
  const r = run(m, { answers: [false] });
  await flush();
  const seen = [];
  for (let n = 0; n < 20; n++) {
    seen.push(...r.c.delaysQueued());
    if (!(await r.c.fire())) break;
  }
  assert.equal(r.calls.length, 5, "5 probes in total");
  assert.deepEqual(seen, [1000, 2000, 3000, 4000]);
  assert.deepEqual([...m.AVAILABILITY_RETRY_DELAYS_MS].reduce((a, b) => a + b, 0) <= 15000, true);
  assert.deepEqual(r.changes, []);
  assert.equal(r.c.pending(), 0);
});

test("on the web: one probe, no retry timer", async () => {
  const m = load();
  const r = run(m, { answers: [false], native: false });
  await flush();
  assert.equal(r.calls.length, 1);
  assert.equal(r.c.pending(), 0);
});

test("cancel stops the pending timer and any later result", async () => {
  const m = load();
  const r = run(m, { answers: [false, true] });
  await flush();
  assert.equal(r.c.pending(), 1);
  r.stop();
  assert.equal(r.c.pending(), 0);
  await r.c.fire();
  assert.equal(r.calls.length, 1);
  assert.deepEqual(r.changes, []);
  // Cancel while a probe is in flight: its answer is ignored.
  const r2 = run(m, { answers: [true] });
  r2.stop();
  await flush();
  assert.deepEqual(r2.changes, []);
});

test("mutation check: a version that never retries fails the retry test", async () => {
  const mutated = read("src/lib/health/availability-watch.ts").replace(
    "!opts.native || index >= delays.length",
    "true",
  );
  assert.notEqual(mutated, read("src/lib/health/availability-watch.ts"));
  const r = run(load(mutated), { answers: [false, true] });
  await flush();
  while (await r.c.fire());
  assert.notDeepEqual(r.changes, [true], "mutant must not reach available");
});

test("the hook uses the watcher, cleans it up, and requests no authorization", () => {
  const hook = read("src/hooks/use-apple-health.ts");
  assert.match(hook, /watchAppleHealthAvailability\(\{/);
  assert.match(hook, /stopProbing\(\);/);
  assert.doesNotMatch(hook, /requestAuthorization|connectAppleHealth/);
  assert.match(read("src/lib/health/availability-watch.ts"), /never asks/);
});
