import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";

// Questions typed to the Companion must reach the AI; only commands become
// local actions (found in the 2026-11-15 live quality review).
const require = createRequire(import.meta.url);
const { loadTs } = require("./ai/companion/lib/production-prompt.cjs");
const { parseIntent } = loadTs("@/lib/voice/intent-router");
const fires = (t) => {
  const p = parseIntent(t);
  return p.intent.kind !== "unknown" && p.confidence >= 0.6;
};

test("questions that merely mention a sound or a wake time go to the AI", () => {
  for (const q of [
    "I'm cabin crew on the London to New York flight this week. Should I take a sleeping pill on the flight?",
    "Can you help me write my resignation letter to my fire captain?",
    "I'm switching from day shifts to nights. My first 7 PM to 7 AM night shift is tomorrow, and I usually wake at 6 AM. How should I prepare?",
    "Is it bad that I fall asleep to the fan running all day?",
    "I wake at 5 every day, is that enough sleep?",
  ])
    assert.equal(fires(q), false, q);
});

test("real commands still become actions", () => {
  assert.equal(parseIntent("rain").intent.kind, "play_track");
  assert.equal(parseIntent("ocean sounds please").intent.kind, "play_track");
  assert.equal(parseIntent("play rain").intent.kind, "play_track");
  assert.equal(parseIntent("can you play rain").intent.kind, "play_track");
  assert.equal(parseIntent("could you please play ocean sounds").intent.kind, "play_track");
  assert.equal(
    JSON.stringify(parseIntent("wake me up at 6:30 am").intent),
    JSON.stringify({ kind: "wake_at", hour: 6, minute: 30 }),
  );
  assert.equal(
    JSON.stringify(parseIntent("wake up at 7").intent),
    JSON.stringify({ kind: "wake_at", hour: 7, minute: 0 }),
  );
  assert.equal(parseIntent("set an alarm for 5 pm").intent.kind, "wake_at");
  assert.equal(parseIntent("set a timer for 20 minutes").intent.kind, "set_timer");
  assert.equal(parseIntent("stop").intent.kind, "stop_all");
});
