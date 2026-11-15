#!/usr/bin/env node
/**
 * Owner-requested Gemini benchmark on the 134-case companion suite.
 *
 *   GEMINI_API_KEY=… node tests/ai/companion/benchmark-gemini.mjs [--repeat 2] [--max-tokens 3000000]
 *
 * Compares RestPilot's current model (gemini-3-flash-preview, baseline) with
 * gemini-2.5-flash (the model LaunchReady uses) and the cheapest Gemini
 * flash-lite tier served to the key. Before running it asks Google's ListModels
 * endpoint which models the key can use and skips the rest, with a note.
 *
 * - Every model and judge call goes through lib/guard.cjs: hard token cap
 *   (default 3M tokens, i.e. a few dollars at paid-tier prices; $0 on the free
 *   tier) and refusal past the cap.
 * - Judge: a non-Gemini judge when OPENAI_API_KEY or ANTHROPIC_API_KEY is set;
 *   otherwise a Gemini judge, labelled as same-family. Deterministic checks
 *   (time math, honesty, safety red flags, format) never depend on the judge.
 * - The key is sent only in the x-goog-api-key / Authorization headers and is
 *   never printed.
 * - Output: results/<stamp>-gemini-report.md (+ the Promptfoo JSON and summary).
 *
 * Without GEMINI_API_KEY it prints "blocked: needs GEMINI_API_KEY repo secret"
 * and exits 0.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai";
const BASELINE = "gemini-3-flash-preview";
const WANTED = [BASELINE, "gemini-2.5-flash"];
// Flash-class judges: Pro models have very small free-tier daily quotas.
const JUDGE_PREFERENCE = ["gemini-3.8-flash", "gemini-3.6-flash", BASELINE];

const outDir = path.join(here, "results");
fs.mkdirSync(outDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const reportFile = path.join(outDir, `${stamp}-gemini-report.md`);
const lines = [];
const say = (s = "") => {
  lines.push(s);
  console.log(s);
};
const finish = (code) => {
  fs.writeFileSync(reportFile, lines.join("\n") + "\n");
  if (process.env.GITHUB_STEP_SUMMARY)
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join("\n") + "\n");
  process.exit(code);
};

say("## RestPilot AI companion benchmark: Gemini models");
say("");

const key = process.env.GEMINI_API_KEY;
if (!key) {
  say("**blocked: needs GEMINI_API_KEY repo secret.** No model was called.");
  finish(0);
}

// 1. Which models does this key serve?
async function listModels() {
  const names = new Set();
  let pageToken = "";
  for (let i = 0; i < 20; i++) {
    const url = new URL("https://generativelanguage.googleapis.com/v1beta/models");
    url.searchParams.set("pageSize", "1000");
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const res = await fetch(url, { headers: { "x-goog-api-key": key } });
    if (!res.ok) throw new Error(`ListModels HTTP ${res.status}`);
    const data = await res.json();
    for (const m of data.models ?? []) {
      if ((m.supportedGenerationMethods ?? []).includes("generateContent"))
        names.add(String(m.name).replace(/^models\//, ""));
    }
    pageToken = data.nextPageToken;
    if (!pageToken) break;
  }
  return names;
}

let served;
try {
  served = await listModels();
} catch (e) {
  say(
    `**blocked: the key could not list models (${e.message}).** Check that GEMINI_API_KEY is a valid Google AI Studio key.`,
  );
  finish(1);
}

const PRICES = require("./prices.json");
const price = (m) => {
  const p = PRICES[m];
  return p ? p.input + p.output : Number.POSITIVE_INFINITY;
};
const flashLites = [...served]
  .filter((m) => /^gemini-[\d.]+-flash-lite(-\d{3})?$/.test(m))
  .sort((a, b) => price(a) - price(b) || a.localeCompare(b));

const models = [];
const notes = [];
for (const m of WANTED) {
  if (served.has(m)) models.push(m);
  else notes.push(`- **${m}**: skipped, not served to this key (retired or not enabled).`);
}
if (flashLites.length) {
  models.push(flashLites[0]);
  notes.push(
    `- Cheapest flash-lite served: **${flashLites[0]}**${Number.isFinite(price(flashLites[0])) ? "" : " (price unknown in prices.json)"}; also served: ${flashLites.slice(1).join(", ") || "none"}.`,
  );
} else {
  notes.push("- No Gemini flash-lite model is served to this key: skipped.");
}
if (!models.length) {
  say("**blocked: none of the requested models is served to this key.**");
  say(notes.join("\n"));
  finish(0);
}

// 2. Judge.
let judgeLabel;
const env = {
  ...process.env,
  PROMPTFOO_DISABLE_TELEMETRY: "1",
  PROMPTFOO_DISABLE_UPDATE: "1",
  PROMPTFOO_DISABLE_SHARING: "1",
  RESTPILOT_EVAL_MAX_TOKENS: opt(
    "--max-tokens",
    process.env.RESTPILOT_EVAL_MAX_TOKENS || "3000000",
  ),
  RESTPILOT_EVAL_LEDGER: path.join(outDir, `${stamp}-ledger.json`),
  RESTPILOT_EVAL_CACHE: "off",
};
if (process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY) {
  delete env.BENCH_JUDGE;
  const vendor = process.env.OPENAI_API_KEY ? "OpenAI" : "Anthropic";
  judgeLabel = `${vendor} judge (different family from every candidate).`;
} else {
  const judge = JUDGE_PREFERENCE.find((m) => served.has(m)) ?? models[0];
  env.BENCH_JUDGE = `google:${judge}`;
  judgeLabel = `**Gemini judge (${judge}): same family as the candidates.** Treat rubric scores (quality, personalization) as indicative; the deterministic checks (time math, honesty, safety, format, tool use) do not use the judge.`;
}

say(`Models run: ${models.map((m) => `\`${m}\``).join(", ")} (baseline \`${BASELINE}\`).`);
say(notes.join("\n"));
say(`Judge: ${judgeLabel}`);
say(
  `Token cap: ${env.RESTPILOT_EVAL_MAX_TOKENS} tokens across all calls (lib/guard.cjs); calls past it are refused, not sent.`,
);
say("");

// 3. Promptfoo config: the same prompts, cases and judge as the benchmark, with
// only the selected Gemini models as providers. Absolute paths, so the file
// can live in results/.
const lib = (f) => `file://${path.join(here, "lib", f)}`;
const config = {
  description: "RestPilot companion benchmark: Gemini models",
  prompts: [
    { id: `${lib("production-prompt.cjs")}:buildMessages`, label: "restpilot-production-prompt" },
  ],
  providers: models.map((m) => ({
    id: lib("app-provider.cjs"),
    label: m,
    config: { baseUrl: BASE_URL, apiKeyEnv: "GEMINI_API_KEY", model: m },
  })),
  defaultTest: { options: { provider: lib("grader.cjs") } },
  tests: `file://${path.join(here, "cases", "index.cjs")}`,
  evaluateOptions: { maxConcurrency: 1 },
  sharing: false,
};
const configFile = path.join(outDir, `${stamp}-gemini.promptfooconfig.json`);
fs.writeFileSync(configFile, JSON.stringify(config, null, 2));

const bin = process.env.PROMPTFOO_BIN
  ? [process.env.PROMPTFOO_BIN]
  : ["npx", "-y", "promptfoo@0.125.1"];
function evalRun(name, extra) {
  const out = path.join(outDir, `${stamp}-gemini-${name}.json`);
  const r = spawnSync(
    bin[0],
    [
      ...bin.slice(1),
      "eval",
      "-c",
      configFile,
      "--no-cache",
      "--no-table",
      "--no-progress-bar",
      "-j",
      "1",
      "-o",
      out,
      ...extra,
    ],
    { stdio: "inherit", env, cwd: here },
  );
  // promptfoo exits 100 when assertions fail, which is a normal benchmark outcome.
  if (r.status !== 0 && r.status !== 100) say(`promptfoo (${name}) exited with ${r.status}.`);
  if (!fs.existsSync(out)) {
    say(`**promptfoo (${name}) produced no results file; no report.**`);
    finish(1);
  }
  return out;
}

const main = evalRun("main", []);
const repeat = Number(opt("--repeat", "2"));
const consistency =
  repeat > 1
    ? evalRun("consistency", ["--filter-metadata", "consistency=true", "--repeat", String(repeat)])
    : null;

// 4. Report (the benchmark's own report: pass rate, quality/relevance, honesty,
// safety, time math, format, personalization, tool use, safety-case failures,
// latency p50/p95, TTFT, cost per call and per run, consistency).
const rep = spawnSync(
  process.execPath,
  [path.join(here, "report.mjs"), main, ...(consistency ? [consistency] : [])],
  { encoding: "utf8", env },
);
say(rep.stdout || "");
if (rep.status !== 0) say(`report.mjs exited ${rep.status}: ${rep.stderr}`);
try {
  const ledger = JSON.parse(fs.readFileSync(env.RESTPILOT_EVAL_LEDGER, "utf8"));
  say("");
  say(
    `Spend guard: ${ledger.used} tokens used in ${ledger.calls} calls of a ${ledger.cap}-token cap; ${ledger.refused} refused by the cap.`,
  );
  if (ledger.refused)
    say(
      "**Some calls were refused by the cap; scores for those cases are missing (reported as errors).**",
    );
} catch {
  /* no ledger: no paid calls were made */
}
say("");
say(
  "Costs use list prices from tests/ai/companion/prices.json. On the Gemini free tier the actual charge is $0 (free-tier inputs may be used by Google to improve its products; this suite is synthetic, no customer data).",
);
finish(0);
