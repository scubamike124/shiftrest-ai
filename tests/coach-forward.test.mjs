// /api/coach (legacy) forwards to /api/ai. On Railway the server sees
// http://<public host>; fetching that gets a 301 to https and fetch() turns the
// POST into a GET, returning the HTML app shell (reproduced on staging,
// 2026-11-15). The forward must use loopback and never follow redirects.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import test from "node:test";

const src = stripTypeScriptTypes(
  readFileSync(new URL("../src/lib/ai/forward.server.ts", import.meta.url), "utf8"),
);
const mod = await import("data:text/javascript," + encodeURIComponent(src));

test("forwards over loopback to the same Node server when PORT is known", () => {
  assert.equal(
    mod.aiForwardUrl("http://restpilot-web-staging.up.railway.app/api/coach", { PORT: "3000" }),
    "http://127.0.0.1:3000/api/ai",
  );
});

test("NITRO_PORT wins over PORT; out-of-range ports are ignored", () => {
  assert.equal(
    mod.aiForwardUrl("http://h/api/coach", { NITRO_PORT: "4000", PORT: "3000" }),
    "http://127.0.0.1:4000/api/ai",
  );
  assert.equal(mod.aiForwardUrl("http://h:8/api/coach", { PORT: "0" }), "http://h:8/api/ai");
  assert.equal(mod.aiForwardUrl("http://h:8/api/coach", { PORT: "70000" }), "http://h:8/api/ai");
});

test("without PORT (dev), forwards to the same origin, dropping the query", () => {
  assert.equal(
    mod.aiForwardUrl("http://localhost:8080/api/coach?x=1", {}),
    "http://localhost:8080/api/ai",
  );
  assert.equal(
    mod.aiForwardUrl("http://localhost:8080/api/coach", { PORT: "abc" }),
    "http://localhost:8080/api/ai",
  );
});

test("route never follows redirects and drops stale encoding headers", () => {
  const route = readFileSync(new URL("../src/routes/api/coach.ts", import.meta.url), "utf8");
  assert.match(route, /fetch\(aiForwardUrl\(request\.url\), \{[\s\S]*?redirect: "manual"/);
  assert.match(route, /forward\.status >= 300 && forward\.status < 400/);
  assert.match(
    route,
    /\} catch \{\n\s*return Response\.json\(\{ error: "AI service unavailable" \}, \{ status: 502 \}\);/,
  );
  assert.deepEqual(mod.DROP_FORWARD_HEADERS.includes("content-encoding"), true);
});
