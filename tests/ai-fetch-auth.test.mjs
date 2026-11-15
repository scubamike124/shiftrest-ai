// Every client call to a bearer-guarded AI endpoint must send the Supabase
// access token. /api/swap and the /api/brief rewrite step in useTtsPlayer once
// omitted it and always came back 401 for signed-in users.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const root = new URL("../src/", import.meta.url).pathname;
function walk(dir, out = []) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(f)) out.push(p);
  }
  return out;
}

const GUARDED = ["/api/swap", "/api/brief", "/api/insights", "/api/tts", "/api/stt", "/api/ai"];

test("aiFetch calls to guarded endpoints attach an Authorization header", () => {
  const bad = [];
  let checked = 0;
  for (const file of walk(root)) {
    if (file.includes("/routes/api/") || file.endsWith("consent-client.ts")) continue;
    const src = readFileSync(file, "utf8");
    const re = /aiFetch(?:Background)?\(\s*([^,]+),/g;
    let m;
    while ((m = re.exec(src))) {
      const arg = m[1].trim();
      const literal = GUARDED.some((e) => arg.includes(e));
      if (!literal && !/endpoint/.test(arg)) continue;
      checked++;
      // The options object follows the first argument; look at its first ~600 chars.
      const window = src.slice(m.index, m.index + 700);
      if (!/Authorization|headers,|headers\b\s*[,}]/.test(window)) bad.push(`${file}: ${arg}`);
    }
  }
  assert.ok(checked >= 8, `expected to inspect the AI call sites, saw ${checked}`);
  assert.deepEqual(bad, []);
});

test("swap and the voice brief rewrite attach the bearer token", () => {
  for (const f of ["routes/swap.tsx", "lib/voice/useTtsPlayer.ts"]) {
    const src = readFileSync(new URL("../src/" + f, import.meta.url), "utf8");
    assert.match(src, /Authorization: `Bearer \$\{(token|briefToken)\}`/, f);
  }
});
