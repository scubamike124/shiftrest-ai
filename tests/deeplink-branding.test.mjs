// Signed-out deep links survive sign-in, and no screen shows another
// product's name ("Reelo").
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const root = new URL("../", import.meta.url).pathname;
const read = (p) => readFileSync(join(root, p), "utf8");

function walk(dir, out = []) {
  for (const f of readdirSync(join(root, dir))) {
    const p = join(dir, f);
    if (statSync(join(root, p)).isDirectory()) walk(p, out);
    else if (/\.(tsx?|mjs)$/.test(f)) out.push(p);
  }
  return out;
}

test("every requireSession page is an allowed sign-in return path", () => {
  const auth = read("src/routes/auth.tsx");
  const set = /const SAFE_RETURNS = new Set\(\[([\s\S]*?)\]\)/.exec(auth);
  assert.ok(set);
  const allowed = new Set([...set[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]));
  const guarded = [];
  for (const f of walk("src/routes")) {
    const src = read(f);
    if (!/beforeLoad:\s*requireSession/.test(src)) continue;
    const m = /createFileRoute\("([^"]+)"\)/.exec(src);
    if (m) guarded.push(m[1]);
  }
  assert.ok(guarded.length > 10, "found the guarded routes");
  assert.deepEqual(
    guarded.filter((r) => !allowed.has(r)),
    [],
  );
});

test("no user-facing source says Reelo", () => {
  const hits = walk("src").filter((f) => /\bReelo\b/i.test(read(f)));
  assert.deepEqual(hits, []);
});
