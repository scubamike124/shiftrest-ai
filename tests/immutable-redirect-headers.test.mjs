// Regression for the Oura/Fitbit OAuth callback 500 (QA-REPORT R4): the
// security-headers and CSP middleware in src/start.ts must cope with
// responses whose headers are immutable, such as Response.redirect().
import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

test("Response.redirect() headers are immutable in this runtime", () => {
  const r = Response.redirect("https://restpilotai.com/profile?error=oura", 302);
  assert.throws(() => r.headers.set("x-frame-options", "SAMEORIGIN"), /immutable/);
});

test("the copy start.ts makes keeps status, Location and body, and is mutable", async () => {
  const result = {
    response: Response.redirect("https://restpilotai.com/profile?connected=oura", 302),
  };
  try {
    result.response.headers.set("x-content-type-options", "nosniff");
  } catch {
    const r = result.response;
    result.response = new Response(r.body, {
      status: r.status,
      statusText: r.statusText,
      headers: new Headers(r.headers),
    });
  }
  result.response.headers.set("x-frame-options", "SAMEORIGIN");
  assert.equal(result.response.status, 302);
  assert.equal(
    result.response.headers.get("location"),
    "https://restpilotai.com/profile?connected=oura",
  );
  assert.equal(result.response.headers.get("x-frame-options"), "SAMEORIGIN");
});

test("both header middlewares go through mutableHeaders()", () => {
  const src = fs.readFileSync("src/start.ts", "utf8");
  assert.match(src, /function mutableHeaders\(/);
  assert.match(src, /const headers = mutableHeaders\(result\);/);
  assert.match(src, /mutableHeaders\(result\)\.set\("content-security-policy", CSP\)/);
  assert.doesNotMatch(src, /const headers = result\.response\.headers;/);
});
