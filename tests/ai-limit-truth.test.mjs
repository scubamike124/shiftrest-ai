// Release blocker: the owner's FIRST Companion message of the day was answered
// with "You've reached today's AI limit." plus an upgrade prompt.
//
// The client showed that for ANY HTTP 429 from /api/ai, but three unrelated
// things produced a 429:
//   1. the user's own allowance (has_ai_budget, a ROLLING 24 hours),
//   2. the per-user request rate limiter (20 requests a minute),
//   3. the AI provider's own rate limit, passed straight through.
// These tests run the real route handlers (Supabase and the provider replaced,
// no network) and the real client helper, and prove:
//   - each source has its own machine-readable `code` and its own message;
//   - a provider failure never reaches the browser as 429/402/401 and is never
//     presented as the user's limit, on the website or in the app;
//   - only the user's own allowance can show an upgrade prompt, and never
//     inside the native app (App Store Guideline 3.1.1);
//   - the allowance copy is true for a rolling window (no "today", no reset);
//   - a request that produced no AI output does not debit the allowance.
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
  read,
  settle,
  sttRequest,
} from "./_ai-route-harness.mjs";

const refusal = () => makeLoader()("src/lib/ai/refusal.ts");
const describe = (res, body, native = false) =>
  refusal().describeAIRefusal(res.status, body, {
    native,
    retryAfterHeader: res.headers.get("retry-after"),
  });

/** Run /api/ai and return the response, its JSON body and what was written. */
async function ai(body, { db = fakeDb(), spy = provider() } = {}) {
  const h = loadRoute("ai", { db, spy });
  const res = await h.post({ request: jsonRequest(body) });
  const text = await drain(res);
  await settle();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* SSE */
  }
  return { res, json, text, db, spy, alerts: h.alerts };
}

// The old copy, in any of its spellings.
const SAYS_USER_LIMIT = /today's (free )?AI limit|daily AI limit|your (AI )?limit reached|AI allowance/i;
const SAYS_NOT_YOUR_LIMIT = /(isn't|is not) your limit/i;

// ---- 1. each 429 source has its own code ------------------------------------

test("source 1, the user's allowance: 429 daily_limit, rolling-window copy, no provider call", async () => {
  const { res, json, spy, db } = await ai(coachBody(), { db: fakeDb({ budgetOk: false }) });
  assert.equal(res.status, 429);
  assert.equal(json.code, "daily_limit");
  assert.equal(json.window_hours, 24);
  assert.deepEqual(spy.calls, [], "the provider is not called");
  assert.deepEqual(db.aiLog, [], "nothing is debited");
  // True for a rolling window: no fixed reset moment is promised.
  assert.match(json.error, /24 hours/);
  assert.doesNotMatch(json.error, /resets in 24 hours|today|tomorrow|it resets/i);
  assert.match(json.error, /doesn't reset at midnight/);
});

test("source 2, the request rate limiter: 429 rate_limited with retry_after_seconds", async () => {
  const { res, json, spy, db } = await ai(coachBody(), { db: fakeDb({ rateCount: 21 }) });
  assert.equal(res.status, 429);
  assert.equal(json.code, "rate_limited");
  assert.ok(json.retry_after_seconds >= 1 && json.retry_after_seconds <= 60);
  assert.equal(res.headers.get("retry-after"), String(json.retry_after_seconds));
  assert.deepEqual(spy.calls, [], "the provider is not called");
  assert.deepEqual(db.aiLog, [], "a rate-limited request debits nothing");
  assert.ok(!db.rpcCalls.includes("has_ai_budget"), "refused before the budget check");
});

test("the limiter still allows the 20th request in a minute and refuses the 21st", async () => {
  const ok = await ai(coachBody(), { db: fakeDb({ rateCount: 20 }) });
  assert.equal(ok.res.status, 200);
  const refused = await ai(coachBody(), { db: fakeDb({ rateCount: 21 }) });
  assert.equal(refused.res.status, 429);
});

for (const [label, body] of [
  ["coach (Companion chat)", coachBody()],
  ["coach_tip (dashboard card)", { intent: "coach_tip", context: "night shift" }],
  ["brief", { intent: "brief", plan: "Sleep at 9am." }],
]) {
  test(`source 3, the provider's rate limit, ${label}: 503 ai_provider_busy, never a 429`, async () => {
    const { res, json, alerts } = await ai(body, { spy: provider({ status: 429 }) });
    assert.equal(res.status, 503, "a provider 429 must not reach the browser as a 429");
    assert.equal(json.code, "ai_provider_busy");
    assert.equal(json.retryable, true);
    assert.ok(Number(res.headers.get("retry-after")) > 0);
    assert.match(json.error, SAYS_NOT_YOUR_LIMIT);
    assert.doesNotMatch(json.error, /^Rate limit reached/);
    // The owner alert is unchanged.
    assert.deepEqual(
      alerts.map((a) => [a.severity, a.service, a.message]),
      [["warning", "ai", "rate_limited"]],
    );
  });
}

for (const [upstream, alert] of [
  [402, "credits_exhausted"],
  [401, "upstream_auth_failed"],
  [403, "upstream_auth_failed"],
  [500, "upstream_5xx"],
  [503, "upstream_5xx"],
]) {
  test(`provider ${upstream}: retryable 503 ai_provider_unavailable, owner alert "${alert}" kept`, async () => {
    const { res, json, alerts } = await ai(coachBody(), { spy: provider({ status: upstream }) });
    assert.equal(res.status, 503, `the provider's ${upstream} is not passed through`);
    assert.equal(json.code, "ai_provider_unavailable");
    assert.equal(json.retryable, true);
    assert.match(json.error, SAYS_NOT_YOUR_LIMIT);
    assert.deepEqual(alerts.map((a) => a.message), [alert]);
    assert.doesNotMatch(JSON.stringify(json), /credit|billing|api key/i, "no operator wording");
  });
}

test("provider unreachable (network error): retryable 503 ai_provider_unavailable", async () => {
  const { res, json, alerts } = await ai(coachBody(), { spy: provider({ network: true }) });
  assert.equal(res.status, 503);
  assert.equal(json.code, "ai_provider_unavailable");
  assert.deepEqual(alerts.map((a) => a.message), ["upstream_5xx"]);
});

test("provider rejects the request (400): 502 ai_provider_error, not retryable, not the user's limit", async () => {
  const { res, json } = await ai(coachBody(), { spy: provider({ status: 400 }) });
  assert.equal(res.status, 502);
  assert.equal(json.code, "ai_provider_error");
  assert.equal(json.retryable, false);
  assert.match(json.error, SAYS_NOT_YOUR_LIMIT);
});

for (const [file, makeReq] of [
  ["insights", () => jsonRequest({ context: "Night shift tonight." }, "/api/insights")],
  ["swap", () => jsonRequest({ context: "Extra shift Saturday." }, "/api/swap")],
  ["stt", sttRequest],
  ["tts-elevenlabs", () => jsonRequest({ text: "Good morning." }, "/api/tts-elevenlabs")],
]) {
  for (const upstream of [429, 402]) {
    test(`/api/${file}: provider ${upstream} is not passed through and carries a provider code`, async () => {
      const db = fakeDb();
      const h = loadRoute(file, { db, spy: provider({ status: upstream }) });
      const res = await h.post({ request: makeReq() });
      const json = await res.json();
      assert.ok(res.status === 503 || res.status === 502, `got ${res.status}`);
      assert.match(json.code, /^ai_provider_(busy|unavailable)$/);
      assert.equal(json.code === "ai_provider_busy", upstream === 429);
      assert.deepEqual(db.aiLog, [], "a failed provider call debits nothing");
    });
  }
}

test("no AI route sends the provider's own status to the browser", () => {
  for (const f of ["ai", "brief", "insights", "swap", "stt", "tts", "tts-elevenlabs"]) {
    const src = read(`src/routes/api/${f}.ts`);
    // (`meta: { status: upstream.status }` in an owner alert is fine.)
    assert.doesNotMatch(src, /\{\s*status:\s*upstream\.status,\s*headers/, `${f}: Response with the provider's status`);
    assert.doesNotMatch(src, /\?\s*402\s*:/, `${f}: 402 is never chosen as a response status`);
    assert.doesNotMatch(src, /\?\s*429\s*:/, `${f}: 429 is never chosen as a response status`);
  }
  // /api/ai answers a provider failure through the shared helper.
  assert.match(read("src/routes/api/ai.ts"), /if \(upstreamFailure\) return providerFailureResponse\(status\);/);
});

// ---- 2. each source gets its own message on the client -----------------------

test("server response -> client message: three sources, three different messages", async () => {
  const allowance = await ai(coachBody(), { db: fakeDb({ budgetOk: false }) });
  const rate = await ai(coachBody(), { db: fakeDb({ rateCount: 99 }) });
  const busy = await ai(coachBody(), { spy: provider({ status: 429 }) });

  const a = describe(allowance.res, allowance.json);
  const r = describe(rate.res, rate.json);
  const p = describe(busy.res, busy.json);
  assert.deepEqual([a.kind, r.kind, p.kind], ["daily_limit", "rate_limited", "provider_busy"]);
  assert.equal(new Set([a.title, r.title, p.title]).size, 3);
  assert.equal(new Set([a.chatMessage, r.chatMessage, p.chatMessage]).size, 3);

  // Allowance: true for a rolling window.
  assert.match(a.chatMessage, /last 24 hours/);
  assert.match(a.chatMessage, /doesn't reset at midnight/);
  assert.doesNotMatch(a.title + a.chatMessage, /today's|tomorrow|unlimited/i);

  // Rate limit: says how long to wait, and that it is not the allowance.
  assert.match(r.description, new RegExp(`^Wait ${rate.json.retry_after_seconds} seconds? and try again\\.$`));
  assert.match(r.chatMessage, /not your AI allowance/);
  assert.doesNotMatch(r.title + r.chatMessage, /today's|24 hours|upgrade/i);

  // Provider busy: the AI service, explicitly not their limit.
  assert.match(p.title, /AI service is busy/);
  assert.match(p.chatMessage, SAYS_NOT_YOUR_LIMIT);
  assert.doesNotMatch(p.title + p.description + p.chatMessage, /today's|allowance|upgrade/i);
});

test("a provider failure is never presented as the user's limit and never offers an upgrade", async () => {
  for (const upstream of [429, 402, 401, 403, 400, 500, 502, 503]) {
    for (const body of [coachBody(), { intent: "coach_tip" }]) {
      const { res, json } = await ai(body, { spy: provider({ status: upstream }) });
      for (const native of [false, true]) {
        const d = describe(res, json, native);
        assert.notEqual(d.kind, "daily_limit", `provider ${upstream}`);
        assert.equal(d.offerUpgrade, false, `provider ${upstream}: no upgrade prompt`);
        assert.doesNotMatch(`${d.title} ${d.description} ${d.chatMessage}`, /upgrade/i);
        assert.doesNotMatch(`${d.title} ${d.chatMessage}`, SAYS_USER_LIMIT, `provider ${upstream}`);
      }
    }
  }
});

test("upgrade prompt: only for the user's own allowance, and never in the native app", async () => {
  const cases = {
    allowance: await ai(coachBody(), { db: fakeDb({ budgetOk: false }) }),
    rate: await ai(coachBody(), { db: fakeDb({ rateCount: 99 }) }),
    busy: await ai(coachBody(), { spy: provider({ status: 429 }) }),
    down: await ai(coachBody(), { spy: provider({ status: 500 }) }),
  };
  const offer = (k, native) => describe(cases[k].res, cases[k].json, native).offerUpgrade;
  assert.equal(offer("allowance", false), true, "website: the allowance may offer an upgrade");
  for (const k of ["rate", "busy", "down"]) assert.equal(offer(k, false), false, k);
  for (const k of Object.keys(cases)) {
    const d = describe(cases[k].res, cases[k].json, true);
    assert.equal(d.offerUpgrade, false, `native app, ${k}`);
    assert.doesNotMatch(`${d.title} ${d.description} ${d.chatMessage}`, /upgrade|subscribe|\$\d|paywall|pricing/i, `native app, ${k}`);
  }
});

test("a bare 429 without a code is NOT assumed to be the user's limit", () => {
  const { describeAIRefusal } = refusal();
  // The exact bodies the old server sent.
  const oldProvider = describeAIRefusal(429, { error: "Rate limit reached. Try again in a moment." }, { native: false });
  assert.equal(oldProvider.kind, "provider_busy");
  assert.equal(oldProvider.offerUpgrade, false);
  const oldRate = describeAIRefusal(429, { error: "rate_limited", retry_after_seconds: 37 }, { native: false });
  assert.equal(oldRate.kind, "rate_limited");
  assert.equal(oldRate.description, "Wait 37 seconds and try again.");
  const oldAllowance = describeAIRefusal(429, { error: "Daily AI limit reached. It resets in 24 hours." }, { native: false });
  assert.equal(oldAllowance.kind, "daily_limit");
  // Nothing at all in the body (a proxy's 429): neutral, no upsell.
  for (const body of [null, {}, "nope", { error: 42 }]) {
    const d = describeAIRefusal(429, body, { native: false });
    assert.equal(d.kind, "provider_busy");
    assert.equal(d.offerUpgrade, false);
  }
});

test("the status never decides: the same status gives different messages for different codes", () => {
  const { describeAIRefusal } = refusal();
  const kinds = ["daily_limit", "rate_limited", "ai_provider_busy", "ai_provider_unavailable"].map(
    (code) => describeAIRefusal(429, { code }, { native: false }).kind,
  );
  assert.deepEqual(kinds, ["daily_limit", "rate_limited", "provider_busy", "provider_unavailable"]);
  // And a daily_limit code is honoured whatever the status.
  assert.equal(describeAIRefusal(503, { code: "daily_limit" }, { native: false }).kind, "daily_limit");
  // Retry-After header is used when the body has no figure; wording handles 1.
  const one = describeAIRefusal(429, { code: "rate_limited" }, { native: false, retryAfterHeader: "1" });
  assert.equal(one.description, "Wait 1 second and try again.");
  const none = describeAIRefusal(429, { code: "rate_limited" }, { native: false });
  assert.equal(none.description, "Wait a moment and try again.");
  // Other refusals keep the server's own message and never upsell.
  const other = describeAIRefusal(403, { error: "AI features are off.", code: "ai_consent_required" }, { native: false });
  assert.deepEqual([other.kind, other.serverMessage, other.offerUpgrade], ["other", "AI features are off.", false]);
});

// ---- 3. what the user actually sees (toast) ---------------------------------

function toastHarness({ native }) {
  const toasts = [];
  const location = { href: "/companion" };
  const load = makeLoader(
    {
      sonner: { toast: { error: (title, opts) => toasts.push({ title, opts: opts ?? {} }) } },
      "@/lib/native-app": { isNativeApp: () => native },
    },
    { window: { location } },
  );
  const client = load("src/lib/ai/refusal-client.ts");
  return { toasts, location, client };
}

async function toastFor(caseResult, native) {
  const h = toastHarness({ native });
  const res = new Response(JSON.stringify(caseResult.json), {
    status: caseResult.res.status,
    headers: caseResult.res.headers,
  });
  const r = await h.client.readAIRefusal(res);
  h.client.toastAIRefusal(r, "Companion is unavailable");
  return { ...h, refusal: r, toast: h.toasts[0] };
}

test("toast: the allowance shows an Upgrade action on the website and none in the app", async () => {
  const allowance = await ai(coachBody(), { db: fakeDb({ budgetOk: false }) });
  const web = await toastFor(allowance, false);
  assert.equal(web.toasts.length, 1);
  assert.equal(web.toast.opts.action.label, "Upgrade");
  web.toast.opts.action.onClick();
  assert.equal(web.location.href, "/paywall");
  assert.doesNotMatch(web.toast.title + web.toast.opts.description, /today's|unlimited/i);

  const app = await toastFor(allowance, true);
  assert.equal(app.toasts.length, 1);
  assert.equal(app.toast.opts.action, undefined, "no purchase prompt inside the app");
  assert.doesNotMatch(app.toast.title + app.toast.opts.description, /upgrade/i);
  assert.equal(app.location.href, "/companion");
});

test("toast: provider busy / unavailable and rate limit never show an Upgrade action", async () => {
  const cases = [
    await ai(coachBody(), { spy: provider({ status: 429 }) }),
    await ai(coachBody(), { spy: provider({ status: 402 }) }),
    await ai(coachBody(), { spy: provider({ status: 500 }) }),
    await ai(coachBody(), { db: fakeDb({ rateCount: 50 }) }),
  ];
  for (const c of cases) {
    for (const native of [false, true]) {
      const t = await toastFor(c, native);
      assert.equal(t.toasts.length, 1);
      assert.equal(t.toast.opts.action, undefined, `${c.json.code} native=${native}`);
      assert.doesNotMatch(`${t.toast.title} ${t.toast.opts.description}`, /upgrade|today's AI limit|daily AI limit/i);
    }
  }
});

test("toast: the app never shows Upgrade even if a refusal claims offerUpgrade", () => {
  const h = toastHarness({ native: true });
  const forged = refusal().describeAIRefusal(429, { code: "daily_limit" }, { native: false });
  assert.equal(forged.offerUpgrade, true);
  h.client.toastAIRefusal(forged, "x");
  assert.equal(h.toasts[0].opts.action, undefined);
});

// ---- 4. the three chat surfaces use the one helper --------------------------

test("companion, pilot and coach choose the message by code through the shared helper", () => {
  for (const f of ["companion", "pilot", "coach"]) {
    const src = read(`src/routes/${f}.tsx`);
    assert.match(src, /import \{ readAIRefusal, toastAIRefusal \} from "@\/lib\/ai\/refusal-client";/, f);
    assert.match(src, /toastAIRefusal\(/, f);
    assert.doesNotMatch(src, /\.status === 429/, `${f}: no message chosen by HTTP status`);
    assert.doesNotMatch(src, /today's (free )?AI limit|Daily AI limit|unlimited conversations/i, f);
    assert.doesNotMatch(
      src,
      /window\.location\.href = "\/paywall"/,
      `${f}: the only AI-limit upgrade action is in the shared helper`,
    );
  }
  // The Companion's in-conversation line comes from the same helper.
  assert.match(read("src/routes/companion.tsx"), /: refusal\.chatMessage \|\|/);
  // No copy anywhere promises a fixed reset.
  for (const f of ["src/lib/ai/log.server.ts", "src/lib/realtime/useOpenAIRealtime.ts", "src/lib/realtime/session-cost.server.ts"]) {
    assert.doesNotMatch(read(f), /resets in 24 hours/i, f);
  }
});

// ---- 5. a failed request does not debit the allowance -----------------------

test("positive control: a successful Companion turn debits exactly what the provider reported", async () => {
  const { res, db, text } = await ai(coachBody(), {
    spy: provider({ usage: { prompt_tokens: 900, completion_tokens: 60 } }),
  });
  assert.equal(res.status, 200);
  assert.match(text, /Nap at 3 pm\./);
  assert.deepEqual(
    db.aiLog.map((r) => [r.intent, r.status, r.prompt_tokens, r.completion_tokens]),
    [["coach", "ok", 900, 60]],
  );
  assert.equal(db.debited, 960);
});

for (const [label, spyOpts] of [
  ["provider rate limit (429)", { status: 429 }],
  ["provider credits (402)", { status: 402 }],
  ["provider outage (500)", { status: 500 }],
  ["provider unreachable", { network: true }],
]) {
  for (const body of [coachBody(), { intent: "coach_tip" }, { intent: "brief", plan: "Sleep at 9am." }]) {
    test(`no debit: ${label}, intent ${body.intent}`, async () => {
      const { res, db } = await ai(body, { spy: provider(spyOpts) });
      assert.notEqual(res.status, 200);
      assert.equal(db.debited, 0, "a request with no AI output costs the user nothing");
      // The failure is still recorded, with zero tokens, for the owner.
      assert.deepEqual(db.aiLog.map((r) => [r.status, r.prompt_tokens, r.completion_tokens]), [["error", 0, 0]]);
    });
  }
}

/** Run a coach stream; `cancelAfterFirstChunk` is a browser that gives up part way. */
async function coachStream(spyOpts, { cancelAfterFirstChunk = false, body = coachBody() } = {}) {
  const db = fakeDb();
  const spy = provider(spyOpts);
  const h = loadRoute("ai", { db, spy });
  const res = await h.post({ request: jsonRequest(body) });
  let text = "";
  if (cancelAfterFirstChunk) {
    const reader = res.body.getReader();
    const first = await reader.read();
    text = new TextDecoder().decode(first.value);
    await reader.cancel();
  } else {
    text = await drain(res).catch(() => "");
  }
  await new Promise((r) => setTimeout(r, 120));
  return { res, db, spy, text };
}

const rows = (db) => db.aiLog.map((r) => [r.intent, r.status, r.prompt_tokens, r.completion_tokens]);

test("free-usage gap closed: the provider stream breaks AFTER text was delivered -> one estimated debit", async () => {
  const { text, db, spy } = await coachStream({ breakStream: true });
  assert.match(text, /Nap at 3 pm\./, "the answer reached the browser");
  assert.equal(db.aiLog.length, 1, "exactly one usage row");
  const promptChars = JSON.parse(spy.calls[0].body).messages.reduce((n, m) => n + m.content.length, 0);
  assert.deepEqual(rows(db), [
    ["coach", "ok", Math.ceil(promptChars / 4), Math.ceil("Nap at 3 pm.".length / 4)],
  ]);
  assert.ok(db.debited > 0);
});

test("free-usage gap closed: the client cancels after partial text -> one estimated debit", async () => {
  const { text, db, spy } = await coachStream(
    { gapMs: 60, usage: null },
    { cancelAfterFirstChunk: true },
  );
  assert.match(text, /Nap at 3 pm\./);
  assert.equal(db.aiLog.length, 1, "exactly one usage row, not zero and not two");
  const promptChars = JSON.parse(spy.calls[0].body).messages.reduce((n, m) => n + m.content.length, 0);
  const [r] = db.aiLog;
  assert.equal(r.prompt_tokens, Math.ceil(promptChars / 4));
  assert.ok(r.completion_tokens >= Math.ceil("Nap at 3 pm.".length / 4));
  assert.ok(db.debited > 0);
});

test("no debit: the provider fails before ANY text was delivered", async () => {
  const { text, db } = await coachStream({ breakBeforeText: true });
  assert.doesNotMatch(text, /Nap at 3 pm/);
  assert.equal(db.debited, 0);
  assert.deepEqual(db.aiLog, []);
});

test("normal completion with a usage frame debits the provider's numbers, once", async () => {
  const { db } = await coachStream({ usage: { prompt_tokens: 1234, completion_tokens: 56 } });
  assert.deepEqual(rows(db), [["coach", "ok", 1234, 56]]);
});

test("normal completion WITHOUT a usage frame debits an estimate, never 0", async () => {
  const { db, spy } = await coachStream({ usage: null });
  const promptChars = JSON.parse(spy.calls[0].body).messages.reduce((n, m) => n + m.content.length, 0);
  assert.deepEqual(rows(db), [
    ["coach", "ok", Math.ceil(promptChars / 4), Math.ceil("Nap at 3 pm. Then stay dark.".length / 4)],
  ]);
  assert.ok(db.debited > 0);
});

test("an all-zero usage frame is not trusted: the turn is estimated, not logged as 0", async () => {
  const { db } = await coachStream({ usage: { prompt_tokens: 0, completion_tokens: 0 } });
  assert.ok(db.debited > 0);
});

test("the streaming request asks the provider for usage; non-stream requests are unchanged", async () => {
  const stream = await coachStream({});
  assert.deepEqual(JSON.parse(stream.spy.calls[0].body).stream_options, { include_usage: true });
  const { spy } = await ai({ intent: "coach_tip" }, { spy: provider() });
  const json = JSON.parse(spy.calls[0].body);
  assert.equal(json.stream, undefined);
  assert.equal(json.stream_options, undefined);
});

test("no debit: refused requests (rate limit, allowance used up) write nothing", async () => {
  for (const db of [fakeDb({ rateCount: 21 }), fakeDb({ budgetOk: false })]) {
    const spy = provider();
    const { res } = await ai(coachBody(), { db, spy });
    assert.equal(res.status, 429);
    assert.deepEqual(db.aiLog, []);
    assert.deepEqual(spy.calls, []);
  }
});

for (const [file, makeReq] of [
  ["tts", () => jsonRequest({ text: "Good morning." }, "/api/tts")],
  ["tts-elevenlabs", () => jsonRequest({ text: "Good morning." }, "/api/tts-elevenlabs")],
  ["stt", sttRequest],
  ["insights", () => jsonRequest({ context: "Night shift tonight." }, "/api/insights")],
  ["swap", () => jsonRequest({ context: "Extra shift Saturday." }, "/api/swap")],
]) {
  test(`no debit: /api/${file} when the provider fails; a debit only when it answers`, async () => {
    for (const spyOpts of [{ status: 429 }, { status: 500 }, { network: true }]) {
      const db = fakeDb();
      const h = loadRoute(file, { db, spy: provider(spyOpts) });
      const res = await h.post({ request: makeReq() });
      await res.text().catch(() => "");
      assert.equal(db.debited, 0, `${file} ${JSON.stringify(spyOpts)}`);
    }
    // Positive control: the same request debits when the provider answers.
    const db = fakeDb();
    const h = loadRoute(file, { db, spy: provider() });
    const ok = await h.post({ request: makeReq() });
    await ok.arrayBuffer().catch(() => null);
    assert.equal(ok.status, 200);
    assert.ok(db.debited > 0, `${file}: a served request is still counted`);
  });
}

// ---- 6. ai_provider_error has its own truthful wording ----------------------

test("ai_provider_error: not 'try again shortly', not your limit, no upgrade", () => {
  const body = { error: "x", code: "ai_provider_error", retryable: false };
  for (const native of [false, true]) {
    const r = refusal().describeAIRefusal(502, body, { native });
    assert.equal(r.kind, "request_rejected");
    assert.equal(r.offerUpgrade, false);
    assert.match(r.chatMessage, /couldn't handle that request/);
    assert.match(r.chatMessage, /isn't your limit/);
    assert.match(r.chatMessage + r.description, /rephras|shorten/i);
    assert.doesNotMatch(r.chatMessage + r.title + r.description, /try again shortly|upgrade|allowance/i);
  }
  const unavailable = refusal().describeAIRefusal(503, { code: "ai_provider_unavailable" }, { native: false });
  assert.equal(unavailable.kind, "provider_unavailable");
});

test("a provider 4xx on /api/ai reaches the user as request_rejected end to end", async () => {
  const { res, json } = await ai(coachBody(), { spy: provider({ status: 400 }) });
  assert.equal(res.status, 502);
  assert.equal(describe(res, json).kind, "request_rejected");
});

// ---- 7. voice brief / tts show the real reason ------------------------------

test("voice surfaces never show the raw 'rate_limited'", async () => {
  const h = toastHarness({ native: false });
  const text = h.client.aiRefusalTextFromBody(429, { error: "rate_limited", code: "rate_limited", retry_after_seconds: 12 }, "fallback");
  assert.doesNotMatch(text, /rate_limited/);
  assert.match(text, /too quickly/);
  assert.match(text, /12 seconds/);
  // Old server (no code) still gets the right words.
  assert.doesNotMatch(h.client.aiRefusalTextFromBody(429, { error: "rate_limited" }, "fallback"), /rate_limited/);
  // Unknown refusals keep the server's own words, then the fallback.
  assert.equal(h.client.aiRefusalTextFromBody(200, { message: "Voice is off." }, "fallback"), "Voice is off.");
  assert.equal(h.client.aiRefusalTextFromBody(500, null, "fallback"), "fallback");
  // The two surfaces use the helper rather than the raw string.
  for (const f of ["src/components/VoicePlayer.tsx", "src/lib/voice/useTtsPlayer.ts"]) {
    assert.match(read(f), /aiRefusalTextFromBody\(/, f);
    assert.doesNotMatch(read(f), /msg = j\.error|toast\.info\(briefData\.error \|\|/, f);
  }
});

// ---- 8. the Companion's object context never becomes "[object Object]" ------

test("system prompt never contains [object Object]; useful context fields survive", async () => {
  const ctxMod = makeLoader({
    "./memory-rank.server": { fetchRankedMemories: async () => [] },
    "./guardrails": { SAFETY_AND_CARE: "SAFE" },
    "./patterns.server": { fetchActivePatterns: async () => [] },
  })("src/lib/ai/context.server.ts");
  const f = ctxMod.formatLiveContext;
  const companion = { surface: "companion", companion_name: "Amber", max_tokens: 180 };
  assert.doesNotMatch(f(companion), /\[object Object\]/);
  assert.match(f(companion), /companion name: Amber/);
  assert.doesNotMatch(f(companion), /max_tokens|surface/);
  assert.equal(f({ surface: "companion", max_tokens: 180 }), "", "nothing useful: no line");
  assert.equal(f({ nested: { a: 1 } }), "");
  assert.equal(f("night shift tonight"), "night shift tonight");
  assert.equal(f(undefined), "");
});

test("/api/ai passes the Companion's object context to the real prompt builder as text", async () => {
  const seen = [];
  const db = fakeDb();
  const spy = provider();
  const h = loadRoute("ai", {
    db,
    spy,
    stubs: {
      "@/lib/ai/context.server": {
        DEFAULT_ASSISTANT_PROFILE: { language: "en-US", accent: null, memoryEnabled: false },
        loadAssistantProfile: async () => ({ language: "en-US", accent: null, memoryEnabled: false }),
        buildSystemPrompt: async (o) => {
          seen.push(o.liveContext);
          return "system";
        },
      },
    },
  });
  const res = await h.post({
    request: jsonRequest(coachBody("hi", { context: { surface: "companion", companion_name: "Amber", max_tokens: 180 } })),
  });
  await drain(res);
  assert.equal(res.status, 200);
  assert.equal(typeof seen[0], "object", "the route forwards what the client sent; the builder formats it");
  // The companion's 180-token cap comes from surface:"voice" (not the context) and still applies.
  assert.equal(JSON.parse(spy.calls[0].body).max_tokens, 180);
});
