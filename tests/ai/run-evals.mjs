#!/usr/bin/env node
// Cost-capped CI entry point for the RestPilot companion evals.
//
// The scenarios, production-prompt assembly, providers and judge live in the
// AI companion benchmark (tests/ai/companion, PR #18). This wrapper runs that
// same Promptfoo config for CI and the QA report, with spend controls:
//
//   node tests/ai/run-evals.mjs --offline      # $0: every case through the offline
//                                              #     provider (pipeline + guardrail check)
//   node tests/ai/run-evals.mjs --smoke        # 10 cases, current model, cached, 120k cap
//   node tests/ai/run-evals.mjs                # all cases, current model, 1.5M cap
//   node tests/ai/run-evals.mjs --repeat 3 --no-cache   # consistency subset
//   (current-vs-candidate comparison: tests/ai/companion/run.mjs, also capped)
//
// Options: --max-tokens N, --provider LABEL (default current-gemini-3-flash-preview),
//          --filter-pattern RE, --strict (blocked/partial exit 1), --out DIR.
//
// Guarantees: a hard token cap enforced per call by tests/ai/companion/lib/guard.cjs
// (model and judge calls reserve worst case first, refused past the cap); a
// preflight refusal for uncached runs whose worst case exceeds the cap; and
// "blocked", never a pass, when keys are missing and the cache cannot answer.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const bench = path.join(here, "companion");
const require = createRequire(import.meta.url);
const PROMPTFOO_VERSION = "0.125.1";

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const opt = (name, fallback) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};

const offline = flag("--offline");
const smoke = flag("--smoke");
const noCache = flag("--no-cache");
const strict = flag("--strict");
const repeat = Math.max(1, Number(opt("--repeat", "1")) || 1);
const filterPattern = opt("--filter-pattern", "");
const providerLabel = opt(
  "--provider",
  process.env.RESTPILOT_EVAL_PROVIDER || "current-gemini-3-flash-preview",
);
const maxTokens = Number(
  opt("--max-tokens", process.env.RESTPILOT_EVAL_MAX_TOKENS || (smoke ? 120_000 : 1_500_000)),
);
const outDir = path.resolve(opt("--out", path.join(here, ".results")));
const dryRun = offline; // offline = assembly + deterministic checks, no model

// One case per area: sleep planning, rotation, caffeine, recovery, scheduling,
// voice, memory, wearable honesty, medical safety, structured intents.
export const SMOKE_IDS = ["A01", "B01", "C01", "E01", "F01", "G01", "H01", "I01", "J01", "K01"];

// Worst case per case: prompt (~4k tokens) + 2048 output, plus a judge call
// (~3k prompt + 2000 output) when the case has a model-graded assertion.
const EST_CALL = 4_000 + 2_048;
const EST_GRADE = 3_000 + 2_000;

function loadScenarios() {
  const cases = require(path.join(bench, "cases", "index.cjs"));
  return cases.map((c) => ({
    id: c.metadata?.id,
    description: c.description ?? c.metadata?.id ?? "",
    consistency: Boolean(c.metadata?.consistency),
    rubric: (c.assert ?? []).filter((a) =>
      /llm-rubric|g-eval|factuality|model-graded|answer-relevance/.test(a.type),
    ).length,
  }));
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
    // A refusal can come from the coach call or from any grading call.
    const gradingText = [
      r.gradingResult?.reason,
      ...(r.gradingResult?.componentResults ?? []).map((c) => c?.reason),
    ].join("\n");
    const isBlocked = /BLOCKED|COST_CAP|pending key|no judge key|missing [A-Z_]+_KEY/.test(
      `${err}\n${gradingText}`,
    );
    let verdict;
    // r.error also carries assertion failure reasons; provider failures live on r.response.error.
    const providerErr = r.response?.error || (!r.response ? r.error : "") || "";
    if (dryRun) verdict = providerErr ? "error" : "assembled";
    else if (isBlocked) verdict = "blocked";
    else if (providerErr && !isBlocked) verdict = "error";
    else verdict = r.success ? "pass" : "fail";
    if (verdict === "assembled") p.pass += 1;
    else p[verdict] += 1;
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
    if (verdict === "fail" || verdict === "error" || verdict === "blocked") {
      const reason = isBlocked
        ? (`${err}\n${gradingText}`.match(
            /(BLOCKED|COST_CAP|missing [A-Z_]+_KEY|no judge key)[^\n]*/,
          )?.[0] ?? "blocked")
        : String(err || r.failureReason || r.gradingResult?.reason || "");
      p.failures.push({
        verdict: verdict.toUpperCase(),
        test: r.testCase?.description ?? `#${r.testIdx}`,
        reason: reason.slice(0, 300),
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
  if (s.status === "offline-ok" || (s.mode ?? "").includes("offline"))
    lines.push(
      "Offline self-test: Pass = production prompt assembled (with the DATA HONESTY guardrail) for the case; the reply is a fixed string, so no quality is scored and no model is called.",
      "",
    );
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
        lines.push(`  - ${f.verdict} ${f.test}: ${f.reason.replace(/\n/g, " ")}`);
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
  .filter((t) => (smoke ? SMOKE_IDS.includes(t.id) : true))
  .filter((t) => (repeat > 1 ? t.consistency : true))
  .filter((t) => (filterPattern ? new RegExp(filterPattern).test(t.description) : true));
const worstCase = offline
  ? 0
  : scenarios.reduce((n, t) => n + EST_CALL + t.rubric * EST_GRADE, 0) * repeat;
const meta = {
  mode: [
    offline ? "offline self-test" : smoke ? "smoke" : "full",
    repeat > 1 ? `repeat x${repeat}` : null,
    noCache ? "no-cache" : "cached",
  ]
    .filter(Boolean)
    .join(", "),
  provider: offline ? "offline-selftest" : providerLabel,
  repeat,
  maxTokens,
  scenarios: scenarios.length,
  worstCaseTokens: worstCase,
  startedAt: new Date().toISOString(),
};
console.log(
  `[evals] ${scenarios.length} case(s) on ${meta.provider}, repeat ${repeat}; worst case ~${worstCase} tokens; cap ${maxTokens}.`,
);
if (!scenarios.length) finish({ ...meta, status: "error", blockedReason: "no cases matched" }, 1);
if (noCache && !offline && worstCase > maxTokens) {
  finish(
    {
      ...meta,
      status: "refused",
      blockedReason: `uncached worst case ~${worstCase} tokens exceeds the ${maxTokens}-token cap; raise --max-tokens deliberately or narrow the run`,
    },
    1,
  );
}

// ---------------------------------------------------------------- run
fs.mkdirSync(outDir, { recursive: true });
const ledger = path.join(outDir, "ledger.json");
fs.rmSync(ledger, { force: true });
const resultsFile = path.join(outDir, "results.json");
fs.rmSync(resultsFile, { force: true });

const [cmd, pre] = promptfooCommand();
const args = [...pre, "eval", "-c", path.join(bench, "benchmark.promptfooconfig.yaml")];
args.push(
  "--filter-providers",
  `^${(offline ? "offline-selftest" : providerLabel).replace(/[.]/g, "\\.")}$`,
);
if (smoke) args.push("--filter-metadata", `id=${SMOKE_IDS.join(",")}`);
if (repeat > 1) args.push("--filter-metadata", "consistency=true", "--repeat", String(repeat));
if (filterPattern) args.push("--filter-pattern", filterPattern);
if (noCache) args.push("--no-cache");
args.push(
  "--max-concurrency",
  process.env.RESTPILOT_EVAL_CONCURRENCY || "2",
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
  RESTPILOT_EVAL_CACHE: noCache ? "off" : process.env.RESTPILOT_EVAL_CACHE || "on",
  BENCH_NO_JUDGE: offline ? "1" : process.env.BENCH_NO_JUDGE || "",
  PROMPTFOO_DISABLE_TELEMETRY: "1",
  PROMPTFOO_DISABLE_UPDATE: "1",
  PROMPTFOO_DISABLE_SHARING: "1",
  PROMPTFOO_CONFIG_DIR: process.env.PROMPTFOO_CONFIG_DIR || path.join(here, ".cache", "promptfoo"),
};
const run = spawnSync(cmd, args, { stdio: "inherit", env, cwd: bench });

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
if (dryRun) summary.status = totals.error ? "error" : "offline-ok";
else if (totals.blocked === totals.total) {
  summary.status = "blocked";
  summary.blockedReason = ledgerData.refused
    ? "token cap reached"
    : "needs GEMINI_API_KEY (repository secret; Google AI Studio) for the current model and a judge key (OPENAI_API_KEY, ANTHROPIC_API_KEY or GEMINI_API_KEY); the response cache could not answer";
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
