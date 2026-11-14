#!/usr/bin/env node
// Cost-capped entry point for RestPilot AI evals (Promptfoo).
//
//   node tests/ai/run-evals.mjs [--smoke] [--compare] [--repeat N] [--no-cache]
//                               [--max-tokens N] [--filter-pattern RE] [--dry-run]
//                               [--strict]
//
// What it guarantees:
//   - a hard token cap (default 40k for --smoke, 1.5M otherwise) that every
//     model call, including llm-rubric grading, reserves against before it is
//     sent; calls past the cap are refused, never made;
//   - a preflight estimate that refuses to start an uncached run whose worst
//     case is already over the cap;
//   - "blocked" (exit 0, unless --strict) rather than a fake pass when no AI
//     key is configured and the response cache cannot answer every call;
//   - summary.json + summary.md in tests/ai/.results, appended to the GitHub
//     job summary when running in Actions.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const PROMPTFOO_VERSION = "0.125.1";

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const opt = (name, fallback) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};

const smoke = flag("--smoke");
const compare = flag("--compare");
const noCache = flag("--no-cache");
const dryRun = flag("--dry-run");
const strict = flag("--strict");
const repeat = Math.max(1, Number(opt("--repeat", "1")) || 1);
const filterPattern = opt("--filter-pattern", "");
const maxTokens = Number(
  opt("--max-tokens", process.env.RESTPILOT_EVAL_MAX_TOKENS || (smoke ? 40_000 : 1_500_000)),
);
const outDir = path.resolve(opt("--out", path.join(here, ".results")));

// Worst-case per call: assembled prompt (~3.5k tokens with memories/signals)
// + output ceiling, plus one llm-rubric grading call when the test has one.
const EST_CALL = 3_500 + 2_048;
const EST_GRADE = 2_500 + 2_048;

function loadScenarios() {
  const dir = path.join(here, "scenarios");
  const files = fs.readdirSync(dir).filter((f) => /\.ya?ml$/.test(f));
  const tests = [];
  for (const f of files) {
    const text = fs.readFileSync(path.join(dir, f), "utf8");
    // Count tests without a YAML dependency: top-level "- description:" items.
    const items = text.split(/\n(?=- )/).filter((b) => /^-\s+description:/m.test(b.trimStart()));
    for (const b of items) {
      tests.push({
        file: f,
        description: (/description:\s*"?([^"\n]+)"?/.exec(b) || [])[1] || "",
        smoke: /\n\s+smoke:\s*true\b/.test(b),
        rubric: (
          b.match(
            /type:\s*(llm-rubric|g-eval|factuality|model-graded-closedqa|answer-relevance)/g,
          ) || []
        ).length,
      });
    }
  }
  return tests;
}

function promptfooCommand() {
  const local = path.resolve(here, "../../node_modules/.bin/promptfoo");
  if (process.env.PROMPTFOO_BIN) return [process.env.PROMPTFOO_BIN, []];
  if (fs.existsSync(local)) return [local, []];
  return ["npx", ["-y", `promptfoo@${PROMPTFOO_VERSION}`]];
}

function pct(n, d) {
  return d ? Math.round((n / d) * 1000) / 10 : 0;
}

function quantile(values, q) {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))];
}

function summarise(resultsFile, ledger, meta) {
  const raw = JSON.parse(fs.readFileSync(resultsFile, "utf8"));
  const rows = raw.results?.results ?? raw.results ?? [];
  const byProvider = {};
  const consistency = {};
  for (const r of rows) {
    const label = r.provider?.label || r.provider?.id || "provider";
    const p = (byProvider[label] ??= {
      total: 0,
      pass: 0,
      fail: 0,
      error: 0,
      blocked: 0,
      cached: 0,
      latency: [],
      ttft: [],
      tokens: 0,
      cost: 0,
      metrics: {},
      failures: [],
    });
    p.total += 1;
    const err = r.error || r.response?.error || "";
    if (/BLOCKED|COST_CAP/.test(err)) p.blocked += 1;
    else if (err && !r.gradingResult) p.error += 1;
    else if (r.success) p.pass += 1;
    else p.fail += 1;
    if (r.response?.cached) p.cached += 1;
    const m = r.response?.metadata ?? {};
    if (m.latencyMs) p.latency.push(m.latencyMs);
    if (m.ttftMs) p.ttft.push(m.ttftMs);
    p.tokens += r.response?.tokenUsage?.total ?? 0;
    p.cost += r.cost ?? r.response?.cost ?? 0;
    for (const [k, v] of Object.entries(r.namedScores ?? {})) {
      const s = (p.metrics[k] ??= { sum: 0, n: 0 });
      s.sum += Number(v) || 0;
      s.n += 1;
    }
    if (!r.success) {
      p.failures.push({
        test: r.testCase?.description ?? `#${r.testIdx}`,
        reason: String(err || r.failureReason || r.gradingResult?.reason || "").slice(0, 300),
      });
    }
    const key = `${label}::${r.testCase?.description ?? r.testIdx}`;
    (consistency[key] ??= []).push(Boolean(r.success));
  }
  const providers = Object.fromEntries(
    Object.entries(byProvider).map(([label, p]) => [
      label,
      {
        total: p.total,
        pass: p.pass,
        fail: p.fail,
        error: p.error,
        blocked: p.blocked,
        cached: p.cached,
        passRatePct: pct(p.pass, p.total - p.blocked),
        latencyMsP50: quantile(p.latency, 0.5),
        latencyMsP95: quantile(p.latency, 0.95),
        ttftMsP50: quantile(p.ttft, 0.5),
        tokens: p.tokens,
        costUsd: Number(p.cost.toFixed(4)),
        metrics: Object.fromEntries(
          Object.entries(p.metrics).map(([k, s]) => [k, Math.round((s.sum / s.n) * 100) / 100]),
        ),
        failures: p.failures.slice(0, 25),
      },
    ]),
  );
  let consistencyPct = null;
  if (repeat > 1) {
    const groups = Object.values(consistency).filter((g) => g.length > 1);
    const stable = groups.filter((g) => g.every((x) => x === g[0])).length;
    consistencyPct = pct(stable, groups.length);
  }
  return { ...meta, ledger, providers, consistencyPct };
}

function toMarkdown(s) {
  const lines = [`### RestPilot AI evals (${s.mode})`, ""];
  if (s.status === "blocked") lines.push(`**Status: BLOCKED** - ${s.blockedReason}`, "");
  lines.push(
    `Token cap ${s.ledger?.cap ?? s.maxTokens}; used ${s.ledger?.used ?? 0} in ${s.ledger?.calls ?? 0} paid calls; ${s.ledger?.cachedHits ?? 0} cache hits; ${s.ledger?.refused ?? 0} refused by cap.`,
    "",
  );
  if (s.providers && Object.keys(s.providers).length) {
    lines.push(
      "| Model | Pass | Fail | Error | Blocked | Pass rate | p50 latency | p95 latency | Tokens | Cost |",
      "|---|---|---|---|---|---|---|---|---|---|",
    );
    for (const [label, p] of Object.entries(s.providers)) {
      lines.push(
        `| ${label} | ${p.pass} | ${p.fail} | ${p.error} | ${p.blocked} | ${p.passRatePct}% | ${p.latencyMsP50 ?? "-"} ms | ${p.latencyMsP95 ?? "-"} ms | ${p.tokens} | $${p.costUsd} |`,
      );
    }
    lines.push("");
    for (const [label, p] of Object.entries(s.providers)) {
      const m = Object.entries(p.metrics)
        .map(([k, v]) => `${k} ${v}`)
        .join(", ");
      if (m) lines.push(`- **${label}** metric averages: ${m}`);
      for (const f of p.failures.slice(0, 10))
        lines.push(`  - FAIL ${f.test}: ${f.reason.replace(/\n/g, " ")}`);
    }
  }
  if (s.consistencyPct !== null && s.consistencyPct !== undefined)
    lines.push(
      "",
      `Consistency across ${s.repeat} repeats: ${s.consistencyPct}% of scenarios gave the same verdict every time.`,
    );
  return lines.join("\n") + "\n";
}

function finish(summary, code) {
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "summary.json"), JSON.stringify(summary, null, 2));
  const md = toMarkdown(summary);
  fs.writeFileSync(path.join(outDir, "summary.md"), md);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, md);
  console.log(md);
  process.exit(code);
}

// ---------------------------------------------------------------- preflight
const scenarios = loadScenarios()
  .filter((t) => (smoke ? t.smoke : true))
  .filter((t) => (filterPattern ? new RegExp(filterPattern).test(t.description) : true));
const providerCount = compare ? 2 : 1;
const worstCase =
  scenarios.reduce((n, t) => n + EST_CALL + t.rubric * EST_GRADE, 0) * providerCount * repeat;
const hasKey = Boolean(process.env.AI_API_KEY || process.env.OPENAI_API_KEY);
const meta = {
  mode: [
    smoke ? "smoke" : "full",
    compare ? "compare" : null,
    repeat > 1 ? `repeat x${repeat}` : null,
    noCache ? "no-cache" : "cached",
  ]
    .filter(Boolean)
    .join(", "),
  repeat,
  maxTokens,
  scenarios: scenarios.length,
  worstCaseTokens: worstCase,
  models: {
    current: process.env.AI_CHAT_MODEL || null,
    candidate: compare ? process.env.AI_CANDIDATE_MODEL || null : undefined,
  },
  startedAt: new Date().toISOString(),
};
console.log(
  `[evals] ${scenarios.length} scenario(s), ${providerCount} model(s), repeat ${repeat}; worst case ~${worstCase} tokens; cap ${maxTokens}.`,
);

if (!scenarios.length)
  finish({ ...meta, status: "error", blockedReason: "no scenarios matched" }, 1);
if (compare && !process.env.AI_CANDIDATE_MODEL) {
  finish(
    { ...meta, status: "blocked", blockedReason: "needs AI_CANDIDATE_MODEL for --compare" },
    strict ? 1 : 0,
  );
}
if (noCache && !dryRun && worstCase > maxTokens) {
  finish(
    {
      ...meta,
      status: "refused",
      blockedReason: `uncached worst case ~${worstCase} tokens exceeds the ${maxTokens}-token cap; raise --max-tokens deliberately or narrow the run`,
    },
    1,
  );
}
if (!hasKey && !dryRun) {
  console.log(
    "[evals] No AI key: running from the response cache only; any miss is reported as BLOCKED.",
  );
}

// ---------------------------------------------------------------- run
fs.mkdirSync(outDir, { recursive: true });
const ledger = path.join(outDir, "ledger.json");
fs.rmSync(ledger, { force: true });
const resultsFile = path.join(outDir, "results.json");
fs.rmSync(resultsFile, { force: true });

const [cmd, pre] = promptfooCommand();
const args = [...pre, "eval", "-c", path.join(here, "promptfooconfig.yaml")];
if (compare) args.push("-c", path.join(here, "promptfooconfig.compare.yaml"));
if (smoke) args.push("--filter-metadata", "smoke=true");
if (filterPattern) args.push("--filter-pattern", filterPattern);
if (repeat > 1) args.push("--repeat", String(repeat));
if (noCache) args.push("--no-cache");
args.push(
  "--max-concurrency",
  process.env.RESTPILOT_EVAL_CONCURRENCY || "4",
  "--no-share",
  "--no-progress-bar",
  "--no-table",
  "-o",
  resultsFile,
  "-o",
  path.join(outDir, "report.html"),
);

const env = {
  ...process.env,
  RESTPILOT_EVAL_MAX_TOKENS: String(maxTokens),
  RESTPILOT_EVAL_LEDGER: ledger,
  RESTPILOT_EVAL_DRY_RUN: dryRun ? "1" : process.env.RESTPILOT_EVAL_DRY_RUN || "",
  RESTPILOT_EVAL_CACHE: noCache ? "off" : process.env.RESTPILOT_EVAL_CACHE || "on",
  PROMPTFOO_DISABLE_TELEMETRY: "1",
  PROMPTFOO_DISABLE_UPDATE: "1",
  PROMPTFOO_DISABLE_SHARING: "1",
  PROMPTFOO_CONFIG_DIR: process.env.PROMPTFOO_CONFIG_DIR || path.join(here, ".cache", "promptfoo"),
};
const run = spawnSync(cmd, args, { stdio: "inherit", env, cwd: here });

const ledgerData = fs.existsSync(ledger)
  ? JSON.parse(fs.readFileSync(ledger, "utf8"))
  : { cap: maxTokens, used: 0, calls: 0, cachedHits: 0, refused: 0 };
if (!fs.existsSync(resultsFile)) {
  finish(
    {
      ...meta,
      ledger: ledgerData,
      status: "error",
      blockedReason: `promptfoo exited ${run.status} without results`,
    },
    1,
  );
}
const summary = summarise(resultsFile, ledgerData, meta);
const totals = Object.values(summary.providers).reduce(
  (a, p) => ({
    fail: a.fail + p.fail,
    error: a.error + p.error,
    blocked: a.blocked + p.blocked,
    total: a.total + p.total,
  }),
  { fail: 0, error: 0, blocked: 0, total: 0 },
);
summary.totals = totals;
if (dryRun) summary.status = "dry-run";
else if (totals.blocked === totals.total) {
  summary.status = "blocked";
  summary.blockedReason = ledgerData.refused
    ? "token cap reached"
    : "needs AI_API_KEY (repository secret) plus AI_BASE_URL and AI_CHAT_MODEL; the response cache could not answer";
} else if (totals.fail || totals.error) summary.status = "failed";
else if (totals.blocked) summary.status = "partial";
else summary.status = "passed";

const code =
  summary.status === "failed" || summary.status === "error"
    ? 1
    : (summary.status === "blocked" || summary.status === "partial") && strict
      ? 1
      : 0;
finish(summary, code);
