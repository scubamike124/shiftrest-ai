#!/usr/bin/env node
/**
 * Summarise Promptfoo JSON output for the RestPilot companion benchmark.
 *   node tests/ai/companion/report.mjs <main.json> [consistency.json]
 * Prints a Markdown report and writes <main>.summary.json beside the input.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const [mainFile, consistencyFile] = process.argv.slice(2);
if (!mainFile) {
  console.error("usage: report.mjs <main.json> [consistency.json]");
  process.exit(1);
}
const rowsOf = (f) => JSON.parse(readFileSync(f, "utf8")).results.results;
const label = (r) => r.provider?.label ?? r.provider?.id ?? "unknown";
const meta = (r) => r.testCase?.metadata ?? {};
const pct = (x) => (x == null ? "—" : `${(100 * x).toFixed(0)}%`);
const quant = (xs, q) => {
  const v = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  return v.length ? v[Math.min(v.length - 1, Math.floor(q * v.length))] : null;
};
const mean = (xs) => {
  const v = xs.filter((x) => Number.isFinite(x));
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
};
const ms = (x) => (x == null ? "—" : `${(x / 1000).toFixed(1)} s`);
const usd = (x) => (x == null ? "—" : `$${x < 0.01 ? x.toFixed(5) : x.toFixed(4)}`);

const rows = rowsOf(mainFile);
const providers = [...new Set(rows.map(label))];
const METRICS = ["quality", "honesty", "safety", "time_math", "format", "personalization", "tool_use"];
const summary = { generatedAt: new Date().toISOString(), source: mainFile, judge: null, providers: {} };
try {
  const { judgeConfig } = require("./lib/grader.cjs");
  const j = judgeConfig();
  summary.judge = process.env.BENCH_NO_JUDGE === "1" ? "none (BENCH_NO_JUDGE=1)" : j ? `${j.vendor}:${j.model}` : "none";
} catch {
  summary.judge = "unknown";
}

for (const p of providers) {
  const rs = rows.filter((r) => label(r) === p);
  const errors = rs.filter((r) => r.failureReason === 2);
  const graded = rs.filter((r) => r.gradingResult && r.failureReason !== 2);
  const byCat = {};
  for (const r of graded) {
    const c = meta(r).category ?? "other";
    (byCat[c] ??= []).push(r.gradingResult.pass ? 1 : 0);
  }
  const named = Object.fromEntries(METRICS.map((m) => [m, mean(graded.map((r) => r.namedScores?.[m]))]));
  const kindOf = (r) => meta(r).kind ?? "coach";
  const lat = (k) => rs.filter((r) => !k || kindOf(r) === k).map((r) => r.latencyMs ?? r.response?.latencyMs);
  const ttft = (k) => rs.filter((r) => kindOf(r) === k).map((r) => r.response?.metadata?.ttftMs);
  const costBy = Object.fromEntries(["coach", "voice", "intent", "brief", "tool"].map((k) => [k, mean(rs.filter((r) => kindOf(r) === k).map((r) => r.cost))]));
  const voice = rs.filter((r) => kindOf(r) === "voice");
  summary.providers[p] = {
    n: rs.length,
    errors: errors.length,
    errorSamples: errors.slice(0, 3).map((r) => String(r.error ?? "").slice(0, 160)),
    passRate: graded.length ? graded.filter((r) => r.gradingResult.pass).length / graded.length : null,
    meanScore: mean(graded.map((r) => r.score)),
    named,
    categories: Object.fromEntries(Object.entries(byCat).map(([c, v]) => [c, mean(v)])),
    safetyCaseFailures: graded.filter((r) => meta(r).category === "safety" && !r.gradingResult.pass).map((r) => meta(r).id),
    latency: { p50: quant(lat(), 0.5), p95: quant(lat(), 0.95), voiceP50: quant(lat("voice"), 0.5), voiceP95: quant(lat("voice"), 0.95) },
    ttft: { coachP50: quant(ttft("coach"), 0.5), voiceP50: quant(ttft("voice"), 0.5), voiceP95: quant(ttft("voice"), 0.95) },
    costPerCall: costBy,
    totalCost: rs.reduce((a, r) => a + (Number(r.cost) || 0), 0),
    voiceEmpty: voice.filter((r) => r.failureReason !== 2 && !String(r.response?.output ?? "").trim()).length,
    voiceTruncated: voice.filter((r) => r.response?.metadata?.finishReason === "length").length,
    usageMissing: rs.filter((r) => r.response?.metadata?.usageReported === false).length,
  };
}

if (consistencyFile) {
  const crs = rowsOf(consistencyFile);
  for (const p of providers) {
    const groups = {};
    for (const r of crs.filter((x) => label(x) === p && x.failureReason !== 2)) (groups[meta(r).id] ??= []).push(r);
    const sets = Object.values(groups).filter((g) => g.length > 1);
    if (!sets.length || !summary.providers[p]) continue;
    const agree = sets.filter((g) => new Set(g.map((r) => Boolean(r.gradingResult?.pass))).size === 1).length / sets.length;
    const spread = mean(
      sets.map((g) => {
        const q = g.map((r) => r.namedScores?.quality ?? r.score).filter(Number.isFinite);
        const m = mean(q);
        return q.length > 1 ? Math.sqrt(mean(q.map((x) => (x - m) ** 2))) : null;
      }),
    );
    summary.providers[p].consistency = { tests: sets.length, repeats: sets[0].length, passAgreement: agree, qualityStdDev: spread };
  }
}

const out = mainFile.replace(/\.json$/, "") + ".summary.json";
writeFileSync(out, JSON.stringify(summary, null, 2));

const P = summary.providers;
console.log(`\n# RestPilot companion benchmark\n\nJudge: ${summary.judge}. Source: ${mainFile}\n`);
console.log("| Provider | Pass | Quality | Honesty | Safety | Time math | Format | Personal. | Tools | Errors | Safety fails |");
console.log("|---|---|---|---|---|---|---|---|---|---|---|");
for (const [p, s] of Object.entries(P)) {
  const n = s.named;
  console.log(`| ${p} | ${pct(s.passRate)} | ${pct(n.quality)} | ${pct(n.honesty)} | ${pct(n.safety)} | ${pct(n.time_math)} | ${pct(n.format)} | ${pct(n.personalization)} | ${pct(n.tool_use)} | ${s.errors} | ${s.safetyCaseFailures.join(" ") || "none"} |`);
}
console.log("\n| Provider | Latency p50 / p95 | Voice p50 / p95 | Voice TTFT p50 / p95 | Coach TTFT p50 | Empty / truncated voice | Cost/coach | Cost/voice | Cost/intent | Run cost | Consistency (agree, quality SD) |");
console.log("|---|---|---|---|---|---|---|---|---|---|---|");
for (const [p, s] of Object.entries(P)) {
  const c = s.consistency;
  console.log(`| ${p} | ${ms(s.latency.p50)} / ${ms(s.latency.p95)} | ${ms(s.latency.voiceP50)} / ${ms(s.latency.voiceP95)} | ${ms(s.ttft.voiceP50)} / ${ms(s.ttft.voiceP95)} | ${ms(s.ttft.coachP50)} | ${s.voiceEmpty} / ${s.voiceTruncated} | ${usd(s.costPerCall.coach)} | ${usd(s.costPerCall.voice)} | ${usd(s.costPerCall.intent)} | ${usd(s.totalCost)} | ${c ? `${pct(c.passAgreement)}, ${c.qualityStdDev?.toFixed(2) ?? "—"}` : "—"} |`);
}
const cats = [...new Set(Object.values(P).flatMap((s) => Object.keys(s.categories)))].sort();
console.log(`\n| Category | ${Object.keys(P).join(" | ")} |\n|---|${Object.keys(P).map(() => "---").join("|")}|`);
for (const c of cats) console.log(`| ${c} | ${Object.values(P).map((s) => pct(s.categories[c])).join(" | ")} |`);
for (const [p, s] of Object.entries(P)) if (s.errors) console.log(`\n${p}: ${s.errors} provider errors, e.g. ${s.errorSamples.join(" / ")}`);
console.log(`\nSummary JSON: ${out}`);
