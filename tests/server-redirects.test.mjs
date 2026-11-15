// Regression: the global security-headers middleware (src/start.ts) sets headers
// on every response. Response.redirect() returns immutable headers, so any
// server route that returns it fails with "TypeError: immutable" and a 500.
// That broke the Oura and Fitbit OAuth callbacks (QA-REPORT R4).
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

function files(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? files(p) : /\.(ts|tsx)$/.test(e.name) ? [p] : [];
  });
}

test("Response.redirect() headers are immutable (why server routes must not use it)", () => {
  const r = Response.redirect("https://restpilotai.com/profile", 302);
  assert.throws(() => r.headers.set("x-frame-options", "SAMEORIGIN"), /immutable/);
  const ok = new Response(null, {
    status: 302,
    headers: { Location: "https://restpilotai.com/profile" },
  });
  ok.headers.set("x-frame-options", "SAMEORIGIN");
  assert.equal(ok.headers.get("location"), "https://restpilotai.com/profile");
});

test("no server route returns Response.redirect()", () => {
  const code = (f) => fs.readFileSync(f, "utf8").replace(/\/\/.*$/gm, "");
  const offenders = files("src/routes").filter((f) => /\bResponse\.redirect\(/.test(code(f)));
  assert.deepEqual(offenders, []);
});
