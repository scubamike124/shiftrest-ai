import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";

const require = createRequire(import.meta.url);
const js = ts.transpileModule(
  readFileSync(new URL("../src/lib/ai/intent-schemas.ts", import.meta.url), "utf8"),
  {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  },
).outputText;
const module = { exports: {} };
vm.runInNewContext(js, {
  exports: module.exports,
  module,
  Date,
  Number,
  Math,
  JSON,
  Array,
  String,
  Object,
  require: (n) => {
    if (n === "zod") return require("zod");
    throw new Error("Unexpected import " + n);
  },
});
const { normalizeIntentOutput: norm, normalizeInsights, normalizeSwap } = module.exports;
const fb = {
  nowIso: "2026-11-15T12:00:00.000Z",
  targetWakeIso: "2026-11-15T21:00:00.000Z",
  phase: "arrival",
};
const plain = (v) => JSON.parse(JSON.stringify(v));

test('unknown enum values and missing optional fields get safe defaults (urgency "critical")', () => {
  const r = norm(
    "right_now",
    {
      action: "Nap 20 minutes now",
      why: "Short sleep",
      urgency: "critical",
      ctaRoute: "/admin",
      confidence: "certain",
      timeWindow: "soon",
      extra: "x",
    },
    fb,
  );
  assert.equal(r.ok, true);
  assert.equal(r.value.urgency, "soon");
  assert.equal(r.value.ctaRoute, "/dashboard");
  assert.equal(r.value.ctaLabel, "See full plan");
  assert.equal(r.value.ignoreCost, "");
  assert.equal(r.value.confidence, undefined);
  assert.equal(r.value.timeWindow, undefined);
  assert.equal("extra" in r.value, false, "unknown keys are stripped");
  assert.equal(
    norm("right_now", { action: "x", urgency: " NOW ", confidence: "HIGH" }, fb).value.urgency,
    "now",
  );
});

test("a card without its primary text is rejected so the route answers 502", () => {
  for (const [intent, raw] of [
    ["right_now", { why: "x" }],
    ["daily_review", { wins: [] }],
    ["tomorrow_preview", { headline: "   " }],
    ["coach_tip", { tip: null }],
  ]) {
    assert.equal(norm(intent, raw, fb).ok, false, intent);
  }
  for (const raw of [null, [], "text", 42]) assert.equal(norm("right_now", raw, fb).ok, false);
  assert.equal(norm("unknown_intent", { headline: "x" }, fb).ok, false);
});

test("lists drop malformed items, default unknown kinds and cap length", () => {
  const r = norm(
    "tomorrow_preview",
    {
      headline: "Recovery day",
      summary: 7,
      blocks: [
        null,
        "sleep",
        { kind: "nap", title: "Nap", when: 15, detail: "x" },
        { kind: "Light", title: "Sun" },
        ...Array(10).fill({ kind: "sleep" }),
      ],
    },
    fb,
  );
  assert.equal(r.ok, true);
  assert.equal(r.value.summary, "7");
  assert.equal(r.value.blocks.length, 8);
  assert.deepEqual(plain(r.value.blocks[0]), {
    kind: "recovery",
    title: "Nap",
    when: "15",
    detail: "x",
  });
  assert.equal(r.value.blocks[1].kind, "light");
});

test("daily review: metrics default, readiness is never passed through", () => {
  const r = norm(
    "daily_review",
    {
      headline: "Solid day",
      wins: "great",
      drains: ["late coffee", 5, ""],
      metrics: { readinessDelta: 12, sleepRecoveredMin: "45", recoveryTrend: "sideways" },
    },
    fb,
  );
  assert.equal(r.ok, true);
  assert.deepEqual(plain(r.value.wins), []);
  assert.deepEqual(plain(r.value.drains), ["late coffee"]);
  assert.deepEqual(plain(r.value.metrics), { sleepRecoveredMin: 45, recoveryTrend: "unknown" });
  assert.deepEqual(
    plain(norm("daily_review", { headline: "x", metrics: "none" }, fb).value.metrics),
    { sleepRecoveredMin: null, recoveryTrend: "unknown" },
  );
});

test("timestamps fall back to known-good values; booleans and numbers are coerced", () => {
  const alarm = norm(
    "smart_alarm",
    { wakeAt: "quarter past three", reason: "x", cyclePosition: "REM" },
    fb,
  );
  assert.equal(alarm.value.wakeAt, fb.targetWakeIso);
  assert.equal(alarm.value.cyclePosition, "natural");
  assert.equal(alarm.value.message, "Good morning.");
  const jet = norm(
    "jetlag_plan",
    {
      headline: "x",
      directionEast: "true",
      phase: "during",
      clockBasis: "utc",
      blocks: [{ kind: "nap" }],
    },
    fb,
  );
  assert.equal(jet.value.directionEast, true);
  assert.equal(jet.value.phase, "arrival");
  assert.equal(jet.value.clockBasis, "mixed");
  assert.equal(jet.value.blocks[0].kind, "sleep");
  const plan = norm(
    "daily_plan",
    {
      headline: "x",
      riskLevel: "extreme",
      actions: [{ title: "a", priority: "9", category: "hydration" }],
    },
    fb,
  );
  assert.equal(plan.value.riskLevel, "medium");
  assert.equal(plan.value.actions[0].priority, 3);
  assert.equal(plan.value.actions[0].category, "recovery");
  assert.equal(norm("commute", { leaveAt: "soon", advice: "Go" }, fb).value.leaveAt, fb.nowIso);
});

test("insights and swap are validated the same way", () => {
  const ins = normalizeInsights({
    headline: "Protect sleep",
    top_actions: [{ icon: "rocket", title: "a" }, "x", {}, {}, {}],
  });
  assert.equal(ins.ok, true);
  assert.equal(ins.value.top_actions.length, 3);
  assert.equal(ins.value.greeting, "");
  assert.equal(normalizeInsights({ greeting: "hi" }).ok, false);
  const swap = normalizeSwap({
    verdict: "maybe",
    summary: "Think twice.",
    naps: [{ time: "3pm" }, { time: "9:30", duration_min: 500 }],
    risks: "many",
  });
  assert.equal(swap.ok, true);
  assert.equal(swap.value.verdict, "take_with_caveats");
  assert.equal(swap.value.verdict_label, "Take it — with caveats");
  assert.deepEqual(plain(swap.value.naps), [{ time: "09:30", duration_min: 120, why: "" }]);
  assert.deepEqual(plain(swap.value.risks), []);
});

test("fuzz: no model output can make validation throw", () => {
  const values = [
    null,
    true,
    0,
    -1,
    1e309,
    "",
    "x",
    [],
    [null],
    {},
    { a: 1 },
    [{}],
    "critical",
    NaN,
  ];
  const intents = [
    "daily_plan",
    "smart_alarm",
    "commute",
    "coach_tip",
    "right_now",
    "adjust_plan",
    "tomorrow_preview",
    "daily_review",
    "pattern_alert",
    "jetlag_plan",
  ];
  let seed = 7;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const keys = [
    "headline",
    "action",
    "tip",
    "summary",
    "wakeAt",
    "leaveAt",
    "blocks",
    "actions",
    "changes",
    "metrics",
    "urgency",
    "confidence",
    "timeWindow",
    "wins",
    "impact",
    "kind",
    "naps",
    "top_actions",
    "verdict",
  ];
  for (let i = 0; i < 2000; i++) {
    const raw = {};
    for (const k of keys)
      if (rnd() < 0.5)
        raw[k] =
          rnd() < 0.3
            ? [
                {
                  [keys[Math.floor(rnd() * keys.length)]]:
                    values[Math.floor(rnd() * values.length)],
                },
              ]
            : values[Math.floor(rnd() * values.length)];
    for (const intent of intents) assert.doesNotThrow(() => norm(intent, raw, fb));
    assert.doesNotThrow(() => normalizeInsights(raw));
    assert.doesNotThrow(() => normalizeSwap(raw));
  }
});

test("routes validate before responding, and every home card is isolated by an error boundary", () => {
  const ai = readFileSync(new URL("../src/routes/api/ai.ts", import.meta.url), "utf8");
  assert.ok(
    ai.indexOf("normalizeIntentOutput(body.intent") > 0 &&
      ai.indexOf("normalizeIntentOutput(body.intent") < ai.indexOf("persistRecommendation(admin"),
  );
  for (const route of ["insights", "swap"]) {
    const src = readFileSync(new URL(`../src/routes/api/${route}.ts`, import.meta.url), "utf8");
    assert.doesNotMatch(
      src,
      /return Response\.json\(parsed\)/,
      `${route} must not pass model JSON through unvalidated`,
    );
  }
  const card = readFileSync(
    new URL("../src/components/home/HomeCard.tsx", import.meta.url),
    "utf8",
  );
  assert.equal(
    (card.match(/<CardErrorBoundary>\{children\}<\/CardErrorBoundary>/g) ?? []).length,
    2,
  );
});
