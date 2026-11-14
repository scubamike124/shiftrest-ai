#!/usr/bin/env node
/**
 * One-command RestPilot companion benchmark.
 *
 *   node tests/ai/companion/run.mjs                 # every provider whose key is set
 *   node tests/ai/companion/run.mjs --only gemini   # regex over provider labels
 *   node tests/ai/companion/run.mjs --repeat 3      # consistency repeats (default 3, on the consistency subset)
 *   node tests/ai/companion/run.mjs --offline       # $0 self-test, no key, no network
 *
 * Keys (names only; values never printed): GEMINI_API_KEY (Google AI Studio;
 * free tier covers every Gemini model listed), OPENAI_API_KEY, ANTHROPIC_API_KEY,
 * optional LOVABLE_API_KEY (the production gateway). Judge: BENCH_JUDGE or the
 * first available of OpenAI / Anthropic / Google. BENCH_NO_JUDGE=1 skips rubrics.
 * PROMPTFOO_BIN overrides the pinned `npx -y promptfoo@0.125.1`.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const opt = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : fallback;
};

const KEYS = {
  GEMINI_API_KEY: ["current-gemini-3-flash-preview", "cand-gemini-3.1-flash-lite", "cand-gemini-3.5-flash-lite", "cand-gemini-3.6-flash", "cand-gemini-3.8-flash", "cand-gemini-4-hydrogen"],
  LOVABLE_API_KEY: ["current-via-lovable-gateway"],
  OPENAI_API_KEY: ["cand-gpt-6-luna", "cand-gpt-6.1-terra", "cand-gpt-6.1-sol"],
  ANTHROPIC_API_KEY: ["cand-claude-haiku-5-5", "cand-claude-sonnet-5-5"],
};

const offline = flag("--offline");
let labels = offline ? ["offline-selftest"] : Object.entries(KEYS).filter(([k]) => process.env[k]).flatMap(([, l]) => l);
const only = opt("--only");
if (only) labels = labels.filter((l) => new RegExp(only, "i").test(l));

if (!labels.length) {
  console.log("Benchmark PENDING KEY: no provider key is set.");
  console.log("Needed: GEMINI_API_KEY (Google AI Studio, free tier) to measure the current model and Gemini candidates;");
  console.log("        OPENAI_API_KEY and/or ANTHROPIC_API_KEY for those candidates. See AI-BENCHMARK.md for cost.");
  process.exit(2);
}
const hasCurrent = labels.some((l) => l.startsWith("current-"));
if (!offline && !hasCurrent) console.log("WARNING: the current production model is not in this run, so results are not a comparison against it.");

const env = { ...process.env, PROMPTFOO_DISABLE_TELEMETRY: "1", PROMPTFOO_DISABLE_UPDATE: "1" };
if (offline) env.BENCH_NO_JUDGE = "1";
const outDir = path.join(here, "results");
mkdirSync(outDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const bin = process.env.PROMPTFOO_BIN ? [process.env.PROMPTFOO_BIN] : ["npx", "-y", "promptfoo@0.125.1"];
const filter = `^(${labels.map((l) => l.replace(/[.]/g, "\\.")).join("|")})$`;

function evalRun(name, extra) {
  const out = path.join(outDir, `${stamp}-${name}.json`);
  const cmd = [...bin.slice(1), "eval", "-c", path.join(here, "benchmark.promptfooconfig.yaml"), "--filter-providers", filter, "--no-cache", "--no-table", "-o", out, ...extra];
  console.log(`\n> promptfoo eval (${name}) for ${labels.join(", ")}`);
  const r = spawnSync(bin[0], cmd, { stdio: "inherit", env, cwd: here });
  if (r.status !== 0 && r.status !== 100) {
    // promptfoo exits 100 when some assertions fail, which is a normal benchmark outcome
    console.error(`promptfoo exited with ${r.status}`);
    process.exit(r.status ?? 1);
  }
  return out;
}

const main = evalRun("main", ["-j", opt("-j", offline ? "8" : "2")]);
const repeat = opt("--repeat", "3");
const consistency = Number(repeat) > 1 ? evalRun("consistency", ["--filter-metadata", "consistency=true", "--repeat", repeat, "-j", "2"]) : null;

const report = spawnSync(process.execPath, [path.join(here, "report.mjs"), main, ...(consistency ? [consistency] : [])], { stdio: "inherit", env });
process.exit(report.status ?? 0);
