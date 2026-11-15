// Failover for the direct AI provider: mocked fetch only, no network.
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

function load(file, { env = {}, mocks = {}, fetch: fetcher, globals = {} } = {}) {
  const js = ts.transpileModule(readFileSync(new URL(`../${file}`, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(js, {
    exports: module.exports,
    module,
    process: { env },
    URL,
    Response,
    JSON,
    Date,
    console: { error() {}, warn: (m) => (globals.warns ??= []).push(String(m)) },
    ...globals.extra,
    fetch:
      fetcher ??
      (() => {
        throw new Error("Unexpected network call");
      }),
    require: (name) => {
      if (name in mocks) return mocks[name];
      throw new Error("Unexpected import " + name);
    },
  });
  return module.exports;
}

const ok = (text, extra = {}) =>
  Response.json({
    choices: [{ message: { content: text }, finish_reason: extra.finish ?? "stop" }],
    usage: { prompt_tokens: extra.p ?? 10, completion_tokens: extra.c ?? 5 },
  });
const msgs = [{ role: "user", content: "hi" }];

function setup(extraEnv, script, globals = {}) {
  const env = {
    AI_API_KEY: "primary-key",
    AI_BASE_URL: "https://primary.example.test/v1",
    AI_CHAT_MODEL: "main-model",
    ...extraEnv,
  };
  const calls = [];
  const fetcher = async (url, init) => {
    const call = { url, auth: init.headers.Authorization, body: JSON.parse(init.body) };
    calls.push(call);
    const step = script[calls.length - 1];
    if (!step) throw new Error("unexpected extra call #" + calls.length);
    if (step instanceof Error) throw step;
    return typeof step === "function" ? step(call) : step;
  };
  const provider = load("src/lib/ai/provider.server.ts", { env });
  const models = load("src/lib/ai/models.server.ts", { env, globals });
  const gateway = load("src/lib/ai/gateway.server.ts", {
    env,
    globals,
    mocks: { "./provider.server": provider, "./models.server": models },
    fetch: fetcher,
  });
  return { gateway, models, provider, calls, env, globals };
}
const FB = { AI_FALLBACK_MODEL: "backup-model" };

test("fallbackConfig is off by default and has explicit off switches", () => {
  const { models } = setup({}, []);
  assert.equal(models.fallbackConfig({ AI_CHAT_MODEL: "a" }), undefined);
  assert.equal(models.fallbackConfig({ AI_CHAT_MODEL: "a", AI_FALLBACK_MODEL: "b" }).model, "b");
  assert.equal(
    models.fallbackConfig({ AI_CHAT_MODEL: "a", AI_FALLBACK_MODEL: "b", AI_FALLBACK: "off" }),
    undefined,
  );
  assert.equal(
    models.fallbackConfig({ AI_CHAT_MODEL: "a", AI_FALLBACK_MODEL: "b", AI_ROUTING: "off" }),
    undefined,
  );
  assert.equal(models.fallbackConfig({ AI_FALLBACK_MODEL: "bad model!" }), undefined);
});

test("a different fallback endpoint needs its own key; the primary key is never reused for it", () => {
  const { models } = setup({}, []);
  assert.equal(
    models.fallbackConfig({
      AI_FALLBACK_MODEL: "b",
      AI_FALLBACK_BASE_URL: "https://api.openai.com/v1",
    }),
    undefined,
  );
  const cfg = models.fallbackConfig({
    AI_BASE_URL: "https://generativelanguage.googleapis.com/v1beta/openai",
    AI_FALLBACK_MODEL: "openai/gpt-6-luna",
    AI_FALLBACK_BASE_URL: "https://api.openai.com/v1",
    AI_FALLBACK_API_KEY: "fb-key",
  });
  assert.equal(cfg.model, "gpt-6-luna");
  assert.equal(cfg.apiKey, "fb-key");
  assert.equal(cfg.baseUrl, "https://api.openai.com/v1");
});

test("without AI_FALLBACK_MODEL a failure behaves exactly as before: one call, error thrown", async () => {
  const { gateway, calls } = setup({}, [new Response("x", { status: 503 })]);
  await assert.rejects(gateway.chatJSON({ messages: msgs }), (e) => e.status === 503);
  assert.equal(calls.length, 1);
});

test("429 and 5xx fall back once to the second model; usage is the fallback only", async () => {
  for (const status of [429, 500, 503, 402]) {
    const { gateway, calls } = setup(FB, [
      new Response("x", { status }),
      ok("hello", { p: 7, c: 3 }),
    ]);
    const out = await gateway.chatJSON({ messages: msgs });
    assert.equal(calls.length, 2);
    assert.equal(calls[0].body.model, "main-model");
    assert.equal(calls[1].body.model, "backup-model");
    assert.equal(out.text, "hello");
    assert.equal(out.model, "backup-model");
    assert.equal(out.fellBack, true);
    assert.equal(out.promptTokens, 7);
    assert.equal(out.completionTokens, 3);
  }
});

test("network error or timeout falls back", async () => {
  const { gateway, calls } = setup(FB, [new TypeError("fetch failed"), ok("fine")]);
  assert.equal((await gateway.chatJSON({ messages: msgs })).text, "fine");
  assert.equal(calls.length, 2);
});

test("retries are bounded: primary + one fallback, then the primary error is thrown", async () => {
  const { gateway, calls } = setup(FB, [
    new Response("x", { status: 429 }),
    new Response("x", { status: 500 }),
    ok("never reached"),
  ]);
  await assert.rejects(gateway.chatJSON({ messages: msgs }), (e) => e.status === 429);
  assert.equal(calls.length, 2);
});

test("auth and validation errors do not fall back (not a capacity problem)", async () => {
  for (const status of [401, 403, 404]) {
    const { gateway, calls } = setup(FB, [new Response("x", { status })]);
    await assert.rejects(gateway.chatJSON({ messages: msgs }), (e) => e.status === status);
    assert.equal(calls.length, 1);
  }
  const { gateway, calls } = setup(FB, [new Response("x", { status: 400 })]);
  await assert.rejects(gateway.chatJSON({ messages: msgs }), (e) => e.status === 400);
  assert.equal(calls.length, 1, "400 without JSON mode is our bug, not a provider refusal");
});

test("empty reply falls back; if the fallback is also empty the original empty reply is returned", async () => {
  const a = setup(FB, [ok(""), ok("recovered")]);
  assert.equal((await a.gateway.chatJSON({ messages: msgs })).text, "recovered");
  const b = setup(FB, [ok(""), ok("")]);
  const out = await b.gateway.chatJSON({ messages: msgs });
  assert.equal(out.text, "");
  assert.equal(out.model, "main-model");
  assert.equal(b.calls.length, 2);
});

test("truncated or unparseable JSON in JSON mode falls back; plain text mode does not", async () => {
  const a = setup(FB, [ok('{"a": 1', { finish: "length", c: 2048 }), ok('{"a":1}')]);
  const out = await a.gateway.chatJSON({ messages: msgs, jsonMode: true });
  assert.equal(out.text, '{"a":1}');
  assert.equal(out.completionTokens, 5, "the truncated attempt is not charged");
  const fenced = setup(FB, [ok('```json\n{"a":1}\n```')]);
  assert.equal(
    (await fenced.gateway.chatJSON({ messages: msgs, jsonMode: true })).fellBack,
    undefined,
  );
  assert.equal(fenced.calls.length, 1);
  const prose = setup(FB, [ok("not json at all but fine")]);
  assert.equal((await prose.gateway.chatJSON({ messages: msgs })).text, "not json at all but fine");
  assert.equal(prose.calls.length, 1);
});

test("a provider refusing JSON mode (400) falls back only when JSON mode was requested", async () => {
  const { gateway, calls } = setup(FB, [
    new Response("bad response_format", { status: 400 }),
    ok('{"ok":true}'),
  ]);
  const out = await gateway.chatJSON({ messages: msgs, jsonMode: true });
  assert.equal(out.model, "backup-model");
  assert.equal(calls.length, 2);
});

test("fallback to another provider uses its URL and key and its own request shape", async () => {
  const { gateway, calls } = setup(
    {
      AI_FALLBACK_MODEL: "gpt-6-luna",
      AI_FALLBACK_BASE_URL: "https://api.openai.com/v1/",
      AI_FALLBACK_API_KEY: "fb-key",
    },
    [new Response("x", { status: 503 }), ok('{"ok":1}')],
  );
  await gateway.chatJSON({ messages: msgs, jsonMode: true, temperature: 0.1 });
  assert.equal(calls[0].url, "https://primary.example.test/v1/chat/completions");
  assert.equal(calls[0].auth, "Bearer primary-key");
  assert.equal(calls[1].url, "https://api.openai.com/v1/chat/completions");
  assert.equal(calls[1].auth, "Bearer fb-key");
  assert.equal(calls[1].body.max_completion_tokens, 2048, "OpenAI reasoning body shape");
  assert.equal(calls[1].body.temperature, undefined);
  assert.equal(calls[0].body.response_format.type, "json_object");
});

test("explicit model argument (coach path) still falls back; fallback equal to primary is skipped", async () => {
  const a = setup(FB, [new Response("x", { status: 500 }), ok("x")]);
  assert.equal(
    (await a.gateway.chatJSON({ model: "chosen", messages: msgs })).model,
    "backup-model",
  );
  const b = setup({ AI_FALLBACK_MODEL: "main-model" }, [new Response("x", { status: 500 })]);
  await assert.rejects(b.gateway.chatJSON({ messages: msgs }));
  assert.equal(b.calls.length, 1);
});

test("streaming falls back before the first byte only, once", async () => {
  const a = setup(FB, [
    new Response("x", { status: 429 }),
    new Response("data: [DONE]\n\n", { status: 200 }),
  ]);
  const res = await a.gateway.chatStream({ messages: msgs, maxTokens: 180 });
  assert.equal(res.status, 200);
  assert.equal(a.calls.length, 2);
  assert.equal(a.calls[1].body.model, "backup-model");
  assert.equal(a.calls[1].body.max_tokens, 180);
  assert.deepEqual(JSON.parse(JSON.stringify(a.calls[1].body.stream_options)), {
    include_usage: true,
  });
  const b = setup(FB, [new Response("x", { status: 500 }), new Response("x", { status: 500 })]);
  await assert.rejects(b.gateway.chatStream({ messages: msgs }), (e) => e.status === 500);
  assert.equal(b.calls.length, 2);
  const c = setup(FB, [new Response("x", { status: 401 })]);
  await assert.rejects(c.gateway.chatStream({ messages: msgs }), (e) => e.status === 401);
  assert.equal(c.calls.length, 1);
});

test("failover never touches admission or budget: gateway has no budget or log imports", () => {
  const src = readFileSync(new URL("../src/lib/ai/gateway.server.ts", import.meta.url), "utf8");
  assert.doesNotMatch(src, /import[^;]*log\.server|\.rpc\(|\.from\("ai_log"\)/);
});

// ---- review round 2 ----
const CROSS = {
  AI_FALLBACK_MODEL: "gpt-6-luna",
  AI_FALLBACK_BASE_URL: "https://api.openai.com/v1",
  AI_FALLBACK_API_KEY: "fb-key",
};
const st = (status) => new Response("x", { status });

test("primary throws and fallback is unusable: the PRIMARY error is thrown, never the unusable reply", async () => {
  const a = setup(FB, [st(503), ok("")]);
  await assert.rejects(a.gateway.chatJSON({ messages: msgs }), (e) => e.status === 503);
  assert.equal(a.calls.length, 2);
  const b = setup(FB, [st(503), ok('{"a": 1', { finish: "stop" })]);
  await assert.rejects(
    b.gateway.chatJSON({ messages: msgs, jsonMode: true }),
    (e) => e.status === 503,
  );
  const c = setup(FB, [st(429), ok('{"a":1}', { finish: "length" })]);
  await assert.rejects(
    c.gateway.chatJSON({ messages: msgs, jsonMode: true }),
    (e) => e.status === 429,
  );
});

test("stream: when both attempts fail the PRIMARY status is thrown", async () => {
  const a = setup(FB, [st(503), st(500)]);
  await assert.rejects(a.gateway.chatStream({ messages: msgs }), (e) => e.status === 503);
  const b = setup(FB, [new TypeError("down"), st(500)]);
  await assert.rejects(b.gateway.chatStream({ messages: msgs }), (e) => e.status === 502);
});

test("fallback host is restricted to the vendors users were told about", () => {
  const { models } = setup({}, []);
  const base = { AI_CHAT_MODEL: "a", AI_FALLBACK_MODEL: "b", AI_FALLBACK_API_KEY: "k" };
  const bad = [
    "https://api.anthropic.com/v1",
    "https://example.com/v1",
    "https://ai.gateway.lovable.dev/v1",
    "https://x.lovable.dev/v1",
    "http://api.openai.com/v1",
    "https://user:pw@api.openai.com/v1",
    "https://api.openai.com/v1?x=1",
    "https://api.openai.com/v1#h",
    "not a url",
  ];
  for (const url of bad) {
    const g = {};
    const m = load("src/lib/ai/models.server.ts", { env: {}, globals: g });
    assert.equal(m.fallbackConfig({ ...base, AI_FALLBACK_BASE_URL: url }), undefined, url);
    assert.equal(g.warns.length, 1, "one clear warning for " + url);
    assert.doesNotMatch(g.warns[0], /user:pw|AI_FALLBACK_API_KEY=/);
  }
  for (const url of [
    "https://api.openai.com/v1",
    "https://generativelanguage.googleapis.com/v1beta/openai",
  ]) {
    assert.equal(models.fallbackConfig({ ...base, AI_FALLBACK_BASE_URL: url }).baseUrl, url);
  }
  assert.equal(
    models.fallbackConfig(base).baseUrl,
    undefined,
    "same-host fallback needs no base URL",
  );
});

test("aiEndpoint rejects http, credentials, query, hash and lovable.dev", () => {
  const ep = (env, base) =>
    load("src/lib/ai/provider.server.ts", { env }).aiEndpoint("chat/completions", base);
  assert.equal(
    ep({ AI_BASE_URL: "https://api.openai.com/v1" }),
    "https://api.openai.com/v1/chat/completions",
  );
  for (const bad of [
    "http://api.openai.com/v1",
    "https://u:p@api.openai.com/v1",
    "https://api.openai.com/v1?a=1",
    "https://api.openai.com/v1#x",
    "https://ai.gateway.lovable.dev/v1",
    "https://lovable.dev/v1",
  ]) {
    assert.throws(() => ep({ AI_BASE_URL: bad }), undefined, bad);
    assert.throws(
      () => ep({ AI_BASE_URL: "https://api.openai.com/v1" }, bad),
      undefined,
      "override " + bad,
    );
  }
});

test("default path (failover unset) is the original: raw errors, no timer, no signal", async () => {
  let timers = 0;
  const extra = {
    setTimeout: () => {
      timers++;
      return 1;
    },
    clearTimeout() {},
    AbortController,
    AbortSignal,
  };
  const err = new TypeError("fetch failed");
  const a = setup({}, [err, err, new Response("not json", { status: 200 })], { extra });
  const orig = a.gateway;
  await assert.rejects(
    orig.chatJSON({ messages: msgs }),
    (e) => e === err,
    "network TypeError propagates unchanged",
  );
  await assert.rejects(orig.chatStream({ messages: msgs }), (e) => e === err);
  await assert.rejects(
    orig.chatJSON({ messages: msgs }),
    (e) => e.name === "SyntaxError",
    "res.json failure is raw",
  );
  assert.equal(timers, 0, "no timer without failover");
  const b = setup({}, [ok("x")], { extra });
  let seen;
  const g = load("src/lib/ai/gateway.server.ts", {
    env: b.env,
    globals: { extra },
    mocks: {
      "./provider.server": b.provider,
      "./models.server": load("src/lib/ai/models.server.ts", { env: b.env }),
    },
    fetch: async (_u, init) => {
      seen = init;
      return ok("x");
    },
  });
  await g.chatJSON({ messages: msgs });
  assert.equal("signal" in seen, false);
  const c = setup({}, [st(503)], { extra });
  await assert.rejects(
    c.gateway.chatJSON({ messages: msgs }),
    (e) => e.status === 503 && e.name === "AIError",
  );
});

test("stream fallback uses the FALLBACK key and base URL, never the primary key", async () => {
  const a = setup(CROSS, [st(503), new Response("data: [DONE]\n\n")]);
  await a.gateway.chatStream({ messages: msgs, maxTokens: 180 });
  assert.equal(a.calls[0].url, "https://primary.example.test/v1/chat/completions");
  assert.equal(a.calls[0].auth, "Bearer primary-key");
  assert.equal(a.calls[1].url, "https://api.openai.com/v1/chat/completions");
  assert.equal(a.calls[1].auth, "Bearer fb-key");
  assert.equal(a.calls[1].body.model, "gpt-6-luna");
});

function fakeTimers() {
  const t = { set: [], cleared: [] };
  t.extra = {
    AbortController,
    AbortSignal,
    setTimeout: (fn, ms) => {
      t.set.push({ fn, ms });
      return t.set.length;
    },
    clearTimeout: (id) => t.cleared.push(id),
  };
  return t;
}

test("with failover on, a signal is passed, the 25s timer aborts the attempt, and the timer is always cleared", async () => {
  const t = fakeTimers();
  const signals = [];
  const env = {
    AI_API_KEY: "k",
    AI_BASE_URL: "https://primary.example.test/v1",
    AI_CHAT_MODEL: "m",
    ...FB,
  };
  const fetcher = (_url, init) => {
    signals.push(init.signal);
    if (signals.length === 1) {
      return new Promise((_res, rej) =>
        init.signal.addEventListener("abort", () => rej(new DOMException("aborted", "AbortError"))),
      );
    }
    return Promise.resolve(ok("recovered"));
  };
  const g = load("src/lib/ai/gateway.server.ts", {
    env,
    globals: { extra: t.extra },
    mocks: {
      "./provider.server": load("src/lib/ai/provider.server.ts", { env }),
      "./models.server": load("src/lib/ai/models.server.ts", { env }),
    },
    fetch: fetcher,
  });
  const p = g.chatJSON({ messages: msgs });
  await new Promise((r) => setImmediate(r));
  assert.equal(t.set.length, 1);
  assert.equal(t.set[0].ms, 25000);
  assert.ok(signals[0] && signals[0].aborted === false);
  t.set[0].fn(); // fire the timeout without waiting 25s
  const out = await p;
  assert.equal(signals[0].aborted, true);
  assert.equal(out.text, "recovered");
  assert.equal(out.fellBack, true);
  assert.equal(t.set.length, 2);
  assert.equal(t.cleared.length, 2, "every timer cleared, including after the abort");
  assert.ok(signals[1] && signals[1] !== signals[0]);
});

test("truncated reply with valid JSON still falls back; unparseable body with finish_reason=stop also falls back", async () => {
  const a = setup(FB, [ok('{"a":1}', { finish: "length" }), ok('{"b":2}')]);
  const out = await a.gateway.chatJSON({ messages: msgs, jsonMode: true });
  assert.equal(out.text, '{"b":2}');
  assert.equal(a.calls.length, 2);
  const b = setup(FB, [ok("Sure! here you go", { finish: "stop" }), ok('{"b":2}')]);
  assert.equal((await b.gateway.chatJSON({ messages: msgs, jsonMode: true })).fellBack, true);
});
