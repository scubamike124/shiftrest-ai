#!/usr/bin/env node
// Lint gate for pull requests: runs ESLint on the files a PR changes and fails
// only on problems in the lines the PR added or modified.
//
// The repository carries ~6.4k pre-existing ESLint findings (mostly Prettier
// formatting), so linting whole files would fail any PR that touches an old
// file. This keeps new code clean without forcing unrelated reformatting.
//
//   node scripts/qa/lint-changed.mjs [base-ref]   (default: origin/$GITHUB_BASE_REF or origin/main)
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";

const base =
  process.argv[2] ||
  (process.env.GITHUB_BASE_REF ? `origin/${process.env.GITHUB_BASE_REF}` : "origin/main");
const git = (...args) =>
  execFileSync("git", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });

const files = git(
  "diff",
  "--name-only",
  "--no-renames",
  "--diff-filter=ACM",
  `${base}...HEAD`,
  "--",
  "*.ts",
  "*.tsx",
  "*.js",
  "*.mjs",
)
  .split("\n")
  .filter((f) => f && !f.startsWith("ios-app/") && fs.existsSync(f));
if (files.length === 0) {
  console.log("lint-changed: no lintable files changed.");
  process.exit(0);
}

// Added/modified line numbers per file, from a zero-context diff.
const changed = new Map();
let current = null;
for (const line of git("diff", "-U0", "--no-renames", `${base}...HEAD`, "--", ...files).split("\n")) {
  if (line.startsWith("+++ ")) {
    current = line.slice(4).replace(/^b\//, "");
    changed.set(current, new Set());
  } else if (line.startsWith("@@") && current) {
    const m = /\+(\d+)(?:,(\d+))?/.exec(line);
    const start = Number(m[1]);
    const count = m[2] === undefined ? 1 : Number(m[2]);
    for (let i = 0; i < count; i++) changed.get(current).add(start + i);
  }
}

const run = spawnSync("npx", ["eslint", "--format", "json", "--no-warn-ignored", ...files], {
  encoding: "utf8",
  maxBuffer: 256 * 1024 * 1024,
});
let results;
try {
  results = JSON.parse(run.stdout);
} catch {
  console.error(run.stdout, run.stderr);
  console.error("lint-changed: ESLint did not produce JSON output.");
  process.exit(2);
}

let errors = 0;
let warnings = 0;
let preexisting = 0;
for (const r of results) {
  const rel = r.filePath.replace(process.cwd() + "/", "");
  const lines = changed.get(rel) ?? new Set();
  for (const m of r.messages) {
    // Whole-file problems (no line) and fatal parse errors always count.
    const inChange = m.fatal || !m.line || lines.has(m.line);
    if (!inChange) {
      preexisting += 1;
      continue;
    }
    if (m.severity === 2) errors += 1;
    else warnings += 1;
    console.log(
      `${rel}:${m.line ?? 0}:${m.column ?? 0}  ${m.severity === 2 ? "error" : "warning"}  ${m.message}  ${m.ruleId ?? ""}`,
    );
  }
}
console.log(
  `lint-changed: ${files.length} file(s); ${errors} error(s) and ${warnings} warning(s) in changed lines; ${preexisting} pre-existing problem(s) ignored.`,
);
process.exit(errors > 0 ? 1 : 0);
