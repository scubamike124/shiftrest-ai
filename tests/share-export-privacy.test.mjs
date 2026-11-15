// Partner Mode links carry only shift times, and the account data export
// covers every table that stores the user's own rows.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const read = (p) => readFileSync(new URL("../" + p, import.meta.url), "utf8");

function loadShifts() {
  const js = ts.transpileModule(read("src/lib/shifts.ts"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(js, { module, exports: module.exports, require: () => ({}) });
  return module.exports;
}

test("a Partner Mode link drops notes, titles, employers and ids", () => {
  const { toSharedShifts, endAbsolute } = loadShifts();
  const shared = toSharedShifts([
    {
      id: "6239415b-c6b6-403c-881c-3d90100d6900",
      day: 6,
      weekIndex: 1,
      start: 1140,
      end: 450,
      employerId: "d57b18fe-5e08-4ff4-a48c-113f5b548a80",
      title: "Night 12.5h",
      notes: "private note",
    },
    { id: "x", day: 0, start: 420, end: 1140 },
  ]);
  assert.deepEqual(JSON.parse(JSON.stringify(shared)), [
    { day: 6, weekIndex: 1, start: 1140, end: 450 },
    { day: 0, weekIndex: 0, start: 420, end: 1140 },
  ]);
  assert.equal(endAbsolute(shared[0]), 450 + 1440);
});

test("share.tsx builds the link from toSharedShifts, not raw shift rows", () => {
  const src = read("src/routes/share.tsx");
  assert.match(src, /shifts: toSharedShifts\(mine\.shifts\)/);
  assert.doesNotMatch(src, /shifts: mine\.shifts/);
});

test("every table with a user_id -> auth.users column is in the data export", () => {
  const dir = new URL("../supabase/migrations/", import.meta.url);
  const tables = new Set();
  for (const f of readdirSync(dir)) {
    const sql = readFileSync(new URL(f, dir), "utf8");
    const re = /CREATE TABLE (?:IF NOT EXISTS )?public\.(\w+)\s*\(([\s\S]*?)\n\);/gi;
    for (const m of sql.matchAll(re)) {
      if (/\buser_id\b[^,\n]*REFERENCES auth\.users/i.test(m[2])) tables.add(m[1]);
    }
  }
  const src = read("src/lib/account.functions.ts");
  const listed = (name) => {
    const m = new RegExp(`const ${name} = \\[([\\s\\S]*?)\\] as const`).exec(src);
    assert.ok(m, name);
    return [...m[1].matchAll(/"(\w+)"/g)].map((x) => x[1]);
  };
  const exported = new Set([
    ...listed("USER_TABLES"),
    ...listed("EXPORT_ONLY_TABLES"),
    "subscriptions",
    "legal_acceptances",
  ]);
  // Operational logs/counters, not user content (see the retention note in account.functions.ts).
  const notExported = new Set([
    "ai_log",
    "notification_log",
    "rate_limit_counter",
    "email_send_log",
    "email_send_state",
    "email_unsubscribe_tokens",
    "suppressed_emails",
    "ops_alert",
    "user_roles",
  ]);
  assert.ok(tables.size > 10, "parsed the migrations");
  const missing = [...tables].filter((t) => !exported.has(t) && !notExported.has(t));
  assert.deepEqual(missing, []);
});
