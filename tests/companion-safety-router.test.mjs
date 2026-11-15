// From the 2026-11-15 AI quality review: the spoken Companion prompt must carry
// the safety-and-care rules, the coach prompt must not ask for doses, and
// questions must reach the AI instead of becoming a sound or alarm action.
import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const SRC = path.resolve(import.meta.dirname, "../src");
const cache = new Map();
const sandbox = vm.createContext({ console, URL, process: { env: {} } });
function resolve(spec, from) {
  const base = spec.startsWith("@/") ? path.join(SRC, spec.slice(2)) : path.resolve(from, spec);
  for (const f of [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts")])
    if (existsSync(f) && statSync(f).isFile()) return f;
  throw new Error(`cannot resolve ${spec}`);
}
function load(file) {
  if (cache.has(file)) return cache.get(file).exports;
  const module = { exports: {} };
  cache.set(file, module);
  const js = ts.transpileModule(readFileSync(file, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  }).outputText;
  const req = (spec) => {
    if (spec.startsWith("@/") || spec.startsWith("."))
      return load(resolve(spec, path.dirname(file)));
    throw new Error(`external import ${spec} in ${file}`);
  };
  vm.runInContext(`(function (exports, require, module) {${js}\n})`, sandbox)(
    module.exports,
    req,
    module,
  );
  return module.exports;
}
const app = (p) => load(resolve(p, SRC));

test("spoken Companion prompt carries the safety-and-care rules", () => {
  const { PILOT_VOICE_SYSTEM } = app("@/lib/ai/prompts.server");
  assert.match(PILOT_VOICE_SYSTEM, /SAFETY AND CARE/);
  assert.match(PILOT_VOICE_SYSTEM, /988/);
  assert.match(PILOT_VOICE_SYSTEM, /911/);
  assert.match(PILOT_VOICE_SYSTEM, /never give a dose/);
});

test("text coach prompt (coach intent only) appends the rules and never asks for doses", () => {
  const src = readFileSync(path.join(SRC, "lib/ai/context.server.ts"), "utf8");
  const chat = src.indexOf("CHAT FORMATTING");
  const safety = src.indexOf("prompt += `\\n\\n${SAFETY_AND_CARE}`");
  assert.ok(
    chat > 0 && safety > chat,
    "appended after the chat formatting rules, inside the coach branch",
  );
  assert.doesNotMatch(
    src.slice(src.indexOf("function renderPersonality"), chat),
    /SAFETY_AND_CARE/,
    "not in the shared personality used by JSON intents",
  );
  assert.doesNotMatch(src, /exact times, durations, doses/);
  assert.doesNotMatch(src, /timing, dose, or duration/);
});

const { parseIntent } = app("@/lib/voice/intent-router");
const fires = (t) => {
  const p = parseIntent(t);
  return p.intent.kind !== "unknown" && p.confidence >= 0.6;
};

test("questions that mention a sound or a wake time go to the AI", () => {
  for (const q of [
    "I'm cabin crew on the London to New York flight this week. Should I take a sleeping pill on the flight?",
    "Can you help me write my resignation letter to my fire captain?",
    "Can you start by explaining why rain sounds help some people fall asleep?",
    "Could you start a list of reasons the fan keeps me awake?",
    "Would you start my morning brief and tell me if rain is expected?",
    "Can you play a role in helping me with the noise from my fan?",
    "My first 7 PM to 7 AM night shift is tomorrow, and I usually wake at 6 AM. How should I prepare?",
    "I wake at 5 every day, is that enough sleep?",
  ])
    assert.equal(fires(q), false, q);
});

test("commands still become actions", () => {
  assert.equal(parseIntent("rain").intent.kind, "play_track");
  assert.equal(parseIntent("play rain").intent.kind, "play_track");
  assert.equal(parseIntent("can you play rain").intent.kind, "play_track");
  assert.equal(parseIntent("could you please play ocean sounds").intent.kind, "play_track");
  assert.equal(
    JSON.stringify(parseIntent("wake me up at 6:30 am").intent),
    JSON.stringify({ kind: "wake_at", hour: 6, minute: 30 }),
  );
  assert.equal(parseIntent("set an alarm for 5 pm").intent.kind, "wake_at");
  assert.equal(parseIntent("set a timer for 20 minutes").intent.kind, "set_timer");
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

test("spoken alarm times with a.m./p.m. and lead-ins before play still act", () => {
  assert.equal(
    JSON.stringify(parseIntent("Wake me up at 6 a.m.").intent),
    JSON.stringify({ kind: "wake_at", hour: 6, minute: 0 }),
  );
  assert.equal(
    JSON.stringify(parseIntent("Set an alarm for 6:30 p.m.").intent),
    JSON.stringify({ kind: "wake_at", hour: 18, minute: 30 }),
  );
  assert.equal(parseIntent("wake me up at 6 o'clock").intent.kind, "wake_at");
  for (const c of [
    "hey play rain",
    "ok play rain",
    "hey can you play white noise",
    "could you turn on white noise",
  ])
    assert.equal(parseIntent(c).intent.kind, "play_track", c);
  for (const q of ["stop the rain", "i want the fire to stop"])
    assert.notEqual(parseIntent(q).intent.kind, "play_track", q);
});

test("alarms with a time of day after them still act", () => {
  for (const [c, hour] of [
    ["set an alarm for 6 in the morning", 6],
    ["wake me up at 6 in the morning", 6],
    ["wake me at 6 tomorrow for my night shift", 6],
    ["wake me up at 5 in the afternoon", 17],
    ["set an alarm for 9 tonight", 21],
  ]) {
    const p = parseIntent(c);
    assert.equal(p.intent.kind, "wake_at", c);
    assert.equal(p.intent.hour, hour, c);
  }
});

test("sound requests with common endings, timer leads and 'tonight' hours", () => {
  for (const c of [
    "play rain all night",
    "play rain for an hour",
    "can you play rain for me",
    "could you play rain to help me sleep",
  ])
    assert.equal(parseIntent(c).intent.kind, "play_track", c);
  for (const c of ["I need a timer for 30 minutes", "turn on a sleep timer for 30 minutes"])
    assert.equal(parseIntent(c).intent.kind, "set_timer", c);
  assert.equal(parseIntent("wake me up at 1 tonight").intent.hour, 1);
  assert.equal(parseIntent("set an alarm for 12 tonight").intent.hour, 0);
  assert.equal(parseIntent("set an alarm for 6 on Monday").intent.kind, "wake_at");
});

test("phone keyboards' curly apostrophes work like straight ones", () => {
  assert.equal(parseIntent("I\u2019d like rain").intent.kind, "play_track");
  assert.equal(parseIntent("wake me up at 6 o\u2019clock").intent.kind, "wake_at");
});
