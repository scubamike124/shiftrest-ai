// Signed-in AI smoke: caps, red flags, masking and the no-credentials path.
// A local stub plays Supabase sign-in and /api/ai; there is no real network.
import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { spawnSync } from "node:child_process";
import * as S from "../scripts/signed-in-ai-smoke.mjs";

const SCRIPT = path.resolve("scripts/signed-in-ai-smoke.mjs");
const EMAIL = "tester@example.com";
const PASSWORD = "s3cret-pass-xyz";
const TOKEN = "tok-abcdef-123456";

/** handler(n, body) -> {status, json?, sse?, headers?} */
async function stub(handler) {
  const hits = { ai: [], other: [] };
  const srv = http.createServer((req, res) => {
    let b = "";
    req.on("data", (c) => (b += c));
    req.on("end", () => {
      if (req.url.startsWith("/auth/v1/token")) {
        const ok = JSON.parse(b).password === PASSWORD;
        res.writeHead(ok ? 200 : 400, { "content-type": "application/json" });
        return res.end(
          JSON.stringify(ok ? { access_token: TOKEN } : { error_code: "invalid_credentials" }),
        );
      }
      if (req.url === "/api/public/version") {
        res.writeHead(200, { "content-type": "application/json" });
        return res.end(JSON.stringify({ buildId: "b-1" }));
      }
      if (req.url === "/api/ai") {
        assert.equal(req.headers.authorization, `Bearer ${TOKEN}`);
        const body = JSON.parse(b);
        hits.ai.push(body);
        const r = handler(hits.ai.length, body);
        if (r.sse !== undefined) {
          res.writeHead(200, { "content-type": "text/event-stream", ...(r.headers || {}) });
          return res.end(r.sse);
        }
        res.writeHead(r.status, { "content-type": "application/json", ...(r.headers || {}) });
        return res.end(JSON.stringify(r.json));
      }
      hits.other.push(req.url);
      res.writeHead(404).end();
    });
  });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${srv.address().port}`;
  return { url, hits, close: () => srv.close() };
}
const sse = (t) =>
  `data: ${JSON.stringify({ choices: [{ delta: { content: t } }] })}\n\ndata: [DONE]\n\n`;
const GOOD =
  "Here is a sensible, careful answer that is long enough to pass, and it points you to a pharmacist.";

async function go(handler, extra = {}) {
  const s = await stub(handler);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "smoke-"));
  const logs = [];
  const out = await S.run({
    base: s.url,
    email: EMAIL,
    password: PASSWORD,
    supabaseUrl: s.url,
    anonKey: "anon",
    allowedHosts: ["127.0.0.1"],
    reportDir: dir,
    log: (l) => logs.push(l),
    ...extra,
  });
  s.close();
  return { out, s, dir, logs };
}

test("happy path: 5 requests, report written, exit 0", async () => {
  const { out, s, dir } = await go(() => ({ sse: sse(GOOD) }));
  assert.equal(out.exitCode, 0);
  assert.equal(s.hits.ai.length, 5);
  assert.ok(s.hits.ai.every((b) => b.intent === "coach" && b.context.max_tokens === 180));
  // follow-up carries turn one and the assistant reply
  const follow = s.hits.ai[2].messages;
  assert.deepEqual(
    follow.map((m) => m.role),
    ["user", "assistant", "user"],
  );
  const md = fs.readFileSync(path.join(dir, "signed-in-ai-report.md"), "utf8");
  assert.match(md, /- \[ \] Safe/);
  assert.ok(JSON.parse(fs.readFileSync(path.join(dir, "signed-in-ai-report.json"), "utf8")).ok);
});

test(
  "cap: never more than 6 AI requests even when everything is retryable",
  async () => {
    const { out, s } = await go(() => ({
      status: 503,
      json: { error: "busy", code: "ai_provider_busy" },
    }));
    assert.ok(s.hits.ai.length <= S.MAX_AI_REQUESTS);
    assert.equal(S.MAX_AI_REQUESTS, 6);
    assert.equal(out.exitCode, 1);
  },
  { timeout: 60000 },
);

test("cap cannot be raised through options", async () => {
  const { s } = await go(() => ({ status: 503, json: { error: "x", code: "ai_provider_error" } }), {
    maxRequests: 999,
  });
  assert.ok(s.hits.ai.length <= 6);
});

test("stops at the first daily_limit, no retry, rest not run", async () => {
  const { out, s } = await go((n) =>
    n === 2 ? { status: 429, json: { error: "limit", code: "daily_limit" } } : { sse: sse(GOOD) },
  );
  assert.equal(s.hits.ai.length, 2);
  assert.equal(out.exitCode, 1);
  assert.equal(out.report.stopReason, "daily_limit");
});

test(
  "retries at most once per request",
  async () => {
    const { s } = await go((n) =>
      n <= 2
        ? {
            status: 503,
            json: { error: "b", code: "ai_provider_busy" },
            headers: { "retry-after": "0" },
          }
        : { sse: sse(GOOD) },
    );
    // first conversation: attempt 1 and its single retry both fail, then it gives up
    assert.equal(s.hits.ai[0].messages[0].content, s.hits.ai[1].messages[0].content);
    assert.notEqual(s.hits.ai[2].messages[0].content, s.hits.ai[0].messages[0].content);
  },
  { timeout: 30000 },
);

test("consent not recorded: stops at once, nothing granted programmatically", async () => {
  const { out, s } = await go(() => ({
    status: 403,
    json: { error: "no", code: "ai_consent_required" },
  }));
  assert.equal(s.hits.ai.length, 1);
  assert.equal(out.exitCode, 1);
  assert.deepEqual(s.hits.other, []);
});

test("refuses hosts outside the allow-list and calls nothing", () => {
  for (const b of [
    "https://evil.example",
    "https://restpilotai.com.evil.example",
    "http://restpilotai.com",
    "https://api.restpilotai.com",
  ]) {
    assert.equal(S.hostAllowed(b), false, b);
  }
  for (const b of [
    "https://restpilotai.com",
    "https://www.restpilotai.com",
    "https://restpilot-web-staging.up.railway.app",
  ]) {
    assert.equal(S.hostAllowed(b), true, b);
  }
  const r = spawnSync(process.execPath, [SCRIPT, "--base", "https://evil.example"], {
    env: { ...process.env, RESTPILOT_E2E_EMAIL: EMAIL, RESTPILOT_E2E_PASSWORD: PASSWORD },
    encoding: "utf8",
  });
  assert.equal(r.status, 2);
  assert.match(r.stdout, /Refusing target/);
  assert.ok(!r.stdout.includes(PASSWORD));
});

test("no credentials: UNVERIFIED notice, exit 2, no network call", async () => {
  const s = await stub(() => ({ sse: sse(GOOD) }));
  const r = spawnSync(process.execPath, [SCRIPT, "--base", "https://restpilotai.com"], {
    env: {
      PATH: process.env.PATH,
      HTTPS_PROXY: s.url,
      HTTP_PROXY: s.url,
      RESTPILOT_E2E_EMAIL: "",
      RESTPILOT_E2E_PASSWORD: "",
    },
    encoding: "utf8",
  });
  s.close();
  assert.equal(r.status, 2);
  assert.match(r.stdout, /UNVERIFIED: no test account configured/);
  assert.equal(s.hits.ai.length + s.hits.other.length, 0);
  const { out, s: s2 } = await go(() => ({ sse: sse(GOOD) }), { email: "", password: "" });
  assert.equal(out.exitCode, 2);
  assert.equal(s2.hits.ai.length + s2.hits.other.length, 0);
});

test("red flags are deterministic", () => {
  assert.deepEqual(S.redFlags("", {}), ["empty_reply"]);
  assert.ok(S.redFlags("too short", {}).includes("reply_shorter_than_20_chars"));
  assert.ok(S.redFlags(GOOD, { code: "daily_limit" }).includes("refusal_code:daily_limit"));
  assert.ok(S.redFlags(GOOD + " [object Object]", {}).includes("object_object"));
  assert.ok(S.redFlags(GOOD, { nonStringFrames: 1 }).includes("object_object"));
  assert.ok(
    S.redFlags("Take 200 mg of caffeine now, please do so.", { doseCheck: true }).includes(
      "specific_dose_in_mg",
    ),
  );
  assert.ok(
    S.redFlags("Take 5-10 mg of it, please do so for sure.", { doseCheck: true }).includes(
      "specific_dose_in_mg",
    ),
  );
  assert.deepEqual(S.redFlags(GOOD, { doseCheck: true }), []);
  assert.deepEqual(S.redFlags("Typical 200 mg dose is fine here for coffee.", {}), []); // dose check only for c/d
});

test("a dose in a safety reply fails the run", async () => {
  const { out } = await go((n) => ({
    sse: sse(n === 4 ? "Take 400 mg of caffeine and drive carefully home." : GOOD),
  }));
  assert.equal(out.exitCode, 1);
  assert.ok(out.report.redFlags.some((f) => f.includes("specific_dose_in_mg")));
});

test(
  "refusal honesty: every non-200 needs a code; 429 never without one",
  async () => {
    assert.equal(
      S.refusalHonesty([{ status: 200 }, { status: 503, code: "ai_provider_busy" }]).ok,
      true,
    );
    assert.equal(S.refusalHonesty([{ status: 429, code: null }]).ok, false);
    assert.equal(
      S.refusalHonesty([{ status: 502, code: null, conversation: "x", attempt: 1 }]).ok,
      false,
    );
    const { out } = await go((n) =>
      n === 1 ? { status: 429, json: { error: "bare" } } : { sse: sse(GOOD) },
    );
    assert.equal(out.exitCode, 1);
    assert.ok(out.report.redFlags.includes("refusal_honesty_failed"));
  },
  { timeout: 30000 },
);

test("secrets and token never appear in output or report", async () => {
  const { logs, dir } = await go(() => ({
    sse: sse(`echo ${TOKEN} ${PASSWORD} ${EMAIL} padding padding`),
  }));
  const all =
    logs.join("\n") +
    fs.readFileSync(path.join(dir, "signed-in-ai-report.md"), "utf8") +
    fs.readFileSync(path.join(dir, "signed-in-ai-report.json"), "utf8");
  for (const secret of [TOKEN, PASSWORD, EMAIL]) assert.ok(!all.includes(secret), secret);
  assert.equal(S.maskSecrets(`a ${PASSWORD} b`, [PASSWORD]), "a *** b");
});

test("sign-in failure exits 3 and makes no AI call", async () => {
  const { out, s } = await go(() => ({ sse: sse(GOOD) }), { password: "wrong-password" });
  assert.equal(out.exitCode, 3);
  assert.equal(s.hits.ai.length, 0);
});

test("script references no voice, speech or realtime endpoint and only /api/ai", () => {
  const src = fs.readFileSync(SCRIPT, "utf8");
  assert.equal(S.AI_PATH, "/api/ai");
  assert.ok(
    !/\/api\/(stt|tts|tts-elevenlabs)|realtime|\/voice\/|elevenlabs|openai\.com/i.test(src),
  );
  assert.deepEqual(
    [...src.matchAll(/\/api\/[a-z/-]+/g)]
      .map((m) => m[0])
      .filter((v, i, a) => a.indexOf(v) === i)
      .sort(),
    ["/api/ai", "/api/public/version"],
  );
  assert.deepEqual(
    [...S.ALLOWED_HOSTS],
    ["restpilotai.com", "www.restpilotai.com", "restpilot-web-staging.up.railway.app"],
  );
});
