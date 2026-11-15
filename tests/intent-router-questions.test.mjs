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
    "Can you start by explaining why rain sounds help some people fall asleep?",
    "Could you start a list of reasons the fan keeps me awake?",
    "Would you start my morning brief and tell me if rain is expected?",
    "Can you play a role in helping me with the noise from my fan?",
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

test("more questions stay with the AI (independent review probes)", () => {
  for (const q of [
    "Is rain bad?",
    "Fan or rain?",
    "rain check",
    "Start by explaining why rain sounds help",
    "I want to know why rain helps me sleep",
    "I need advice about my fan",
    "Could you play fire safety tips",
    "Can you play the fan game",
    "My kids wake me up at 5 every day, how can I cope?",
    "The baby tends to wake me up at 3 am and I cannot get back to sleep",
    "Is a timer for 30 minutes enough?",
    "Should I set an alarm for 6 or 7?",
    "Can you play rain all night, or is that bad?",
  ])
    assert.equal(fires(q), false, q);
});

test("short and polite commands still act", () => {
  for (const c of [
    "rain",
    "Rain, please.",
    "ocean sounds please",
    "play rain",
    "play rain for 30 minutes",
    "play some relaxing rain",
    "put on white noise",
    "can you play rain",
    "could you put on ocean sounds",
    "could you play rain for 20 minutes",
    "i want rain",
    "rain sounds for 20 minutes please",
  ])
    assert.equal(parseIntent(c).intent.kind, "play_track", c);
  for (const c of [
    "I need to wake up at 6",
    "I want to wake up at 7",
    "please wake me at 6",
    "can you wake me up at 6",
  ])
    assert.equal(parseIntent(c).intent.kind, "wake_at", c);
});

test("polite commands with a question mark act; statements about waking or timers do not", () => {
  for (const [c, kind] of [
    ["Can you wake me up at 6:30?", "wake_at"],
    ["Could you set an alarm for 6?", "wake_at"],
    ["Can you set a timer for 30 minutes?", "set_timer"],
    ["can you play rain?", "play_track"],
    ["turn on the fan", "play_track"],
    ["i'd like rain", "play_track"],
  ])
    assert.equal(parseIntent(c).intent.kind, kind, c);
  for (const s of [
    "I usually wake at 6",
    "My kids wake me up at 5",
    "Never wake me up at 5",
    "I don't want to wake up at 5",
    "my timer for 20 minutes didn't work",
    "the sleep timer 30 minutes is too short",
    "play fire safety tips",
  ])
    assert.equal(fires(s), false, s);
});

test("'can you' questions stay with the AI; lead-ins and alias phrases still act", () => {
  for (const q of [
    "Can you explain why I wake up at 3 am every night?",
    "Can you help me figure out why I wake up at 5?",
    "Can you tell me if a sleep timer for 30 minutes is enough?",
    "Can you wake me up at 6 or is that too early?",
    "I need to wake up at 6 but I cannot fall asleep before 1, what do I do?",
  ])
    assert.equal(fires(q), false, q);
  for (const [c, kind] of [
    ["hey, wake me up at 6", "wake_at"],
    ["ok set an alarm for 6", "wake_at"],
    ["wake me up at 6?", "wake_at"],
    ["could you start a timer for 30 minutes please", "set_timer"],
    ["sleep sounds", "play_track"],
    ["i want something relaxing", "play_track"],
  ])
    assert.equal(parseIntent(c).intent.kind, kind, c);
});

test("a duration does not turn a question into a sound; common command endings still act", () => {
  for (const q of [
    "Can you play rain for 8 hours, or is that bad?",
    "Play rain for 8 hours, is that safe?",
    "rain for 8 hours is that bad",
    "set a timer for 30 minutes is enough?",
  ])
    assert.equal(fires(q), false, q);
  for (const [c, kind] of [
    ["wake me up at 6 tomorrow morning please", "wake_at"],
    ["set an alarm at 6 for work tomorrow", "wake_at"],
    ["could you play rain for 20 minutes", "play_track"],
  ])
    assert.equal(parseIntent(c).intent.kind, kind, c);
});
