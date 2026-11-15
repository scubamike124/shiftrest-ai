import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { FullResult, Reporter, TestCase, TestResult } from "@playwright/test/reporter";

type Row = {
  title: string;
  project: string;
  status: string;
  blocked?: string;
  error?: string;
  file: string;
};

/**
 * Writes tests/e2e/.results/summary.{md,json} (passed / failed / skipped /
 * blocked, by project and by feature file) and appends the markdown to the
 * GitHub job summary. "Blocked" = skipped with a `blocked` annotation, i.e. a
 * missing owner-provided prerequisite (Stripe TEST key, etc.), never a pass.
 */
export default class SummaryReporter implements Reporter {
  private rows = new Map<string, Row>();

  onTestEnd(test: TestCase, result: TestResult) {
    const project = test.parent.project()?.name ?? "default";
    const annotations = [...(result.annotations ?? []), ...test.annotations];
    const blocked = annotations.find((a) => a.type === "blocked")?.description;
    const parked = annotations.find((a) => a.type === "parked")?.description;
    const outcome = test.outcome();
    const status =
      parked && result.status === "skipped"
        ? "parked"
        : blocked && result.status === "skipped"
          ? "blocked"
          : outcome === "expected"
            ? result.status === "skipped"
              ? "skipped"
              : "passed"
            : outcome === "flaky"
              ? "flaky"
              : outcome === "skipped"
                ? "skipped"
                : "failed";
    this.rows.set(`${project}::${test.id}`, {
      title: test.titlePath().slice(3).join(" › "),
      project,
      status,
      blocked: blocked ?? parked,
      error: result.error?.message?.split("\n")[0]?.slice(0, 200),
      file: path.basename(test.location.file),
    });
  }

  onEnd(result: FullResult) {
    const rows = [...this.rows.values()];
    const count = (s: string) => rows.filter((r) => r.status === s).length;
    const totals = {
      passed: count("passed"),
      failed: count("failed"),
      flaky: count("flaky"),
      skipped: count("skipped"),
      blocked: count("blocked"),
      parked: count("parked"),
      total: rows.length,
    };
    const byProject: Record<string, Record<string, number>> = {};
    for (const r of rows) {
      const p = (byProject[r.project] ??= {
        passed: 0,
        failed: 0,
        flaky: 0,
        skipped: 0,
        blocked: 0,
        parked: 0,
      });
      p[r.status] += 1;
    }
    const blockedReasons = [...new Set(rows.filter((r) => r.blocked).map((r) => r.blocked!))];
    const failures = rows.filter((r) => r.status === "failed" || r.status === "flaky");

    const md = [
      `### RestPilot web regression (Playwright): ${result.status.toUpperCase()}`,
      "",
      `**${totals.passed} passed, ${totals.failed} failed, ${totals.flaky} flaky, ${totals.blocked} blocked, ${totals.parked} parked by owner, ${totals.skipped} skipped** (${totals.total} test runs)`,
      "",
      "| Project | Passed | Failed | Flaky | Blocked | Parked | Skipped |",
      "|---|---|---|---|---|---|---|",
      ...Object.entries(byProject).map(
        ([p, c]) =>
          `| ${p} | ${c.passed} | ${c.failed} | ${c.flaky} | ${c.blocked} | ${c.parked} | ${c.skipped} |`,
      ),
      "",
      ...(failures.length
        ? [
            "**Failures**",
            "",
            ...failures
              .slice(0, 30)
              .map((f) => `- [${f.project}] ${f.file}: ${f.title}: ${f.error ?? f.status}`),
            "",
          ]
        : []),
      ...(blockedReasons.length
        ? ["**Blocked / parked**", "", ...blockedReasons.map((b) => `- ${b}`), ""]
        : []),
    ].join("\n");

    const out = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.results");
    fs.mkdirSync(out, { recursive: true });
    fs.writeFileSync(path.join(out, "summary.md"), md + "\n");
    fs.writeFileSync(
      path.join(out, "summary.json"),
      JSON.stringify(
        { status: result.status, totals, byProject, blockedReasons, failures, rows },
        null,
        2,
      ),
    );
    if (process.env.GITHUB_STEP_SUMMARY)
      fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, md + "\n");
  }
}
