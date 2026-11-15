// Offline checks for the companion eval spend guard (tests/ai/companion/lib/guard.cjs):
// the token cap refuses instead of overspending, a missing key is reported (not
// faked) and costs nothing, and cached answers are served without a key.
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const require = createRequire(import.meta.url);
const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), "rp-guard-"));
process.env.RESTPILOT_EVAL_CACHE_DIR = cacheDir;
const guard = require("./ai/companion/lib/guard.cjs");

function withCap(value, fn) {
  const prev = process.env.RESTPILOT_EVAL_MAX_TOKENS;
  if (value === undefined) delete process.env.RESTPILOT_EVAL_MAX_TOKENS;
  else process.env.RESTPILOT_EVAL_MAX_TOKENS = String(value);
  return Promise.resolve(fn()).finally(() => {
    if (prev === undefined) delete process.env.RESTPILOT_EVAL_MAX_TOKENS;
    else process.env.RESTPILOT_EVAL_MAX_TOKENS = prev;
  });
}

test("no cap set: every paid call is refused", () =>
  withCap(undefined, async () => {
    let called = false;
    const r = await guard.guarded({
      parts: { a: 1 },
      estimate: 10,
      context: { bustCache: true },
      call: async () => ((called = true), { output: "x" }),
    });
    assert.match(r.error, /COST_CAP: no token cap/);
    assert.equal(called, false);
  }));

test("a call that would cross the cap is refused, not sent", () =>
  withCap(guard.snapshot().used + 1000, async () => {
    let calls = 0;
    const call = async () => ((calls += 1), { output: "ok", tokenUsage: { total: 700 } });
    const first = await guard.guarded({
      parts: { b: 1 },
      estimate: 800,
      context: { bustCache: true },
      call,
    });
    assert.equal(first.output, "ok");
    const second = await guard.guarded({
      parts: { b: 2 },
      estimate: 800,
      context: { bustCache: true },
      call,
    });
    assert.match(second.error, /COST_CAP: refused/);
    assert.equal(calls, 1);
  }));

test("missing key: reported, nothing reserved or spent", () =>
  withCap(1_000_000, async () => {
    const before = guard.snapshot().used;
    const r = await guard.guarded({
      parts: { c: 1 },
      estimate: 5000,
      context: {},
      unavailable: "missing GEMINI_API_KEY (benchmark pending key)",
      call: async () => assert.fail("must not call"),
    });
    assert.match(r.error, /missing GEMINI_API_KEY/);
    assert.equal(guard.snapshot().used, before);
  }));

test("cached answers are served without a key and without spending", () =>
  withCap(1_000_000, async () => {
    const parts = { d: 1 };
    const live = await guard.guarded({
      parts,
      estimate: 100,
      context: {},
      call: async () => ({ output: "cached reply", tokenUsage: { total: 50 } }),
    });
    assert.equal(live.output, "cached reply");
    const used = guard.snapshot().used;
    const again = await guard.guarded({
      parts,
      estimate: 100,
      context: {},
      unavailable: "missing key",
      call: async () => assert.fail("must not call"),
    });
    assert.equal(again.output, "cached reply");
    assert.equal(again.cached, true);
    assert.equal(guard.snapshot().used, used);
    const repeat = await guard.guarded({
      parts,
      estimate: 100,
      context: { repeatIndex: 1 },
      unavailable: "missing key",
      call: async () => assert.fail("must not call"),
    });
    assert.match(
      repeat.error,
      /missing key/,
      "each repeat is cached separately (consistency runs)",
    );
  }));

test("the app provider and judge both route through the guard", () => {
  for (const f of ["app-provider.cjs", "grader.cjs"]) {
    const src = fs.readFileSync(new URL(`./ai/companion/lib/${f}`, import.meta.url), "utf8");
    assert.match(src, /require\("\.\/guard\.cjs"\)/, `${f} imports the guard`);
    assert.match(src, /return guarded\(/, `${f} sends through guarded()`);
  }
});
