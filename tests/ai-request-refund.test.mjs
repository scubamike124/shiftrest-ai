// A customer's request is given back when the AI provider failed them
// (migration 20261116090000_ai_request_refund.sql; SQL behaviour is tested in
// tests/ai-request-refund-sql.test.mjs). These tests run the REAL admission
// module and the REAL route handlers with a fake Supabase client (every
// refund_ai_request call is recorded) and a fake provider, and prove:
//   - a request the provider failed (unreachable, 5xx, 429, 402, and its own
//     401/403) is given back exactly once, on every AI route;
//   - never when any text or audio was delivered, never for a request the
//     provider rejected (4xx), never for a malformed model answer, never on a
//     validation/consent/auth error, never on the user's own refusal, never on
//     a client abort;
//   - a missing, failing, throwing or hanging refund never changes the
//     customer's response and never throws;
//   - the refund is available only for an admitted request that has a token.
import assert from "node:assert/strict";
import test from "node:test";
import {
  coachBody,
  drain,
  fakeDb,
  jsonRequest,
  loadRoute,
  makeLoader,
  provider,
  settle,
  sttRequest,
  USER,
} from "./_ai-route-harness.mjs";

const R = (d) => JSON.parse(JSON.stringify(d.refunds));

// ---------------------------------------------------------------- admission

function admissionWith(db) {
  return makeLoader(
    { "@supabase/supabase-js": { createClient: () => db } },
    {
      Response,
      Promise,
      setTimeout,
      clearTimeout,
      console,
      process: {
        env: {
          SUPABASE_URL: "https://example.supabase.test",
          SUPABASE_SERVICE_ROLE_KEY: "service-role-example",
        },
      },
    },
  )("src/lib/ai/admission.server.ts");
}

async function admit(dbOpts = {}) {
  const db = fakeDb(dbOpts);
  const m = admissionWith(db);
  const handle = {};
  const refusal = await m.requireAIAdmission(USER, handle);
  return { db, handle, refusal, m };
}

test("an admitted request carries a refund handle bound to its own token", async () => {
  const { db, handle, refusal } = await admit();
  assert.equal(refusal, null);
  assert.equal(typeof handle.refundProviderFailure, "function");
  assert.equal(await handle.refundProviderFailure(500), true);
  assert.deepEqual(R(db), [{ _user_id: USER, _token: "req-1" }]);
});

test("the handle gives back at most once, whatever calls it", async () => {
  const { db, handle } = await admit();
  assert.equal(await handle.refundProviderFailure(null), true);
  assert.equal(await handle.refundProviderFailure(500), false);
  assert.equal(await handle.refundProviderFailure(429), false);
  assert.equal(db.refunds.length, 1);
});

for (const status of [null, 401, 402, 403, 408, 429, 500, 502, 503, 504, 599]) {
  test(`provider failure ${status === null ? "(unreachable)" : status} is refundable`, async () => {
    const { db, handle } = await admit();
    assert.equal(await handle.refundProviderFailure(status), true);
    assert.equal(db.refunds.length, 1);
  });
}

for (const status of [
  200,
  204,
  301,
  400,
  404,
  405,
  409,
  413,
  415,
  422,
  499,
  Number.NaN,
  1.5,
  undefined,
]) {
  test(`status ${status} (not a provider outage) is never refunded`, async () => {
    const { db, handle } = await admit();
    assert.equal(await handle.refundProviderFailure(status), false);
    assert.deepEqual(R(db), []);
  });
}

test("a client abort is never refunded", async () => {
  const { db, handle } = await admit();
  const ctl = new AbortController();
  ctl.abort();
  assert.equal(await handle.refundProviderFailure(null, ctl.signal), false);
  assert.deepEqual(R(db), []);
  // An abort does not spend the one refund: a later genuine failure of the same request is not possible,
  // but a live signal is accepted.
  assert.equal(await handle.refundProviderFailure(500, new AbortController().signal), true);
});

test("no handle for a refused request: the user's allowance, the request limit, bad answers", async () => {
  for (const opts of [{ budgetOk: false }, { requestRetry: 30 }, { requestBad: true }]) {
    const { db, handle, refusal } = await admit(opts);
    assert.ok(refusal, JSON.stringify(opts));
    assert.equal(handle.refundProviderFailure, undefined, JSON.stringify(opts));
    assert.deepEqual(R(db), []);
  }
});

test("rollout order: before the migration (no token) there is simply nothing to give back", async () => {
  const { db, handle, refusal } = await admit({ withToken: false });
  assert.equal(refusal, null, "the request is still admitted");
  assert.equal(handle.refundProviderFailure, undefined);
  assert.deepEqual(R(db), []);
});

test("a failing refund never throws and never reports a refund", async () => {
  for (const refund of ["error", "throw"]) {
    const { handle } = await admit({ refund });
    assert.equal(await handle.refundProviderFailure(500), false, refund);
  }
});

test(
  "a hanging refund is cut off (about 2 s) and reports no refund",
  { timeout: 8000 },
  async () => {
    const { handle } = await admit({ refund: "hang" });
    const t0 = Date.now();
    assert.equal(await handle.refundProviderFailure(500), false);
    const took = Date.now() - t0;
    assert.ok(took >= 1500 && took < 4000, `took ${took} ms`);
  },
);

test("a refund the database declined (already refunded, window closed) is reported false", async () => {
  const db = fakeDb();
  const original = db.rpc.bind(db);
  db.rpc = async (name, args) =>
    name === "refund_ai_request"
      ? (db.refunds.push(args), { data: { refunded: false, reason: "window_closed" }, error: null })
      : original(name, args);
  const handle = {};
  await admissionWith(db).requireAIAdmission(USER, handle);
  assert.equal(await handle.refundProviderFailure(500), false);
});

test("requireAIAdmission without a handle behaves as before (realtime and the lab routes)", async () => {
  const db = fakeDb();
  assert.equal(await admissionWith(db).requireAIAdmission(USER), null);
  assert.deepEqual(db.rpcCalls, ["has_ai_budget", "consume_ai_request"]);
});

// ------------------------------------------------------------------- routes

const INSIGHTS_JSON = JSON.stringify({
  headline: "Steady week.",
  top_actions: [{ title: "Nap at 3 pm", detail: "Twenty minutes.", impact: "high" }],
  risks: [],
  summary: "Fine.",
});

const SURFACES = [
  ["ai (coach, streamed)", "ai", () => jsonRequest(coachBody())],
  ["ai (json intent)", "ai", () => jsonRequest({ intent: "coach_tip" })],
  ["ai (brief intent)", "ai", () => jsonRequest({ intent: "brief", plan: "Sleep at 9am." })],
  ["brief", "brief", () => jsonRequest({ plan: "Sleep at 9am." }, "/api/brief")],
  ["insights", "insights", () => jsonRequest({ context: "Night shift tonight." }, "/api/insights")],
  ["swap", "swap", () => jsonRequest({ context: "Extra shift Saturday." }, "/api/swap")],
  ["stt", "stt", sttRequest],
  ["tts", "tts", () => jsonRequest({ text: "Good morning." }, "/api/tts")],
  [
    "tts-elevenlabs",
    "tts-elevenlabs",
    () => jsonRequest({ text: "Good morning." }, "/api/tts-elevenlabs"),
  ],
];

async function run(file, makeReq, { dbOpts, spyOpts, request } = {}) {
  const db = fakeDb(dbOpts);
  const spy = provider(spyOpts);
  const h = loadRoute(file, { db, spy });
  const res = await h.post({ request: request ?? makeReq() });
  const text = await drain(res);
  await settle();
  return { res, text, db, spy };
}

const FAILURES = [
  ["provider unreachable", { network: true }],
  ["provider 500", { status: 500 }],
  ["provider 503", { status: 503 }],
  ["provider 429", { status: 429 }],
  ["provider 402 (credits)", { status: 402 }],
];

for (const [label, file, makeReq] of SURFACES) {
  for (const [why, spyOpts] of FAILURES) {
    test(`/api/${label}: ${why} gives the request back exactly once`, async () => {
      const { res, db } = await run(file, makeReq, { spyOpts });
      assert.equal(db.consumed, 1, "the request was admitted (consumed) first");
      assert.deepEqual(R(db), [{ _user_id: USER, _token: "req-1" }]);
      assert.ok(
        res.status !== 200 || file.startsWith("tts") || file === "brief",
        `${label}: reported as a failure`,
      );
    });
  }

  test(`/api/${label}: a working provider gives nothing back`, async () => {
    const { res, db } = await run(file, makeReq, {
      spyOpts: { json: file === "insights" ? INSIGHTS_JSON : undefined },
    });
    void res;
    assert.equal(db.consumed, 1);
    assert.deepEqual(R(db), []);
  });

  test(`/api/${label}: a request the provider rejected (400, 404, 422) gives nothing back`, async () => {
    for (const status of [400, 404, 422]) {
      const { db } = await run(file, makeReq, { spyOpts: { status } });
      assert.equal(db.consumed, 1);
      assert.deepEqual(R(db), [], `provider ${status}`);
    }
  });

  test(
    `/api/${label}: the customer's response is the same whether the refund works, errors, throws or hangs`,
    { timeout: 15000 },
    async () => {
      const seen = [];
      for (const refund of ["ok", "error", "throw", "hang"]) {
        const { res, text, db } = await run(file, makeReq, {
          dbOpts: { refund },
          spyOpts: { status: 500 },
        });
        assert.equal(db.refunds.length, 1, refund);
        seen.push([res.status, text]);
      }
      for (const s of seen) assert.deepEqual(s, seen[0]);
    },
  );

  test(`/api/${label}: a client that already left gets nothing refunded`, async () => {
    const ctl = new AbortController();
    ctl.abort();
    const base = makeReq();
    const request = new Request(base.url, {
      method: "POST",
      headers: base.headers,
      body: await base.clone().arrayBuffer(),
      signal: ctl.signal,
    });
    const { db } = await run(file, makeReq, { request, spyOpts: { network: true } });
    assert.deepEqual(R(db), []);
  });

  test(`/api/${label}: the user's own refusals give nothing back and never call the provider`, async () => {
    for (const dbOpts of [{ budgetOk: false }, { requestRetry: 12 }]) {
      const { db, spy } = await run(file, makeReq, { dbOpts, spyOpts: { network: true } });
      assert.deepEqual(R(db), []);
      assert.deepEqual(spy.calls, []);
    }
  });
}

// ---- nothing is refunded when the provider DID answer

test("a malformed model answer (200 with bad JSON) is not refunded: the provider produced output", async () => {
  for (const [file, makeReq] of [
    ["ai", () => jsonRequest({ intent: "coach_tip" })],
    ["insights", () => jsonRequest({ context: "Night shift tonight." }, "/api/insights")],
    ["swap", () => jsonRequest({ context: "Extra shift Saturday." }, "/api/swap")],
  ]) {
    const { res, db } = await run(file, makeReq, { spyOpts: { json: "this is not json" } });
    assert.equal(res.status, 502, file);
    assert.deepEqual(R(db), [], file);
  }
});

test("validation errors are not refunded (missing context, missing plan, missing text)", async () => {
  for (const [file, makeReq] of [
    ["insights", () => jsonRequest({}, "/api/insights")],
    ["swap", () => jsonRequest({}, "/api/swap")],
    ["brief", () => jsonRequest({}, "/api/brief")],
    ["tts", () => jsonRequest({}, "/api/tts")],
    ["tts-elevenlabs", () => jsonRequest({}, "/api/tts-elevenlabs")],
  ]) {
    const { res, db, spy } = await run(file, makeReq, { spyOpts: { network: true } });
    assert.equal(res.status, 400, file);
    assert.deepEqual(R(db), [], file);
    assert.deepEqual(spy.calls, [], file);
  }
});

test("consent refusal and a signed-out caller are refused before admission: nothing consumed, nothing refunded", async () => {
  const db = fakeDb({ consent: null });
  const h = loadRoute("ai", { db, spy: provider({ network: true }) });
  const res = await h.post({ request: jsonRequest(coachBody()) });
  await drain(res);
  assert.equal(db.consumed, 0);
  assert.deepEqual(R(db), []);
  const db2 = fakeDb();
  const h2 = loadRoute("ai", { db: db2, spy: provider() });
  const bad = new Request("https://restpilotai.com/api/ai", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer nobody" },
    body: JSON.stringify(coachBody()),
  });
  assert.equal((await h2.post({ request: bad })).status, 401);
  assert.equal(db2.consumed, 0);
  assert.deepEqual(R(db2), []);
});

// ---- the streamed Companion/Coach answer

async function coach(spyOpts, { cancelAfterFirstChunk = false, dbOpts } = {}) {
  const db = fakeDb(dbOpts);
  const spy = provider(spyOpts);
  const h = loadRoute("ai", { db, spy });
  const res = await h.post({ request: jsonRequest(coachBody()) });
  let text = "";
  if (cancelAfterFirstChunk) {
    const r = res.body.getReader();
    text = new TextDecoder().decode((await r.read()).value);
    await r.cancel();
    await new Promise((r2) => setTimeout(r2, 150));
  } else {
    text = await drain(res);
  }
  await settle();
  return { res, text, db };
}

test("coach stream: the provider dies before ANY text -> given back once (and nothing is debited)", async () => {
  const { text, db } = await coach({ breakBeforeText: true });
  assert.doesNotMatch(text, /Nap at 3 pm/);
  assert.deepEqual(R(db), [{ _user_id: USER, _token: "req-1" }]);
  assert.equal(db.debited, 0);
});

test("coach stream: text was delivered and the provider then broke -> NOT given back, and counted", async () => {
  const { text, db } = await coach({ breakStream: true });
  assert.match(text, /Nap at 3 pm\./);
  assert.deepEqual(R(db), []);
  assert.ok(db.debited > 0);
});

test("coach stream: a normal answer is not refunded", async () => {
  const { text, db } = await coach({});
  assert.match(text, /Nap at 3 pm\./);
  assert.deepEqual(R(db), []);
});

test("coach stream: the client cancels after the first text -> NOT given back", async () => {
  const { db } = await coach({ gapMs: 60, usage: null }, { cancelAfterFirstChunk: true });
  assert.deepEqual(R(db), []);
  assert.ok(db.debited > 0);
});

test("coach stream: the client cancels before any text while the provider is silent -> NOT given back", async () => {
  const db = fakeDb();
  const never = new ReadableStream({ start() {} });
  const spy = {
    calls: [],
    fetch: async () =>
      new Response(never, { status: 200, headers: { "content-type": "text/event-stream" } }),
  };
  const h = loadRoute("ai", { db, spy });
  const res = await h.post({ request: jsonRequest(coachBody()) });
  await res.body.cancel();
  await new Promise((r) => setTimeout(r, 150));
  assert.deepEqual(R(db), []);
});

test("coach stream: the provider is down before the stream starts (500) -> given back, the user gets the busy/unavailable answer", async () => {
  const { res, db } = await coach({ status: 500 });
  assert.equal(res.status, 503);
  assert.deepEqual(R(db), [{ _user_id: USER, _token: "req-1" }]);
});

// ---- the numbers: what an outage costs before and after

test("outage arithmetic: a dashboard load that fails refunds all five of its requests, none is left counted for the day", async () => {
  // One dashboard mount while the provider is down: right_now, tomorrow_preview,
  // daily_review (all /api/ai) and the brief on /api/insights (retried once).
  const db = fakeDb();
  const intents = [
    { intent: "right_now" },
    { intent: "tomorrow_preview" },
    { intent: "daily_review" },
  ];
  for (const body of intents) {
    const h = loadRoute("ai", { db, spy: provider({ status: 503 }) });
    await h.post({ request: jsonRequest(body) });
  }
  for (let i = 0; i < 2; i++) {
    const h = loadRoute("insights", { db, spy: provider({ status: 503 }) });
    await h.post({ request: jsonRequest({ context: "Night shift tonight." }, "/api/insights") });
  }
  assert.equal(db.consumed, 5);
  assert.equal(db.refunds.length, 5);
  assert.deepEqual(
    new Set(db.refunds.map((r) => r._token)).size,
    5,
    "each request refunds its own token",
  );
});
