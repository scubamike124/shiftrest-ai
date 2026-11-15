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
    "My first 7 PM to 7 AM night shift is tomorrow, and I usually wake at 6 AM. How should I prepare?",
    "I wake at 5 every day, is that enough sleep?",
  ])
    assert.equal(fires(q), false, q);
});

test("commands still become actions", () => {
  assert.equal(parseIntent("rain").intent.kind, "play_track");
  assert.equal(parseIntent("play rain").intent.kind, "play_track");
  assert.equal(
    JSON.stringify(parseIntent("wake me up at 6:30 am").intent),
    JSON.stringify({ kind: "wake_at", hour: 6, minute: 30 }),
  );
  assert.equal(parseIntent("set an alarm for 5 pm").intent.kind, "wake_at");
  assert.equal(parseIntent("set a timer for 20 minutes").intent.kind, "set_timer");
});
