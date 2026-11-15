// The dashboard brief card must survive a model reply with missing or
// mistyped fields (it used to throw on `top_actions.slice`).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

function load() {
  const js = ts.transpileModule(
    readFileSync(new URL("../src/lib/ai-brief.ts", import.meta.url), "utf8"),
    { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } },
  ).outputText;
  const module = { exports: {} };
  vm.runInNewContext(js, { module, exports: module.exports });
  return module.exports;
}
const { normalizeBrief } = load();

test("a complete reply passes through", () => {
  const b = normalizeBrief({
    greeting: "Hi",
    headline: "Anchor sleep",
    fatigue_note: "Two nights short",
    top_actions: [{ icon: "moon", title: "Sleep", detail: "At 9 PM" }],
    coach_note: "You've got this",
  });
  assert.equal(b.top_actions.length, 1);
  assert.equal(b.coach_note, "You've got this");
});

test("missing or mistyped fields never throw", () => {
  const b = normalizeBrief({ headline: "Rest up", top_actions: "nope", coach_note: 5 });
  assert.equal(b.top_actions.length, 0);
  assert.equal(b.coach_note, "");
  assert.equal(b.greeting, "");
});

test("junk actions are dropped and empty replies are rejected", () => {
  const b = normalizeBrief({ headline: "x", top_actions: [null, 3, { title: "Ok" }, {}] });
  assert.equal(b.top_actions.length, 1);
  assert.equal(normalizeBrief({ mock: true }), null);
  assert.equal(normalizeBrief(null), null);
  assert.equal(normalizeBrief([]), null);
});

test("tomorrow preview and daily review lists are always arrays", () => {
  const { normalizeTomorrowPreview, normalizeDailyReview } = load();
  assert.equal(normalizeTomorrowPreview({ headline: "x" }).blocks.length, 0);
  assert.equal(normalizeTomorrowPreview({ blocks: "bad" }).blocks.length, 0);
  assert.equal(normalizeTomorrowPreview({ blocks: [{ kind: "sleep" }] }).blocks.length, 1);
  const d = normalizeDailyReview({ headline: "x", wins: null });
  assert.equal(d.wins.length, 0);
  assert.equal(d.drains.length, 0);
});
