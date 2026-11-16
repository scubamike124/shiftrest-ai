// Signed-in AI smoke: caps, red flags, masking, redirects, account checks,
// redaction and the no-credentials path. A local stub plays Supabase and
// /api/ai; there is no real network.
import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { spawnSync } from "node:child_process";
import * as S from "../scripts/signed-in-ai-smoke.mjs";

const SCRIPT = path.resolve("scripts/signed-in-ai-smoke.mjs");
const EMAIL = "Tester@Example.com";
const PASSWORD = "s3cret-pass-xyz";
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const jwt = (o) => `${b64({ alg: "HS256" })}.${b64(o)}.sig`;
const TOKEN = jwt({ sub: "user-1", role: "authenticated" });

/** handler(n, body) -> {status, json?, sse?, headers?, redirect?, hang?} */
async function stub(handler, opts = {}) {
  const hits = { ai: [], other: [], rest: [], signin: 0, version: 0 };
  const rest = { user_roles: [], subscriptions: [], user_prefs: [], ...(opts.rest || {}) };
  const srv = http.createServer((req, res) => {
    let b = "";
    req.on("data", (c) => (b += c));
    req.on("end", () => {
      const send = (st, obj, h = {}) => {
        res.writeHead(st, { "content-type": "application/json", ...h });
        res.end(JSON.stringify(obj));
      };
      if (req.url.startsWith("/auth/v1/token")) {
        hits.signin++;
        if (opts.signinRedirect) return res.writeHead(307, { location: opts.signinRedirect }).end();
        const ok = JSON.parse(b).password === (opts.password || PASSWORD);
        return send(
          ok ? 200 : 400,
          ok ? { access_token: TOKEN } : { error_code: opts.errorCode || "invalid_credentials" },
        );
      }
      if (req.url.startsWith("/rest/v1/")) {
        const t = req.url.split("?")[0].split("/")[3];
        hits.rest.push(req.url);
        const st = opts.restStatus?.[t] ?? 200;
        return send(st, st === 200 ? rest[t] : { message: "denied" });
      }
      if (req.url === "/api/public/version") {
        hits.version++;
        if (opts.versionRedirect)
          return res.writeHead(302, { location: opts.versionRedirect }).end();
        return send(200, { buildId: "b-1" });
      }
      if (req.url === "/api/ai") {
        assert.equal(req.headers.authorization, `Bearer ${TOKEN}`);
        const body = JSON.parse(b);
        hits.ai.push(body);
        const r = handler(hits.ai.length, body);
        if (r.redirect) return res.writeHead(r.redirect.status, { location: r.redirect.to }).end();
        if (r.hang) return;
        if (r.sse !== undefined) {
          res.writeHead(200, { "content-type": "text/event-stream", ...(r.headers || {}) });
          return res.end(r.sse);
        }
        return send(r.status, r.json, r.headers);
      }
      hits.other.push(req.url);
      res.writeHead(404).end();
    });
  });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  return {
    url: `http://127.0.0.1:${srv.address().port}`,
    hits,
    close: () => {
      srv.closeAllConnections?.();
      srv.close();
    },
  };
}
const sse = (t, headers) => ({
  sse: `data: ${JSON.stringify({ choices: [{ delta: { content: t } }] })}\n\ndata: [DONE]\n\n`,
  headers,
});
const RA0 = { "retry-after": "0" };
const fail =
  (code, status = 503) =>
  () => ({ status, json: { error: "x", code }, headers: RA0 });
const GOOD =
  "Here is a sensible, careful answer that is long enough to pass, and it points you to a pharmacist.";
const ok = () => sse(GOOD);

async function go(handler, extra = {}, stubOpts = {}) {
  const s = await stub(handler, stubOpts);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "smoke-"));
  const logs = [];
  const out = await S.run({
    base: s.url,
    email: EMAIL,
    password: stubOpts.password || PASSWORD,
    supabaseUrl: s.url,
    anonKey: "anon",
    allowedHosts: ["127.0.0.1"],
    reportDir: dir,
    log: (l) => logs.push(l),
    ...extra,
  });
  s.close();
  const read = (f) => fs.readFileSync(path.join(dir, `signed-in-ai-report.${f}`), "utf8");
  return { out, s, dir, logs, read };
}

test("happy path: 5 requests, full transcript only when asked", async () => {
  const { out, s, read } = await go(ok, { publishTranscript: true });
  assert.equal(out.exitCode, 0);
  assert.equal(s.hits.ai.length, 5);
  assert.ok(s.hits.ai.every((b) => b.intent === "coach" && b.context.max_tokens === 180));
  assert.deepEqual(
    s.hits.ai[2].messages.map((m) => m.role),
    ["user", "assistant", "user"],
  );
  assert.match(read("md"), /- \[ \] Safe/);
  assert.ok(read("md").includes(GOOD));
  assert.ok(JSON.parse(read("json")).ok);
});

test("default report is redacted: no reply text, no prompts, no headers", async () => {
  const { out, read } = await go(() =>
    sse("UNIQUE-REPLY-TEXT-12345 and more words to be long enough"),
  );
  assert.equal(out.exitCode, 0);
  const all = read("md") + read("json");
  assert.ok(!all.includes("UNIQUE-REPLY-TEXT"));
  assert.ok(!all.includes("zolpidem"));
  assert.ok(!/"reply"|"user"|"headers"/.test(all));
  const j = JSON.parse(read("json"));
  assert.equal(j.transcriptIncluded, false);
  assert.ok(j.conversations[0].turns[0].replyLength > 20);
  assert.match(read("md"), /redacted/i);
});

test("cap: never more than 6 AI requests when everything is retryable", async () => {
  const { out, s } = await go(fail("ai_provider_busy"));
  assert.equal(s.hits.ai.length, 6);
  assert.equal(S.MAX_AI_REQUESTS, 6);
  assert.equal(out.exitCode, 1);
});

test("cap cannot be raised through options (8 attempts would otherwise happen)", async () => {
  const { s } = await go(fail("ai_provider_busy"), { maxRequests: 999 });
  assert.equal(s.hits.ai.length, 6);
});

test("retry only on the listed codes, once", async () => {
  for (const code of ["ai_provider_busy", "ai_budget_unavailable", "rate_limited"]) {
    const { s } = await go(fail(code, code === "rate_limited" ? 429 : 503), { maxRequests: 4 });
    assert.equal(s.hits.ai.length, 4, code);
    assert.equal(s.hits.ai[0].messages[0].content, s.hits.ai[1].messages[0].content, code);
    assert.notEqual(s.hits.ai[1].messages[0].content, s.hits.ai[2].messages[0].content, code);
  }
  for (const [code, st] of [
    ["ai_provider_error", 502],
    ["ai_provider_unavailable", 503],
    ["something_new", 500],
  ]) {
    const { s } = await go(fail(code, st));
    assert.equal(s.hits.ai.length, 4, `${code}: one attempt per conversation`);
  }
  const { s } = await go(() => ({ status: 500, json: { error: "boom" } }));
  assert.equal(s.hits.ai.length, 4);
});

test("stops at the first daily_limit, no retry, rest not run", async () => {
  const { out, s } = await go((n) =>
    n === 2 ? { status: 429, json: { error: "limit", code: "daily_limit" } } : ok(),
  );
  assert.equal(s.hits.ai.length, 2);
  assert.equal(out.exitCode, 1);
  assert.equal(out.report.stopReason, "daily_limit");
});

test("401 stops the run at once", async () => {
  const { out, s } = await go(() => ({ status: 401, json: { error: "Sign in required" } }));
  assert.equal(s.hits.ai.length, 1);
  assert.equal(out.report.stopReason, "unauthorized");
  assert.equal(out.exitCode, 1);
});

test("consent not recorded: stops at once, nothing granted programmatically", async () => {
  const { out, s } = await go(() => ({
    status: 403,
    json: { error: "no", code: "ai_consent_required" },
  }));
  assert.equal(s.hits.ai.length, 1);
  assert.equal(out.exitCode, 1);
  assert.deepEqual(s.hits.other, []);
});

test("AI requests go to the origin's /api/ai, never the base path", async () => {
  const s = await stub(ok);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "smoke-"));
  const out = await S.run({
    base: `${s.url}/some/deep/path?x=1`,
    email: EMAIL,
    password: PASSWORD,
    supabaseUrl: s.url,
    anonKey: "a",
    allowedHosts: ["127.0.0.1"],
    reportDir: dir,
    log: () => {},
  });
  s.close();
  assert.equal(out.exitCode, 0);
  assert.deepEqual(s.hits.other, []);
});

test("wall-time check: no AI request when the budget is spent", async () => {
  const { out, s } = await go(ok, { maxWallMs: 1000 });
  assert.equal(s.hits.ai.length, 0);
  assert.equal(out.report.stopReason, "wall_time_reached");
  assert.equal(S.MAX_WALL_MS, 180000);
});

test("per-request timeout: a hung server is cut off, recorded, retried once", async () => {
  const { out, s } = await go(() => ({ hang: true }), { requestTimeoutMs: 300 }, {});
  assert.equal(s.hits.ai.length, 6);
  assert.equal(out.exitCode, 1);
  assert.ok(out.report.redFlags.some((f) => f.includes("request_error:TimeoutError")));
  assert.equal(S.REQUEST_TIMEOUT_MS, 60000);
});

test("redirects are never followed: same-origin and cross-origin 307/302", async () => {
  const other = await stub(ok);
  for (const [status, to] of [
    [307, "/api/other"],
    [307, `${other.url}/api/ai`],
    [302, `${other.url}/api/ai`],
  ]) {
    const { out, s } = await go(() => ({ redirect: { status, to } }));
    assert.equal(s.hits.ai.length, 4, "no retry on a redirect: one attempt per conversation");
    assert.deepEqual(s.hits.other, [], "same-origin target never fetched");
    assert.equal(out.exitCode, 1);
    assert.ok(out.report.redFlags.some((f) => f.includes("redirect_blocked")));
    assert.ok(out.report.conversations.every((c) => c.turns.every((t) => t.reply === "")));
  }
  assert.equal(other.hits.ai.length, 0, "the other host never saw the token or body");
  other.close();
});

test("sign-in redirect fails closed and sends nothing elsewhere", async () => {
  const other = await stub(ok);
  const { out, s, logs } = await go(ok, {}, { signinRedirect: `${other.url}/auth/v1/token` });
  assert.equal(out.exitCode, 3);
  assert.equal(s.hits.ai.length, 0);
  assert.equal(other.hits.signin, 0);
  assert.match(logs.join(), /redirect refused/);
  other.close();
});

test("version redirect is not followed", async () => {
  const other = await stub(ok);
  const { out } = await go(ok, {}, { versionRedirect: `${other.url}/api/public/version` });
  assert.equal(other.hits.version, 0);
  assert.equal(out.report.version.error !== undefined, true);
  other.close();
});

test("crisis canned reply is not an AI answer and fails the turn", async () => {
  const { out, s } = await go((n) => (n === 1 ? sse(GOOD, { "x-crisis-support": "1" }) : ok()));
  assert.equal(out.exitCode, 1);
  assert.ok(out.report.redFlags.some((f) => f.includes("crisis_canned_reply_not_an_ai_answer")));
  assert.ok(out.report.redFlags.some((f) => f.includes("turn1_no_answer")));
  assert.equal(s.hits.ai.length, 5, "turn 1 is not retried; the other conversations still run");
  assert.ok(S.redFlags(GOOD, { crisis: true }).includes("crisis_canned_reply_not_an_ai_answer"));
});

test("account gate: tester/admin role, any subscription, memory on, or unreadable all refuse with zero AI calls", async () => {
  const cases = [
    [{ user_roles: [{ role: "tester" }] }, /tester or admin/],
    [{ user_roles: [{ role: "admin" }] }, /tester or admin/],
    [{ subscriptions: [{ status: "active" }] }, /subscription/],
    [{ subscriptions: [{ status: "canceled" }] }, /subscription/],
    [{ user_prefs: [{ memory_enabled: true }] }, /Memory is ON/],
  ];
  for (const [rest, re] of cases) {
    const { out, s, logs } = await go(ok, {}, { rest });
    assert.equal(out.exitCode, 4);
    assert.equal(s.hits.ai.length, 0);
    assert.match(logs.join("\n"), re);
  }
  for (const t of ["user_roles", "subscriptions", "user_prefs"]) {
    const { out, s } = await go(ok, {}, { restStatus: { [t]: 403 } });
    assert.equal(out.exitCode, 4, t);
    assert.equal(s.hits.ai.length, 0);
  }
  const plain = await go(
    ok,
    {},
    { rest: { user_roles: [{ role: "user" }], user_prefs: [{ memory_enabled: false }] } },
  );
  assert.equal(plain.out.exitCode, 0);
  assert.ok(plain.s.hits.rest.some((u) => u.includes("user_id=eq.user-1")));
});

test("refuses hosts outside the allow-list and calls nothing", () => {
  for (const b of [
    "https://evil.example",
    "https://restpilotai.com.evil.example",
    "http://restpilotai.com",
    "https://api.restpilotai.com",
    "https://www.restpilotai.com",
    "https://restpilotai.com:8443",
    "https://user:pw@restpilotai.com",
    "not a url",
  ])
    assert.equal(S.hostAllowed(b), false, b);
  for (const b of ["https://restpilotai.com", "https://restpilot-web-staging.up.railway.app"])
    assert.equal(S.hostAllowed(b), true, b);
  const r = spawnSync(process.execPath, [SCRIPT, "--base", "https://evil.example"], {
    env: { ...process.env, RESTPILOT_E2E_EMAIL: EMAIL, RESTPILOT_E2E_PASSWORD: PASSWORD },
    encoding: "utf8",
  });
  assert.equal(r.status, 2);
  assert.match(r.stdout, /Refusing target/);
  assert.ok(!r.stdout.includes(PASSWORD));
});

test("no credentials: UNVERIFIED notice, exit 2, fetch never called", async () => {
  const realFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (...a) => (calls++, realFetch(...a));
  try {
    const logs = [];
    const out = await S.run({
      base: "https://restpilotai.com",
      email: "",
      password: "",
      log: (l) => logs.push(l),
    });
    assert.equal(out.exitCode, 2);
    assert.match(logs.join(), /UNVERIFIED: no test account configured/);
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = realFetch;
  }
  // and the real CLI, with a preload that records any fetch
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "smoke-"));
  const spy = path.join(dir, "spy.mjs");
  const mark = path.join(dir, "called");
  fs.writeFileSync(
    spy,
    `import fs from "node:fs"; globalThis.fetch = () => { fs.writeFileSync(${JSON.stringify(mark)}, "1"); throw new Error("fetch called"); };`,
  );
  const r = spawnSync(
    process.execPath,
    ["--import", spy, SCRIPT, "--base", "https://restpilotai.com"],
    {
      env: { PATH: process.env.PATH, RESTPILOT_E2E_EMAIL: "", RESTPILOT_E2E_PASSWORD: "" },
      encoding: "utf8",
    },
  );
  assert.equal(r.status, 2);
  assert.match(r.stdout, /UNVERIFIED: no test account configured/);
  assert.ok(!fs.existsSync(mark));
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
  assert.deepEqual(S.redFlags("Typical 200 mg dose is fine here for coffee.", {}), []);
});

test("memory cue matches 7am forms, not any 7", () => {
  const cue = S.CONVERSATIONS[1].memoryCue;
  for (const y of ["after 7am", "7 am", "07:00", "7:00 am", "seven am", "7 a.m."])
    assert.ok(cue.test(y), y);
  for (const n of ["7 hours of sleep", "17:00", "about 7 tips", "27 am"])
    assert.ok(!cue.test(n), n);
});

test("a dose in a safety reply fails the run", async () => {
  const { out } = await go((n) =>
    sse(n === 4 ? "Take 400 mg of caffeine and drive carefully home." : GOOD),
  );
  assert.equal(out.exitCode, 1);
  assert.ok(out.report.redFlags.some((f) => f.includes("specific_dose_in_mg")));
});

test("refusal honesty: every non-200 needs a code; 429 never without one", async () => {
  assert.equal(
    S.refusalHonesty([{ status: 200 }, { status: 503, code: "ai_provider_busy" }]).ok,
    true,
  );
  assert.equal(S.refusalHonesty([{ status: 429, code: null }]).ok, false);
  assert.equal(
    S.refusalHonesty([{ status: 502, code: null, conversation: "x", attempt: 1 }]).ok,
    false,
  );
  const { out } = await go((n) => (n === 1 ? { status: 429, json: { error: "bare" } } : ok()));
  assert.equal(out.exitCode, 1);
  assert.ok(out.report.redFlags.includes("refusal_honesty_failed"));
});

test("masking: quotes/backslashes, JSON escaping, case, stdout and both reports", async () => {
  const pw = `pa"ss\\w'ord-Zq9`;
  const echo = `echo ${TOKEN} ${pw} ${EMAIL.toUpperCase()} ${JSON.stringify(pw)} padding padding`;
  const { logs, read } = await go(() => sse(echo), { publishTranscript: true }, { password: pw });
  const all = logs.join("\n") + read("md") + read("json");
  for (const secret of [
    TOKEN,
    pw,
    JSON.stringify(pw).slice(1, -1),
    EMAIL,
    EMAIL.toLowerCase(),
    EMAIL.toUpperCase(),
  ])
    assert.ok(!all.includes(secret), secret);
  assert.equal(S.maskSecrets(`a ${PASSWORD} b`, [PASSWORD]), "a *** b");
  assert.equal(S.maskSecrets("x TESTER@example.com y", [EMAIL]), "x *** y");
  assert.ok(!S.maskSecrets(JSON.stringify({ p: pw }), [pw]).includes("ss"));
});

test("stdout masking: a server error echoing the password is masked", async () => {
  const s = await stub(ok, { errorCode: `leak ${PASSWORD}`, password: "not-it" });
  const lines = [];
  const out = await S.run({
    base: s.url,
    email: EMAIL,
    password: PASSWORD,
    supabaseUrl: s.url,
    anonKey: "a",
    allowedHosts: ["127.0.0.1"],
    log: (l) => lines.push(l),
  });
  s.close();
  assert.equal(out.exitCode, 3);
  assert.match(lines.join(), /Sign-in failed/);
  assert.ok(!lines.join().includes(PASSWORD));
  assert.equal(s.hits.ai.length + s.hits.rest.length, 0);
});

test("readPublicConfig: only an anon/publishable key is accepted", () => {
  const mk = (role) => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), "cfg-"));
    const key = role ? jwt({ role }) : "not-a-jwt";
    fs.writeFileSync(
      path.join(d, ".env"),
      `VITE_SUPABASE_URL="https://x.supabase.co"\nVITE_SUPABASE_PUBLISHABLE_KEY="${key}"\nSUPABASE_SERVICE_ROLE_KEY="secret"\n`,
    );
    return d;
  };
  const c = S.readPublicConfig(mk("anon"));
  assert.deepEqual(Object.keys(c).sort(), ["anonKey", "supabaseUrl"]);
  assert.throws(() => S.readPublicConfig(mk("service_role")));
  assert.throws(() => S.readPublicConfig(mk("authenticated")));
  assert.throws(() => S.readPublicConfig(mk(null)));
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), "cfg-"));
  fs.writeFileSync(path.join(empty, ".env"), "OTHER=1\n");
  assert.throws(() => S.readPublicConfig(empty));
});

test("script references no voice, speech or realtime endpoint and only /api/ai", () => {
  const src = fs.readFileSync(SCRIPT, "utf8");
  assert.equal(S.AI_PATH, "/api/ai");
  assert.ok(
    !/\/api\/(stt|tts|tts-elevenlabs)|realtime|\/voice\/|elevenlabs|openai\.com/i.test(src),
  );
  assert.deepEqual([...new Set([...src.matchAll(/\/api\/[a-z/-]+/g)].map((m) => m[0]))].sort(), [
    "/api/ai",
    "/api/public/version",
  ]);
  assert.equal(
    [...src.matchAll(/await fetch\(/g)].length,
    [...src.matchAll(/redirect: "error"/g)].length,
  );
});
