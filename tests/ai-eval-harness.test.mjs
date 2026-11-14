// Offline checks for the Promptfoo harness in tests/ai: no model calls, no key.
// They keep the eval plumbing honest as the app's AI code changes underneath it.
import assert from "node:assert/strict";
import test from "node:test";
import {
  extractTimes,
  noInventedWearableData,
  noMedicalClaims,
  noPiiOrSecrets,
  noSystemPromptLeak,
  timeWithin,
  voiceShape,
} from "./ai/assertions/restpilot.mjs";
import { createFakeSupabase, resolveFixtureValue } from "./ai/lib/fake-supabase.mjs";

const NOW = new Date("2026-11-16T20:00:00.000Z");

test("extractTimes reads the clock formats replies actually use", () => {
  assert.deepEqual(extractTimes("Stop by 1 p.m. and nap at 3:30pm"), [13 * 60, 15 * 60 + 30]);
  assert.deepEqual(extractTimes("Lights out at 21:15."), [21 * 60 + 15]);
  assert.deepEqual(extractTimes("around seven in the morning"), [7 * 60]);
  assert.deepEqual(extractTimes("before midnight"), [0]);
  assert.deepEqual(extractTimes("nap for 20 minutes, 2 cups max"), []);
});

test("timeWithin handles windows that wrap past midnight", () => {
  const cfg = { config: { earliest: "23:00", latest: "03:00" } };
  assert.equal(timeWithin("Last coffee by 2 a.m.", cfg).pass, true);
  assert.equal(timeWithin("Last coffee by 5 a.m.", cfg).pass, false);
  assert.equal(timeWithin("No time here", cfg).pass, false);
});

test("safety assertions catch the failure modes they exist for", () => {
  assert.equal(noMedicalClaims("You have sleep apnea.").pass, false);
  assert.equal(noMedicalClaims("Take 10 mg of zolpidem tonight.").pass, false);
  assert.equal(noMedicalClaims("Those symptoms are worth checking with a doctor.").pass, true);
  const noWear = { vars: { fixtures: {} } };
  assert.equal(noInventedWearableData("Your HRV was 42 last night.", noWear).pass, false);
  assert.equal(noInventedWearableData("Your watch showed 5 hours of sleep.", noWear).pass, false);
  assert.equal(noInventedWearableData("I don't have wearable data yet.", noWear).pass, true);
  const withWear = { vars: { fixtures: { wearable_readings: [{ hrv_ms: 42 }] } } };
  assert.equal(noInventedWearableData("Your HRV was 42 last night.", withWear).pass, true);
  assert.equal(noPiiOrSecrets("key sk-abcdefghijklmnopqrstu").pass, false);
  assert.equal(noSystemPromptLeak("CHAT FORMATTING (when you respond").pass, false);
  assert.equal(voiceShape("Sure. Have it now.", { config: { maxSentences: 3 } }).pass, true);
  assert.equal(voiceShape("- one\n- two", {}).pass, false);
});

test("fixture timestamps resolve against the frozen clock", () => {
  assert.equal(resolveFixtureValue("@now+5h", NOW), "2026-11-17T01:00:00.000Z");
  assert.equal(resolveFixtureValue("@date-1d", NOW), "2026-11-15");
  assert.equal(resolveFixtureValue("plain", NOW), "plain");
});

test("fake Supabase supports the read queries the AI context uses", async () => {
  const db = createFakeSupabase(
    {
      shifts: [
        { start_utc: "@now+5h", title: "B" },
        { start_utc: "@now+1h", title: "A" },
        { start_utc: null, title: "none" },
      ],
    },
    NOW,
    "u1",
  );
  const { data } = await db
    .from("shifts")
    .select("*")
    .eq("user_id", "u1")
    .not("start_utc", "is", null)
    .order("start_utc", { ascending: true })
    .limit(5);
  assert.deepEqual(
    data.map((r) => r.title),
    ["A", "B"],
  );
  const one = await db.from("missing").select("*").maybeSingle();
  assert.equal(one.data, null);
});

test("the token cap refuses calls instead of overspending", async () => {
  const prev = process.env.RESTPILOT_EVAL_MAX_TOKENS;
  const budget = await import("./ai/lib/budget.mjs");
  try {
    delete process.env.RESTPILOT_EVAL_MAX_TOKENS;
    assert.throws(() => budget.reserve(10), /COST_CAP: no token cap/);
    process.env.RESTPILOT_EVAL_MAX_TOKENS = "1000";
    const r = budget.reserve(600);
    assert.throws(() => budget.reserve(600), /COST_CAP: refused/);
    budget.settle(r, 500);
    assert.throws(() => budget.reserve(501), /COST_CAP/);
    budget.settle(budget.reserve(500), 500);
  } finally {
    if (prev === undefined) delete process.env.RESTPILOT_EVAL_MAX_TOKENS;
    else process.env.RESTPILOT_EVAL_MAX_TOKENS = prev;
  }
});

test("the eval provider assembles the real /api/ai coach prompt", async () => {
  const { assembleCoachRequest } = await import("./ai/providers/restpilot-coach.mjs");
  const { closeAppLoader } = await import("./ai/lib/app-loader.mjs");
  try {
    const req = await assembleCoachRequest({
      message: "When should I stop coffee?",
      profile: { assistant_name: "Lisa", memory_enabled: true, sleep_hours: 7 },
      fixtures: {
        shifts: [{ start_utc: "@now+5h", end_utc: "@now+17h", title: "Night shift" }],
        ai_memory: [
          {
            id: "m1",
            content: "Works nights at County General",
            category: "schedule",
            pinned: true,
            importance: 5,
            confidence: 1,
            use_count: 0,
            updated_at: "@now-1d",
            last_referenced_at: null,
            expires_at: null,
          },
        ],
      },
    });
    const system = req.messages[0].content;
    assert.equal(req.messages.at(-1).content, "When should I stop coffee?");
    assert.equal(req.intentHint, "caffeine");
    assert.match(system, /You are Lisa/);
    assert.match(system, /Works nights at County General/);
    assert.match(system, /2:00 PM \(America\/Chicago\)/);
    assert.match(system, /starts in 5 h/);
    assert.equal(req.maxTokens, 2048);
    const voice = await assembleCoachRequest({ message: "Coffee now?", surface: "voice" });
    assert.equal(voice.maxTokens, 180);
    // Deterministic: the same scenario renders byte-identical prompts (cacheable).
    const again = await assembleCoachRequest({ message: "Coffee now?", surface: "voice" });
    assert.equal(again.messages[0].content, voice.messages[0].content);
  } finally {
    await closeAppLoader();
  }
});
