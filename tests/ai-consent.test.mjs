// App Store Review Guideline 5.1.2(i): RestPilot must get explicit permission
// before sharing personal data with third-party AI. These tests run the real
// AI route handlers (and the real consent gate, gateway and logging code) with
// Supabase, auth and rate limiting replaced, and `fetch` replaced by a spy, to
// prove:
//   - no permission  -> the route refuses (403, ai_consent_required) and no
//     request reaches any AI provider;
//   - permission     -> the route works and the provider is called;
//   - revoked        -> refused again;
//   - unreadable     -> refused (fail closed), provider not called.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const ROOT = new URL("../", import.meta.url);
const read = (p) => readFileSync(new URL(p, ROOT), "utf8");
const USER = "11111111-1111-4111-8111-111111111111";

// ---- tiny CommonJS loader for the app's TypeScript ------------------------
function resolve(spec, fromRel) {
  let base;
  if (spec.startsWith("@/")) base = "src/" + spec.slice(2);
  else if (spec.startsWith("./") || spec.startsWith("../")) {
    base = new URL(spec, new URL(fromRel, ROOT)).pathname.slice(ROOT.pathname.length);
  } else return null;
  for (const ext of [".ts", ".tsx", "/index.ts"]) {
    if (existsSync(new URL(base + ext, ROOT))) return base + ext;
  }
  throw new Error(`cannot resolve ${spec} from ${fromRel}`);
}

function makeLoader(stubs, globals) {
  const cache = new Map();
  function load(rel) {
    if (cache.has(rel)) return cache.get(rel).exports;
    const js = ts.transpileModule(read(rel), {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.CommonJS,
        esModuleInterop: true,
        jsx: ts.JsxEmit.ReactJSX,
      },
    }).outputText;
    const module = { exports: {} };
    cache.set(rel, module);
    const req = (spec) => {
      if (spec in stubs) return stubs[spec];
      const target = resolve(spec, rel);
      if (!target) throw new Error(`unexpected import "${spec}" in ${rel}`);
      return load(target);
    };
    vm.runInNewContext(js, {
      module,
      exports: module.exports,
      require: req,
      console: { log() {}, info() {}, warn() {}, error() {} },
      ...globals,
    });
    return module.exports;
  }
  return load;
}

// ---- fakes ----------------------------------------------------------------
function fakeDb({ consent, readError = false } = {}) {
  const tables = [];
  const inserts = [];
  const logRows = [];
  const db = {
    tables,
    inserts,
    logRows,
    now: null,
    auth: {
      async getUser() {
        return { data: { user: { id: USER } }, error: null };
      },
    },
    async rpc(fn) {
      if (fn === "claim_voice_session") return { data: "ok", error: null };
      if (fn === "end_voice_session") return { data: 0, error: null };
      return { data: true, error: null };
    },
    from(table) {
      tables.push(table);
      const filters = { user: null, like: null };
      const q = {
        select() {
          return q;
        },
        gte() {
          return q;
        },
        like(_col, pat) {
          filters.like = new RegExp(
            "^" + String(pat).replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*") + "$",
          );
          return q;
        },
        // Only ai_log reads are awaited directly (the voice session ledger).
        then(resolve, reject) {
          const rows =
            table === "ai_log"
              ? logRows.filter(
                  (r) =>
                    (!filters.user || r.user_id === filters.user) &&
                    (!filters.like || filters.like.test(r.intent)),
                )
              : [];
          return Promise.resolve({ data: rows, error: null }).then(resolve, reject);
        },
        eq(col, v) {
          if (col === "user_id") filters.user = v;
          return q;
        },
        in() {
          return q;
        },
        order() {
          return q;
        },
        limit() {
          return q;
        },
        async insert(row) {
          inserts.push({ table, row });
          if (table === "ai_log") {
            logRows.push({
              ...row,
              created_at: new Date(db.now ? db.now() : Date.now()).toISOString(),
            });
          }
          return { error: null };
        },
        async maybeSingle() {
          if (table === "user_prefs") {
            if (readError) return { data: null, error: { message: "db down" } };
            return { data: consent === undefined ? null : { consent_json: consent }, error: null };
          }
          return { data: null, error: null };
        },
      };
      return q;
    },
  };
  return db;
}

function upstreamSpy() {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push(String(url));
    const u = String(url);
    if (u.includes("/audio/speech") || u.includes("elevenlabs")) {
      return new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: { "content-type": "audio/mpeg" },
      });
    }
    if (u.includes("/audio/transcriptions")) return Response.json({ text: "hello there" });
    return Response.json({
      choices: [{ message: { content: JSON.stringify({ ok: true, tip: "Rest." }) } }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    });
  };
  return { calls, fetch };
}

function loadRoute(file, db, spy) {
  const stubs = {
    "@tanstack/react-router": { createFileRoute: () => (cfg) => cfg },
    "@supabase/supabase-js": { createClient: () => db },
    "@/lib/api/auth.server": { requireUser: async () => ({ userId: USER }) },
    "@/lib/api/ratelimit.server": {
      enforceRateLimit: async () => null,
      RATE_LIMITS: { ai: {}, tts: {}, stt: {} },
    },
    "@/lib/ops/alert.server": { notifyOwnerAsync() {} },
    "@/lib/ai/memory-extractor.server": { extractAndStoreMemories: async () => {} },
    "@/lib/ai/recommendations.server": { persistRecommendation: async () => null },
    "@/lib/ai/intent-hint.server": { classifyIntent: () => null },
    "@/lib/api/lab-gate.server": { requireLabAccess: async () => null },
    "@/lib/ai/context.server": {
      DEFAULT_ASSISTANT_PROFILE: { language: "en-US", accent: null, memoryEnabled: false },
      loadAssistantProfile: async () => ({ language: "en-US", accent: null, memoryEnabled: false }),
      buildSystemPrompt: async () => "system",
    },
  };
  const env = {
    SUPABASE_URL: "https://example.supabase.test",
    SUPABASE_SERVICE_ROLE_KEY: "service-role-example",
    LOVABLE_API_KEY: "lovable-example",
    ELEVENLABS_API_KEY: "eleven-example",
    SIMLI_API_KEY: "simli-example",
  };
  const globals = {
    process: { env },
    fetch: spy.fetch,
    Response,
    Headers,
    Request,
    URL,
    URLSearchParams,
    FormData,
    Blob,
    TextEncoder,
    TextDecoder,
    ReadableStream,
    TransformStream,
    AbortController,
    setTimeout,
    clearTimeout,
    Promise,
    Date,
    Math,
    JSON,
  };
  const mod = makeLoader(stubs, globals)(`src/routes/api/${file}.ts`);
  return mod.Route.server.handlers.POST;
}

const json = (body) =>
  new Request("https://restpilotai.com/api/x", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer user-token" },
    body: JSON.stringify(body),
  });

function sttRequest() {
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array([1, 2, 3, 4])], { type: "audio/wav" }), "a.wav");
  return new Request("https://restpilotai.com/api/stt", {
    method: "POST",
    headers: { authorization: "Bearer user-token" },
    body: form,
  });
}

// Every route that sends user data to a third-party AI provider.
const ROUTES = [
  [
    "ai (coach chat)",
    "ai",
    () => json({ intent: "coach", messages: [{ role: "user", content: "I slept 4 hours" }] }),
  ],
  ["ai (brief intent)", "ai", () => json({ intent: "brief", plan: "Sleep at 9am." })],
  ["ai (coach_tip intent)", "ai", () => json({ intent: "coach_tip", context: "night shift" })],
  ["brief", "brief", () => json({ plan: "Sleep at 9am." })],
  ["insights", "insights", () => json({ context: "Night shift tonight." })],
  ["swap", "swap", () => json({ context: "Extra shift Saturday." })],
  ["stt (voice transcription)", "stt", sttRequest],
  ["tts (OpenAI voice)", "tts", () => json({ text: "Good morning." })],
  ["tts-elevenlabs", "tts-elevenlabs", () => json({ text: "Good morning." })],
  ["lab: Simli speak (staff only)", "lab/simli/speak", () => json({ text: "Hello." })],
  ["lab: Simli session (staff only)", "lab/simli/session", () => json({ faceId: "face-example" })],
];

// ---- the stored permission --------------------------------------------------
const consentLoad = () => makeLoader({}, {})("src/lib/ai/consent.ts");

test("hasAIConsent: only a grant for the current version counts", () => {
  const c = consentLoad();
  const now = "2026-11-15T10:00:00.000Z";
  assert.equal(c.hasAIConsent(undefined), false);
  assert.equal(c.hasAIConsent(null), false);
  assert.equal(c.hasAIConsent({}), false);
  assert.equal(c.hasAIConsent([]), false);
  assert.equal(
    c.hasAIConsent({ terms: "2026-06-27", onboarding_ack: now }),
    false,
    "older acknowledgements are not AI consent",
  );
  assert.equal(
    c.hasAIConsent({ ai_data_sharing: true }),
    false,
    "a bare true is not a versioned grant",
  );
  assert.equal(
    c.hasAIConsent({ ai_data_sharing: "2026-01-01" }),
    false,
    "an older version must be asked again",
  );
  const granted = { terms: "2026-06-27", ...c.aiConsentGrantPatch(now) };
  assert.equal(c.hasAIConsent(granted), true);
  assert.equal(c.aiConsentGrantedAt(granted), now);
  const revoked = { ...granted, ...c.aiConsentRevokePatch("2026-11-16T00:00:00.000Z") };
  assert.equal(c.hasAIConsent(revoked), false);
  assert.equal(c.aiConsentGrantedAt(revoked), null);
  assert.equal(revoked.terms, "2026-06-27", "revoking keeps the other consent flags");
});

test("the consent screen names every provider and links the privacy policy", () => {
  const c = consentLoad();
  const names = c.AI_CONSENT_PROVIDERS.map((p) => p.name).join(" | ");
  for (const n of ["Google Gemini", "Lovable AI Gateway", "OpenAI", "ElevenLabs"])
    assert.match(names, new RegExp(n));
  const dialog = read("src/components/ai/AIConsentDialog.tsx");
  assert.match(dialog, /to="\/legal\/privacy"/);
  assert.match(dialog, />\s*Allow\s*|"Allow"/);
  assert.match(dialog, /Not now/);
  const policy = read("src/routes/legal.privacy.tsx");
  assert.match(policy, /id="ai-providers"/);
  for (const n of ["Google Gemini", "Lovable AI Gateway", "OpenAI", "ElevenLabs"])
    assert.match(policy, new RegExp(n));
  const subprocessors = read("src/routes/legal.third-parties.tsx");
  assert.match(subprocessors, /ElevenLabs/);
});

// ---- server enforcement, route by route ------------------------------------
for (const [label, file, makeReq] of ROUTES) {
  test(`${label}: no permission -> 403 ai_consent_required and no AI provider call`, async () => {
    const c = consentLoad();
    for (const consent of [
      undefined,
      {},
      { terms: "2026-06-27" },
      { ai_data_sharing: "2025-01-01" },
    ]) {
      const db = fakeDb({ consent });
      const spy = upstreamSpy();
      const res = await loadRoute(file, db, spy)({ request: makeReq() });
      assert.equal(res.status, 403, JSON.stringify(consent));
      assert.equal(res.headers.get("x-restpilot-ai-consent"), "required");
      const body = await res.json();
      assert.equal(body.code, "ai_consent_required");
      assert.equal(body.error, c.AI_CONSENT_REQUIRED_MESSAGE);
      assert.deepEqual(spy.calls, [], "nothing was sent to any provider");
    }
  });

  test(`${label}: permission given -> works and calls the provider`, async () => {
    const c = consentLoad();
    const db = fakeDb({ consent: c.aiConsentGrantPatch("2026-11-15T10:00:00.000Z") });
    const spy = upstreamSpy();
    const res = await loadRoute(file, db, spy)({ request: makeReq() });
    assert.equal(res.status, 200, await res.clone().text());
    assert.ok(spy.calls.length >= 1, "provider was called");
    assert.ok(
      spy.calls.every(
        (u) =>
          u.startsWith("https://ai.gateway.lovable.dev/") ||
          u.startsWith("https://api.elevenlabs.io/") ||
          u.startsWith("https://api.simli.ai/"),
      ),
      spy.calls.join(", "),
    );
    if (res.body) await res.body.cancel().catch(() => {});
  });

  test(`${label}: permission revoked -> refused again, no provider call`, async () => {
    const c = consentLoad();
    const consent = {
      ...c.aiConsentGrantPatch("2026-11-15T10:00:00.000Z"),
      ...c.aiConsentRevokePatch("2026-11-15T11:00:00.000Z"),
    };
    const spy = upstreamSpy();
    const res = await loadRoute(file, fakeDb({ consent }), spy)({ request: makeReq() });
    assert.equal(res.status, 403);
    assert.deepEqual(spy.calls, []);
  });

  test(`${label}: permission can't be read -> fails closed (503), no provider call`, async () => {
    const spy = upstreamSpy();
    const res = await loadRoute(file, fakeDb({ readError: true }), spy)({ request: makeReq() });
    assert.equal(res.status, 503);
    assert.equal((await res.json()).code, "ai_consent_unavailable");
    assert.deepEqual(spy.calls, []);
  });
}

test("the legacy /api/coach route only forwards to the gated /api/ai", () => {
  const src = read("src/routes/api/coach.ts");
  assert.match(src, /url\.pathname = "\/api\/ai"/);
  assert.match(src, /intent: "coach"/);
  for (const upstream of [
    "ai.gateway.lovable.dev",
    "api.openai.com",
    "elevenlabs",
    "chatJSON",
    "chatStream",
  ]) {
    assert.ok(!src.includes(upstream), `/api/coach must not call ${upstream} itself`);
  }
});

test("the gate runs before any prompt is built or provider is called in every AI route", () => {
  for (const file of [
    "ai",
    "brief",
    "insights",
    "swap",
    "stt",
    "tts",
    "tts-elevenlabs",
    "lab/simli/speak",
    "lab/simli/session",
  ]) {
    const src = read(`src/routes/api/${file}.ts`);
    const gate = src.indexOf("requireAIConsent(");
    assert.ok(gate > 0, `${file} calls requireAIConsent`);
    for (const upstream of [
      "ai.gateway.lovable.dev",
      "api.elevenlabs.io",
      "chatJSON(",
      "chatStream(",
    ]) {
      const at = src.indexOf(upstream, src.indexOf("handlers:"));
      if (at > 0) assert.ok(gate < at, `${file}: gate precedes ${upstream}`);
    }
  }
});

// ---- OpenAI Realtime (live voice) server function ---------------------------
function loadRealtime(db, spy) {
  const stubs = {
    "@tanstack/react-start": {
      createServerFn() {
        let v = (x) => x;
        const b = {
          middleware() {
            return b;
          },
          inputValidator(fn) {
            v = fn;
            return b;
          },
          handler(fn) {
            return (a) => fn({ ...a, data: v(a?.data) });
          },
        };
        return b;
      },
    },
    "@/integrations/supabase/auth-middleware": { requireSupabaseAuth: {} },
    "@/lib/realtime/trial-usage.functions": {
      loadTrialUsageState: async () => ({
        isTrial: false,
        limitReached: false,
        remainingSeconds: 0,
        capSeconds: 0,
      }),
    },
    "@/integrations/supabase/client.server": { supabaseAdmin: db },
    "@/lib/user/display-name.server": { loadPreferredNameServer: async () => "" },
    "@supabase/supabase-js": { createClient: () => db },
  };
  const globals = {
    process: {
      env: {
        OPENAI_API_KEY: "openai-example",
        ...(spy.voiceOff ? {} : { REALTIME_VOICE_ENABLED: "1" }),
        SUPABASE_URL: "https://example.supabase.test",
        SUPABASE_SERVICE_ROLE_KEY: "service-role-example",
      },
    },
    fetch: async (url, init) => {
      spy.calls.push(String(url));
      (spy.bodies ??= []).push(init?.body);
      if (spy.fail) return new Response("boom", { status: 500 });
      return Response.json({ value: "ek_example", expires_at: 1_900_000_000 });
    },
    Response,
    Headers,
    URL,
    Promise,
    Date,
    Math,
    JSON,
    Intl,
  };
  return makeLoader(stubs, globals)("src/lib/realtime/openai.functions.ts").mintRealtimeSession;
}

test("live voice: no session is minted at OpenAI without permission; minted with it; refused after revoke", async () => {
  const c = consentLoad();
  let spy = { calls: [] };
  await assert.rejects(
    loadRealtime(fakeDb({ consent: {} }), spy)({ data: {}, context: { userId: USER } }),
    /ai_consent_required/,
  );
  assert.deepEqual(spy.calls, []);

  spy = { calls: [] };
  const granted = c.aiConsentGrantPatch("2026-11-15T10:00:00.000Z");
  const out = await loadRealtime(
    fakeDb({ consent: granted }),
    spy,
  )({ data: {}, context: { userId: USER } });
  assert.equal(out.clientSecret, "ek_example");
  assert.deepEqual(spy.calls, ["https://api.openai.com/v1/realtime/client_secrets"]);

  spy = { calls: [] };
  const revoked = { ...granted, ...c.aiConsentRevokePatch("2026-11-15T11:00:00.000Z") };
  await assert.rejects(
    loadRealtime(fakeDb({ consent: revoked }), spy)({ data: {}, context: { userId: USER } }),
    /ai_consent_required/,
  );
  assert.deepEqual(spy.calls, []);
});

// ---- client: requests are not sent without permission ----------------------
test("every client call to an AI endpoint goes through aiFetch / ensureAIConsent", () => {
  const files = [
    "src/lib/ai-client.ts",
    "src/components/AIBriefCard.tsx",
    "src/components/VoicePlayer.tsx",
    "src/components/sleep/VoiceCommandButton.tsx",
    "src/components/voice/VoiceSettings.tsx",
    "src/lib/voice/useTtsPlayer.ts",
    "src/lib/companion/speak.ts",
    "src/routes/coach.tsx",
    "src/routes/companion.tsx",
    "src/routes/pilot.tsx",
    "src/routes/swap.tsx",
  ];
  const direct =
    /\bfetch\(\s*(?:["'`]\/api\/(?:ai|brief|insights|swap|stt|tts|tts-elevenlabs|coach)\b|endpoint\b)/;
  for (const f of files) {
    const src = read(f);
    assert.doesNotMatch(src, direct, `${f} calls an AI endpoint with plain fetch`);
    assert.match(src, /aiFetch(Background)?\(/, `${f} uses aiFetch`);
  }
  assert.match(
    read("src/lib/realtime/useOpenAIRealtime.ts"),
    /ensureAIConsent\(\{ interactive: true \}\)/,
  );
  assert.match(read("src/routes/__root.tsx"), /<AIConsentDialog \/>/);
  const rt = read("src/lib/realtime/useOpenAIRealtime.ts");
  assert.match(rt, /subscribeAIConsent\(/, "a revoke ends a live voice session");
  assert.match(rt, /status === "denied" && pcRef\.current\) void disconnect\(\)/);
  const ai = read("src/routes/api/ai.ts");
  assert.ok(
    ai.indexOf('(await checkAIConsent(userId, admin)) === "granted"') <
      ai.indexOf("await extractAndStoreMemories("),
    "memory extraction re-checks permission",
  );
  // consent-client stays free of server-function imports (type-only import).
  assert.match(
    read("src/lib/ai/consent-client.ts"),
    /^import type \{[^}]+\} from "\.\/consent\.functions";$/m,
  );
});

function loadClient({ status, answer }) {
  const sent = [];
  const setCalls = [];
  const opened = [];
  const toasts = [];
  let mod;
  const stubs = {
    react: { useSyncExternalStore: (_s, get) => get() },
    sonner: { toast: { message: (...a) => toasts.push(a), success() {}, error() {} } },
    "@/integrations/supabase/client": {
      supabase: {
        auth: {
          async getSession() {
            return { data: { session: { user: { id: USER }, access_token: "t" } } };
          },
          onAuthStateChange() {
            return { data: { subscription: { unsubscribe() {} } } };
          },
        },
      },
    },
  };
  const store = new Map();
  const globals = {
    window: {},
    sessionStorage: {
      getItem: (k) => store.get(k) ?? null,
      setItem: (k, v) => store.set(k, v),
      removeItem: (k) => store.delete(k),
    },
    fetch: async (url) => {
      sent.push(String(url));
      return Response.json({ ok: true });
    },
    Response,
    Headers,
    Promise,
    Date,
    JSON,
  };
  mod = makeLoader(stubs, globals)("src/lib/ai/consent-client.ts");
  // What <AIConsentDialog /> registers in the app.
  mod.registerAIConsentApi({
    get: async () => ({ granted: status.granted, grantedAt: null, version: "2026-11-15" }),
    set: async (data) => {
      setCalls.push(data);
      status.granted = data.allow;
      return { granted: data.allow, grantedAt: null, version: "2026-11-15" };
    },
  });
  // Simulate the user answering the dialog whenever it opens.
  let wasOpen = false;
  mod.subscribeAIConsent(() => {
    const s = mod.getAIConsentState();
    const justOpened = s.dialogOpen && !wasOpen;
    wasOpen = s.dialogOpen;
    if (justOpened) {
      opened.push(true);
      queueMicrotask(async () => {
        if (answer.allow) await mod.setAIConsent(true, "dialog");
        mod.resolveAIConsentDialog(answer.allow);
      });
    }
  });
  return { mod, sent, setCalls, opened, toasts, status, answer };
}

test("client: 'Not now' -> the request is never sent; 'Allow' -> sent; revoke in Settings -> stops", async () => {
  const h = loadClient({ status: { granted: false }, answer: { allow: false } });
  let res = await h.mod.aiFetch("/api/ai", { method: "POST" });
  assert.equal(res.status, 403);
  assert.equal(h.mod.isAIConsentRefusal(res), true);
  assert.deepEqual(h.sent, [], "declined: nothing sent");
  assert.equal(h.opened.length, 1, "the dialog was shown");

  // Background requests after "Not now" don't nag again this session.
  res = await h.mod.aiFetchBackground("/api/insights", { method: "POST" });
  assert.equal(res.status, 403);
  assert.equal(h.opened.length, 1);
  assert.deepEqual(h.sent, []);

  // Allow.
  h.answer.allow = true;
  res = await h.mod.aiFetch("/api/ai", { method: "POST" });
  assert.equal(res.status, 200);
  assert.deepEqual(h.sent, ["/api/ai"]);
  assert.equal(JSON.stringify(h.setCalls), JSON.stringify([{ allow: true, source: "dialog" }]));

  // One-time: no further prompts once allowed.
  await h.mod.aiFetchBackground("/api/insights", { method: "POST" });
  assert.equal(h.opened.length, 2);
  assert.deepEqual(h.sent, ["/api/ai", "/api/insights"]);

  // Revoke in Profile -> Privacy: requests stop (the user is asked again, says no).
  h.answer.allow = false;
  await h.mod.setAIConsent(false, "settings");
  assert.equal(
    JSON.stringify(h.setCalls.at(-1)),
    JSON.stringify({ allow: false, source: "settings" }),
  );
  res = await h.mod.aiFetchBackground("/api/insights", { method: "POST" });
  assert.equal(res.status, 403);
  assert.deepEqual(h.sent, ["/api/ai", "/api/insights"], "nothing new sent after revoke");
});

// ---- daily budget gate: fails closed, after consent and rate limit ----------
function budgetDb(rpcResult) {
  const db = fakeDb({ consent: consentLoad().aiConsentGrantPatch("2026-11-15T10:00:00.000Z") });
  db.rpc = async () => rpcResult;
  return db;
}
const coachReq = () =>
  json({ intent: "coach", messages: [{ role: "user", content: "I slept 4 hours" }] });

test("budget RPC error -> retryable 503 JSON and zero provider calls (fails closed)", async () => {
  const spy = upstreamSpy();
  const res = await loadRoute("ai", budgetDb({ data: null, error: { message: "rpc down" } }), spy)({
    request: coachReq(),
  });
  assert.equal(res.status, 503);
  assert.equal(res.headers.get("retry-after"), "10");
  const body = await res.json();
  assert.equal(body.code, "ai_budget_unavailable");
  assert.equal(body.retryable, true);
  assert.deepEqual(spy.calls, []);
});

test("budget under cap -> works; over cap -> 429, no provider call", async () => {
  const spy = upstreamSpy();
  const ok = await loadRoute("ai", budgetDb({ data: true, error: null }), spy)({ request: coachReq() });
  assert.equal(ok.status, 200);
  assert.ok(spy.calls.length >= 1);
  if (ok.body) await ok.body.cancel().catch(() => {});

  const spy2 = upstreamSpy();
  const over = await loadRoute("ai", budgetDb({ data: false, error: null }), spy2)({ request: coachReq() });
  assert.equal(over.status, 429);
  assert.deepEqual(spy2.calls, []);
});

test("consent is still checked before the budget (no consent + RPC error -> 403)", async () => {
  const db = fakeDb({ consent: undefined });
  db.rpc = async () => ({ data: null, error: { message: "rpc down" } });
  const spy = upstreamSpy();
  const res = await loadRoute("ai", db, spy)({ request: coachReq() });
  assert.equal(res.status, 403);
  assert.deepEqual(spy.calls, []);
});

test("the budget gate stays after consent and rate limit in api/ai.ts", () => {
  const src = read("src/routes/api/ai.ts");
  const consent = src.indexOf("requireAIConsent(");
  const limit = src.indexOf("enforceRateLimit(");
  const budget = src.indexOf("requireAIBudget(userId");
  assert.ok(consent > 0 && consent < limit && limit < budget);
});

test("upstream 402 is mapped to a user-safe message (no operator wording)", () => {
  const gw = makeLoader({}, {})("src/lib/ai/gateway.server.ts");
  assert.equal(gw.mapUpstreamError(402), "AI is temporarily unavailable. Please try again later.");
  for (const file of ["ai", "brief", "insights", "swap", "stt", "tts", "tts-elevenlabs"]) {
    const src = read(`src/routes/api/${file}.ts`) ;
    assert.ok(!/Settings > Workspace|credits (are )?exhausted|Add funds/i.test(src.replace(/"credits_exhausted"|STT upstream 402[^"]*/g, "")), `${file} leaks operator wording`);
  }
});

// ---- budget gate on the other AI routes (previously rate-limit only) --------
for (const [label, file, makeReq] of ROUTES.filter(([, f]) => f !== "ai")) {
  test(`${label}: budget RPC error -> retryable 503, zero provider calls`, async () => {
    const spy = upstreamSpy();
    const res = await loadRoute(file, budgetDb({ data: null, error: { message: "down" } }), spy)({
      request: makeReq(),
    });
    assert.equal(res.status, 503);
    assert.equal((await res.json()).code, "ai_budget_unavailable");
    assert.deepEqual(spy.calls, []);
  });
  test(`${label}: over daily cap -> 429, zero provider calls`, async () => {
    const spy = upstreamSpy();
    const res = await loadRoute(file, budgetDb({ data: false, error: null }), spy)({ request: makeReq() });
    assert.equal(res.status, 429);
    assert.deepEqual(spy.calls, []);
  });
  test(`${label}: no consent + budget RPC error -> consent refusal first (403)`, async () => {
    const db = fakeDb({ consent: undefined });
    db.rpc = async () => ({ data: null, error: { message: "down" } });
    const spy = upstreamSpy();
    const res = await loadRoute(file, db, spy)({ request: makeReq() });
    assert.equal(res.status, 403);
    assert.deepEqual(spy.calls, []);
  });
  test(`${label}: gate order is consent, rate limit (if any), budget, provider`, () => {
    const src = read(`src/routes/api/${file}.ts`);
    const at = (n) => src.indexOf(n);
    const h = at("handlers:");
    assert.ok(at("requireAIConsent(") < at("requireAIBudget("));
    if (at("enforceRateLimit(") > 0) assert.ok(at("enforceRateLimit(") < at("requireAIBudget("));
    const providers = ["chatJSON({", "ai.gateway.lovable.dev", "api.elevenlabs.io", "api.simli.ai"]
      .map((n) => src.indexOf(n, h))
      .filter((i) => i > 0);
    assert.ok(providers.length > 0);
    assert.ok(at("requireAIBudget(") < Math.min(...providers));
  });
}

// ---- every code path that can reach a paid provider is budget-gated ----------
import { readdirSync, statSync } from "node:fs";
const PROVIDER_RE =
  /ai\.gateway\.lovable\.dev|api\.openai\.com\/v1|api\.elevenlabs\.io\/v1|api\.simli\.ai\/|generativelanguage\.googleapis|api\.anthropic\.com|\bchatJSON\(|\bchatStream\(/;
// Not entrypoints: the shared gateway library (every caller is gated), the
// memory extractor (only called from the gated /api/ai), and the browser
// client that uses an already-minted, gated ephemeral token. The local crisis
// card and crisis guardrail make no provider call at all.
const BUDGET_ALLOW = new Set([
  "src/lib/ai/gateway.server.ts",
  "src/lib/ai/memory-extractor.server.ts",
  "src/lib/realtime/useOpenAIRealtime.ts",
]);
function walk(dir, out = []) {
  for (const n of readdirSync(new URL(dir + "/", ROOT))) {
    const rel = `${dir}/${n}`;
    if (statSync(new URL(rel, ROOT)).isDirectory()) walk(rel, out);
    else if (/\.(ts|tsx)$/.test(n)) out.push(rel);
  }
  return out;
}
// Comments and string-only mentions must not satisfy the check.
const stripComments = (src) =>
  src.replace(/(^|[^:"'`\\])\/\/[^\n]*/g, "$1").replace(/\/\*[\s\S]*?\*\//g, "");
test("every route/server function that can call a paid provider awaits requireAIBudget and records usage", () => {
  const noGate = [];
  const noUsage = [];
  let seen = 0;
  for (const rel of [...walk("src/routes"), ...walk("src/lib")]) {
    if (BUDGET_ALLOW.has(rel)) continue;
    const src = stripComments(read(rel));
    if (!PROVIDER_RE.test(src)) continue;
    if (!/\bfetch\(|chatJSON\(|chatStream\(/.test(src)) continue;
    seen++;
    if (!/\bawait\s+requireAIBudget\(/.test(src)) noGate.push(rel);
    // The cap sums ai_log, so every paid route must write usage.
    if (!/\b(await\s+)?(recordAIUsage|logAIRequest|startRealtimeSession)\(/.test(src)) noUsage.push(rel);
  }
  assert.ok(seen >= 8, `expected to find the provider routes, saw ${seen}`);
  assert.deepEqual(noGate, [], "provider-calling code without an awaited budget gate");
  assert.deepEqual(noUsage, [], "provider-calling code that never records usage");
});

test("the scan ignores comments (a commented-out gate does not count)", () => {
  assert.equal(/\bawait\s+requireAIBudget\(/.test(stripComments("// await requireAIBudget(x)\n/* await requireAIBudget(y) */")), false);
  assert.equal(/\bawait\s+requireAIBudget\(/.test(stripComments("const o = await requireAIBudget(u);")), true);
});

test("live voice session minting is budget-gated after consent and before OpenAI", () => {
  const src = read("src/lib/realtime/openai.functions.ts");
  const at = (n) => src.indexOf(n);
  assert.ok(at("assertAIConsent(") < at("requireAIBudget(") && at("requireAIBudget(") < at("api.openai.com"));
});

// ---- checkAIBudget hardening: throw / hang / malformed => unavailable -------
function budgetModule(fakeSetTimeout) {
  const timers = [];
  const load = makeLoader(
    { "@supabase/supabase-js": { createClient: () => ({}) } },
    {
      setTimeout: fakeSetTimeout ? (fn, ms) => (timers.push({ fn, ms }), timers.length) : setTimeout,
      clearTimeout: fakeSetTimeout ? () => {} : clearTimeout,
      process: { env: {} },
      Promise,
      Date,
      Math,
    },
  );
  return { mod: load("src/lib/ai/log.server.ts"), timers };
}

test("checkAIBudget: ok / exhausted / error / thrown / malformed data", async () => {
  const { mod } = budgetModule();
  const c = (rpc) => mod.checkAIBudget({ rpc }, USER);
  assert.equal(await c(async () => ({ data: true, error: null })), "ok");
  assert.equal(await c(async () => ({ data: false, error: null })), "exhausted");
  assert.equal(await c(async () => ({ data: null, error: { message: "x" } })), "unavailable");
  assert.equal(await c(async () => { throw new Error("network"); }), "unavailable");
  assert.equal(await c(() => { throw new Error("sync"); }), "unavailable");
  for (const bad of [null, undefined, "true", 1, 0, {}, []]) {
    assert.equal(await c(async () => ({ data: bad, error: null })), "unavailable", String(bad));
  }
  assert.equal(await c(async () => null), "unavailable");
});

test("checkAIBudget: a hung RPC times out (fake timers) => unavailable", async () => {
  const { mod, timers } = budgetModule(true);
  const pending = mod.checkAIBudget({ rpc: () => new Promise(() => {}) }, USER);
  await Promise.resolve();
  assert.equal(timers.length, 1);
  assert.ok(timers[0].ms >= 1000 && timers[0].ms <= 5000, `timeout ${timers[0].ms}ms`);
  timers[0].fn();
  assert.equal(await pending, "unavailable");
});

test("route: budget RPC that throws or hangs-then-times-out => 503, zero provider calls", async () => {
  const spy = upstreamSpy();
  const db = budgetDb({ data: true, error: null });
  db.rpc = async () => { throw new Error("connection reset"); };
  const res = await loadRoute("tts", db, spy)({ request: json({ text: "Good morning." }) });
  assert.equal(res.status, 503);
  assert.deepEqual(spy.calls, []);
});

// ---- usage accrual: every paid route writes ai_log so the cap can trip -------
const ACCRUAL = [
  ["insights", "insights", () => json({ context: "Night shift tonight." })],
  ["swap", "swap", () => json({ context: "Extra shift Saturday." })],
  ["tts", "tts", () => json({ text: "Good morning, this is a longer line to speak aloud." })],
  ["tts-elevenlabs", "tts-elevenlabs", () => json({ text: "Good morning, this is a longer line." })],
  ["stt", "stt", sttRequest],
  ["lab/simli/speak", "lab/simli/speak", () => json({ text: "Hello there." })],
  ["lab/simli/session", "lab/simli/session", () => json({ faceId: "face-example" })],
];
for (const [label, file, makeReq] of ACCRUAL) {
  test(`${label}: a successful provider call writes a positive ai_log usage row`, async () => {
    const db = budgetDb({ data: true, error: null });
    const spy = upstreamSpy();
    const res = await loadRoute(file, db, spy)({ request: makeReq() });
    assert.equal(res.status, 200, await res.clone().text());
    if (res.body) await res.arrayBuffer();
    await new Promise((r) => setTimeout(r, 0));
    const rows = db.inserts.filter((i) => i.table === "ai_log").map((i) => i.row);
    assert.equal(rows.length, 1, JSON.stringify(db.inserts));
    assert.equal(rows[0].user_id, USER);
    assert.ok(rows[0].prompt_tokens + rows[0].completion_tokens > 0);
  });
  test(`${label}: a refused request (over cap) writes no usage and calls no provider`, async () => {
    const db = budgetDb({ data: false, error: null });
    const spy = upstreamSpy();
    const res = await loadRoute(file, db, spy)({ request: makeReq() });
    assert.equal(res.status, 429);
    assert.deepEqual(spy.calls, []);
    assert.equal(db.inserts.filter((i) => i.table === "ai_log").length, 0);
  });
}

test("usage estimates are conservative and documented in one helper", () => {
  const { mod } = budgetModule();
  assert.equal(mod.estimateTextTokens(400), 100);
  assert.equal(mod.estimateTtsTokens(400), 400);
  assert.equal(mod.estimateElevenLabsTokens(400), 800);
  assert.ok(mod.estimateSttTokens(0) >= mod.USAGE_ESTIMATE.STT_MIN_TOKENS);
  assert.ok(mod.estimateSttTokens(100 * 1024) >= 200);
  assert.ok(mod.USAGE_ESTIMATE.SESSION_MINT_TOKENS > 0);
});

test("live voice mint is rate limited, budget-checked, then debits worst case before OpenAI", () => {
  const src = stripComments(read("src/lib/realtime/openai.functions.ts"));
  const at = (n) => src.indexOf(n);
  assert.ok(at("enforceRateLimit(") > at("assertAIConsent(") && at("enforceRateLimit(") < at("await requireAIBudget("));
  assert.ok(at("await requireAIBudget(") < at("startRealtimeSession(") && at("startRealtimeSession(") < at("api.openai.com"));
  assert.match(read("src/lib/api/ratelimit.server.ts"), /realtime: \{ bucket: "realtime"/);
  assert.match(read("src/lib/api/ratelimit.server.ts"), /realtimeReport: \{ bucket: "realtime-report"/);
});

test("nothing but the backend can change ai_daily_token_cap (no client code writes it)", () => {
  for (const rel of [...walk("src")]) {
    if (rel.includes("integrations/supabase/types.ts")) continue;
    assert.ok(!/ai_daily_token_cap/.test(read(rel)), `${rel} references the cap column`);
  }
});

// ---- live voice: real cost cap (atomic worst-case debit, one session, deadline) -
// The SQL functions are proven on real PostgreSQL in
// tests/voice-session-postgres.test.mjs; here a JS twin of them backs the
// route/helper behaviour (refusals, deadline, no provider call on refusal).
const REALTIME_CAP = 500000;
function ledgerDb(cap, preUsed = 0, { rpcFails = [] } = {}) {
  const db = fakeDb({ consent: consentLoad().aiConsentGrantPatch("2026-11-15T10:00:00.000Z") });
  const used = () => db.logRows.reduce((n, r) => n + r.prompt_tokens + r.completion_tokens, 0);
  const now = () => (db.now ? db.now() : Date.now());
  const add = (user_id, intent, prompt_tokens, status = "ok") =>
    db.logRows.push({ user_id, intent, prompt_tokens, completion_tokens: 0, status, created_at: new Date(now()).toISOString() });
  if (preUsed) add(USER, "tts", preUsed);
  db.rpc = async (fn, a) => {
    if (rpcFails.includes(fn)) return { data: null, error: { message: `${fn} down` } };
    const mine = (i) => db.logRows.find((r) => r.user_id === a._user_id && r.intent === i);
    if (fn === "has_ai_budget") return { data: used() < cap, error: null };
    if (fn === "claim_voice_session") {
      const active = db.logRows.some(
        (m) =>
          m.user_id === a._user_id &&
          m.intent.startsWith("rt-mint:") &&
          Date.parse(m.created_at) > now() - a._window_seconds * 1000 &&
          !mine("rt-end:" + m.intent.slice(8)),
      );
      if (active) return { data: "active", error: null };
      add(a._user_id, "rt-mint:" + a._sid, a._debit);
      if (!(used() < cap)) {
        db.logRows.pop();
        return { data: "exhausted", error: null };
      }
      return { data: "ok", error: null };
    }
    if (fn === "end_voice_session") {
      const m = mine("rt-mint:" + a._sid);
      if (!m || mine("rt-end:" + a._sid)) return { data: null, error: null };
      const applied = Math.max(a._delta ?? 0, -m.prompt_tokens);
      add(a._user_id, "rt-end:" + a._sid, applied, a._status);
      return { data: applied, error: null };
    }
    if (fn === "charge_voice_overage") {
      const key = `rt-over:${a._sid}:${a._bucket}`;
      if (!mine("rt-mint:" + a._sid) || mine(key)) return { data: false, error: null };
      add(a._user_id, key, a._tokens, "overage");
      return { data: true, error: null };
    }
    return { data: true, error: null };
  };
  return db;
}
const mintCall = (db, spy) => loadRealtime(db, spy)({ data: {}, context: { userId: USER } });
const sessionMod = (env = { REALTIME_VOICE_ENABLED: "1" }) =>
  makeLoader({}, { process: { env }, Promise, Date, Math, setTimeout, clearTimeout })(
    "src/lib/realtime/session-cost.server.ts",
  );
const pricing = () => makeLoader({}, {})("src/lib/realtime/voice-pricing.ts");
const net = (db, prefix) => db.logRows.filter((r) => r.intent.startsWith(prefix)).reduce((n, r) => n + r.prompt_tokens, 0);

test("voice cost model: dollars, conversion and debit come from one helper and are consistent", () => {
  const p = pricing();
  const perMin = p.worstCaseUsdPerMinute();
  // 6 responses/min x (1500 + 2000) ctx tokens x $32/M + 1200 out tokens x $64/M
  assert.ok(Math.abs(perMin - (6 * 3500 * 32e-6 + 1200 * 64e-6 + 0.006)) < 1e-9);
  assert.equal(p.TOKENS_PER_MINUTE, p.usdToTokenEquivalents(perMin));
  assert.equal(p.WORST_CASE_DEBIT_TOKENS, 3 * p.TOKENS_PER_MINUTE);
  // the debit, valued back in dollars, covers the dollars of a full-length honest session
  assert.ok(p.WORST_CASE_DEBIT_TOKENS * p.TOKEN_EQUIVALENT_USD >= p.maxUsdPerMint() - 1e-9);
  // the free tier (15,000) cannot start voice; premium (500,000) can start a few
  assert.equal(p.mintsPerDay(15000), 0);
  assert.ok(p.mintsPerDay(500000) >= 3);
  // a modified client ignoring the deadline can cost far more than an honest one
  assert.ok(p.hostileUsdPerMint() > 50 * p.maxUsdPerMint());
  // our measured system prompt stays inside the assumption used for pricing
  const instr = makeLoader({}, {})("src/lib/realtime/instructions.ts");
  const profile = makeLoader({}, {})("src/lib/voice/profile.ts");
  const text = instr.buildRealtimeInstructions(profile.DEFAULT_VOICE_PROFILE);
  assert.ok(Math.ceil(text.length / 4) <= p.VOICE_LIMITS.INSTRUCTION_TOKENS_ASSUMED);
  const over = instr.buildRealtimeInstructions({ ...profile.DEFAULT_VOICE_PROFILE, instructionsOverride: "x".repeat(5000) });
  assert.ok(Math.ceil(over.length / 4) <= p.VOICE_LIMITS.INSTRUCTION_TOKENS_ASSUMED, "custom override is capped");
});

test("voice mint: worst-case debit recorded, deadline + session id returned, short token + limits sent", async () => {
  const m = sessionMod();
  const db = ledgerDb(REALTIME_CAP);
  const spy = upstreamSpy();
  const t0 = Date.now();
  const out = await mintCall(db, spy);
  assert.equal(net(db, "rt-mint:"), m.worstCaseTokens());
  assert.ok(out.sessionId && db.logRows.some((r) => r.intent === `rt-mint:${out.sessionId}`));
  assert.equal(out.maxSessionSeconds, m.REALTIME_COST.MAX_SESSION_SECONDS);
  assert.ok(Math.abs(out.deadlineAt - (t0 + m.REALTIME_COST.MAX_SESSION_SECONDS * 1000)) < 5000);
  const sent = JSON.parse(spy.bodies[0]);
  assert.equal(sent.expires_after.seconds, m.REALTIME_COST.TOKEN_TTL_SECONDS);
  assert.ok(sent.expires_after.seconds >= 10 && sent.expires_after.seconds <= 60);
  assert.equal(sent.session.max_output_tokens, m.REALTIME_COST.MAX_OUTPUT_TOKENS);
  assert.equal(sent.session.truncation.token_limits.post_instructions, m.REALTIME_COST.POST_INSTRUCTIONS_TOKENS);
});

test("voice mint: refused (no OpenAI call, nothing left debited) when remaining budget < worst case", async () => {
  const m = sessionMod();
  const D = m.worstCaseTokens();
  const db = ledgerDb(REALTIME_CAP, REALTIME_CAP - D + 1); // one token short
  const spy = upstreamSpy();
  await assert.rejects(mintCall(db, spy), /ai_budget_exhausted/);
  assert.deepEqual(spy.calls, []);
  assert.equal(net(db, "rt-"), 0);
  // exactly one token of headroom after the debit is enough (used + debit < cap)
  const ok = ledgerDb(REALTIME_CAP, REALTIME_CAP - D - 1);
  await mintCall(ok, upstreamSpy());
});

test("voice mint: a failing debit write or RPC outage refuses the mint (fail closed)", async () => {
  for (const down of [["claim_voice_session"], ["has_ai_budget"]]) {
    const db = ledgerDb(REALTIME_CAP, 0, { rpcFails: down });
    const spy = upstreamSpy();
    await assert.rejects(mintCall(db, spy), /ai_budget_unavailable|ai_budget_exhausted/, down.join());
    assert.deepEqual(spy.calls, [], down.join());
  }
  const db = ledgerDb(REALTIME_CAP);
  const orig = db.rpc;
  db.rpc = async (fn, a) => {
    if (fn === "claim_voice_session") throw new Error("socket hang up");
    return orig(fn, a);
  };
  const spy = upstreamSpy();
  await assert.rejects(mintCall(db, spy), /ai_budget_unavailable/);
  assert.deepEqual(spy.calls, []);
});

test("voice mint: one active session per user; refused until it ends; wrong user cannot end it", async () => {
  const m = sessionMod();
  const db = ledgerDb(REALTIME_CAP);
  const spy = upstreamSpy();
  const first = await mintCall(db, spy);
  await assert.rejects(mintCall(db, spy), /voice_session_active/);
  assert.equal(spy.calls.length, 1, "second mint never reached OpenAI");
  assert.equal(net(db, "rt-"), m.worstCaseTokens(), "refused mint left no debit");
  // another user presenting this session id changes nothing
  const OTHER = "22222222-2222-4222-8222-222222222222";
  const wrong = await m.reportRealtimeSession(db, OTHER, { sessionId: first.sessionId, elapsedSeconds: 5, final: true });
  assert.equal(wrong.endNow, true);
  assert.equal(net(db, "rt-"), m.worstCaseTokens());
  await assert.rejects(mintCall(db, spy), /voice_session_active/);
  await m.reportRealtimeSession(db, USER, { sessionId: first.sessionId, elapsedSeconds: 5, final: true });
  const again = await mintCall(db, spy);
  assert.notEqual(again.sessionId, first.sessionId);
});

test("voice mint: provider failure after the debit returns the whole debit and frees the slot", async () => {
  const db = ledgerDb(REALTIME_CAP);
  const spy = upstreamSpy();
  spy.fail = true;
  await assert.rejects(mintCall(db, spy));
  assert.equal(spy.calls.length, 1);
  assert.equal(net(db, "rt-"), 0);
  await mintCall(db, upstreamSpy());
});

test("heartbeat/finish: bound to the session, refund <= debit and never negative-extra, idempotent, server clock wins", async () => {
  const m = sessionMod();
  const D = m.worstCaseTokens();
  const PM = m.REALTIME_COST.TOKENS_PER_MINUTE;
  const T = 1_800_000_000_000;
  const mk = async () => {
    const db = ledgerDb(REALTIME_CAP);
    db.now = () => T;
    const r = await m.startRealtimeSession(db, USER, T);
    assert.ok(r.ok);
    return { db, sid: r.sessionId };
  };
  const rep = (db, sid, at, elapsed, final, user = USER) => {
    db.now = () => at;
    return m.reportRealtimeSession(db, user, { sessionId: sid, elapsedSeconds: elapsed, final }, at);
  };
  // clean finish at 60 s: actual = 1 minute, refund half the unused part
  let { db, sid } = await mk();
  let r = await rep(db, sid, T + 60_000, 60, true);
  assert.equal(r.refunded, Math.floor((D - PM) * m.REALTIME_COST.REFUND_FRACTION));
  assert.ok(r.refunded > 0 && r.refunded < D, "refund never exceeds the debit");
  assert.ok(net(db, "rt-") > 0 && net(db, "rt-") >= PM, "net charge never below actual use");
  // replaying the finish is a no-op
  const rows = db.logRows.length;
  r = await rep(db, sid, T + 61_000, 61, true);
  assert.equal(r.endNow, true);
  assert.equal(db.logRows.length, rows);
  // wrong user cannot finish or heartbeat it
  ({ db, sid } = await mk());
  const OTHER = "33333333-3333-4333-8333-333333333333";
  r = await rep(db, sid, T + 10_000, 10, true, OTHER);
  assert.equal(r.refunded, 0);
  assert.equal(net(db, "rt-"), D);
  // overage: ran 5 minutes => charged more than the debit
  ({ db, sid } = await mk());
  r = await rep(db, sid, T + 300_000, 300, true);
  assert.equal(r.overage, 5 * PM - D);
  assert.equal(net(db, "rt-"), 5 * PM);
  // the client cannot under-report: server saw the full deadline, no refund
  ({ db, sid } = await mk());
  r = await rep(db, sid, T + m.REALTIME_COST.MAX_SESSION_SECONDS * 1000, 1, true);
  assert.equal(r.refunded, 0);
  assert.equal(net(db, "rt-"), D);
  // heartbeat inside the window: nothing written, no hang-up
  ({ db, sid } = await mk());
  const before = db.logRows.length;
  r = await rep(db, sid, T + 60_000, 60, false);
  assert.equal(r.endNow, false);
  assert.equal(r.deadlineAt, T + m.REALTIME_COST.MAX_SESSION_SECONDS * 1000);
  assert.equal(db.logRows.length, before);
  // late heartbeat: told to end, charged once per step even if replayed
  const late = T + (m.REALTIME_COST.MAX_SESSION_SECONDS + m.REALTIME_COST.GRACE_SECONDS + 5) * 1000;
  r = await rep(db, sid, late, 999, false);
  assert.equal(r.endNow, true);
  const step = m.tokensForSeconds(m.REALTIME_COST.OVERAGE_STEP_SECONDS);
  assert.equal(net(db, "rt-over:"), step);
  await rep(db, sid, late + 1000, 999, false);
  await rep(db, sid, late + 2000, 999, false);
  assert.equal(net(db, "rt-over:"), step, "replayed heartbeats in the same step are not charged again");
  // unknown session id => hang up, nothing written
  const n = db.logRows.length;
  r = await rep(db, "nope", T + 1000, 1, false);
  assert.equal(r.endNow, true);
  assert.equal(db.logRows.length, n);
  // a failed refund write grants nothing extra
  ({ db, sid } = await mk());
  const orig = db.rpc;
  db.rpc = async (fn, a) => (fn === "end_voice_session" ? { data: null, error: { message: "down" } } : orig(fn, a));
  r = await rep(db, sid, T + 30_000, 30, true);
  assert.equal(r.refunded, 0);
  assert.equal(net(db, "rt-"), D);
});

test("modified client: ignoring the deadline is stopped only by token expiry; model of what remains", () => {
  const p = pricing();
  const src = stripComments(read("src/lib/realtime/openai.functions.ts"));
  // The only server-side stops: short token (handshake only), capped context/output, per-user claim.
  assert.match(src, /expires_after: \{ anchor: "created_at", seconds: costMod\.REALTIME_COST\.TOKEN_TTL_SECONDS \}/);
  assert.match(src, /post_instructions: costMod\.REALTIME_COST\.POST_INSTRUCTIONS_TOKENS/);
  assert.ok(p.VOICE_LIMITS.TOKEN_TTL_SECONDS <= 60);
  // The residual is real: after connecting, only OpenAI's 60-minute cap applies.
  assert.equal(p.VOICE_LIMITS.PROVIDER_MAX_SESSION_MINUTES, 60);
  assert.ok(p.hostileUsdPerMint() > p.maxUsdPerMint());
});

test("client ends the call at the server deadline; reports are authenticated and rate limited", () => {
  const hook = stripComments(read("src/lib/realtime/useOpenAIRealtime.ts"));
  assert.match(hook, /session\.deadlineAt/);
  assert.match(hook, /rtDeadlineTimerRef\.current = setTimeout\(/);
  assert.match(hook, /r\?\.endNow/);
  assert.match(hook, /final: true/);
  const fn = stripComments(read("src/lib/realtime/session-report.functions.ts"));
  assert.match(fn, /requireSupabaseAuth/);
  assert.match(fn, /enforceRateLimit\(context\.userId, RATE_LIMITS\.realtimeReport\)/);
  // ids come from the caller's own auth context, never from the request body
  assert.match(fn, /report\(supabaseAdmin, context\.userId,/);
});

test("has_ai_budget is not callable from the client or by other users (server-only callers)", () => {
  const callers = [];
  for (const rel of [...walk("src")]) {
    if (rel.includes("integrations/supabase/types.ts")) continue;
    if (/rpc\(\s*"has_ai_budget"/.test(stripComments(read(rel)))) callers.push(rel);
  }
  assert.deepEqual(callers, ["src/lib/ai/log.server.ts"]);
});

test("nothing but the backend can change ai_daily_token_cap (no client code writes it)", () => {
  for (const rel of [...walk("src")]) {
    if (rel.includes("integrations/supabase/types.ts")) continue;
    assert.ok(!/ai_daily_token_cap/.test(read(rel)), `${rel} references the cap column`);
  }
});

// ---- kill switch: live voice is off unless REALTIME_VOICE_ENABLED=1 ----------
test("kill switch: flag unset => refused, no debit, no rate-limit hit, no provider call", async () => {
  const db = ledgerDb(REALTIME_CAP);
  const spy = upstreamSpy();
  spy.voiceOff = true;
  await assert.rejects(mintCall(db, spy), /voice_disabled: Voice is temporarily unavailable/);
  assert.deepEqual(spy.calls, []);
  assert.equal(db.logRows.length, 0, "nothing was debited");
  assert.ok(!db.inserts.some((i) => i.table === "ai_log"));
  // the debit helper itself also refuses
  const m = sessionMod({});
  const r = await m.startRealtimeSession(db, USER);
  assert.equal(r.ok, false);
  assert.equal(r.code, "voice_disabled");
  assert.equal(db.logRows.length, 0);
});

test("kill switch: any value other than exactly 1 is off; set => normal path", async () => {
  const spyOn = upstreamSpy();
  const on = await mintCall(ledgerDb(REALTIME_CAP), spyOn);
  assert.ok(on.sessionId);
  assert.equal(spyOn.calls.length, 1);
  const src = stripComments(read("src/lib/realtime/openai.functions.ts"));
  assert.match(src, /process\.env\.REALTIME_VOICE_ENABLED !== "1"/);
  assert.ok(src.indexOf("REALTIME_VOICE_ENABLED") < src.indexOf("enforceRateLimit("), "checked before rate limit and debit");
  assert.ok(src.indexOf("REALTIME_VOICE_ENABLED") < src.indexOf("startRealtimeSession("));
  // the client shows a user-safe message and the text coach is untouched
  assert.match(stripComments(read("src/lib/realtime/useOpenAIRealtime.ts")), /voice_disabled[\s\S]*text coach/);
});

test("kill switch is OFF by default in the repo (no env file or config sets it)", () => {
  for (const f of [".env", ".env.example", "wrangler.jsonc", "vite.config.ts"]) {
    try {
      assert.ok(!/REALTIME_VOICE_ENABLED\s*=?\s*:?\s*"?1/.test(read(f)), `${f} must not enable voice`);
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
    }
  }
});

// ---- pinned economics: refund share and the hostile immediate-finish loop -----
test("REFUND_FRACTION is pinned to 0.5 (a change to 1 must be a deliberate, reviewed edit)", async () => {
  const m = sessionMod();
  assert.equal(m.REALTIME_COST.REFUND_FRACTION, 0.5);
  const D = m.worstCaseTokens();
  const PM = m.REALTIME_COST.TOKENS_PER_MINUTE;
  const db = ledgerDb(REALTIME_CAP);
  const T = 1_800_000_000_000;
  db.now = () => T;
  const s = await m.startRealtimeSession(db, USER, T);
  db.now = () => T + 1000;
  const r = await m.reportRealtimeSession(db, USER, { sessionId: s.sessionId, elapsedSeconds: 1, final: true }, T + 1000);
  // literal half, not derived from the constant under test
  assert.equal(r.refunded, Math.floor((D - PM) / 2));
  assert.equal(net(db, "rt-"), D - Math.floor((D - PM) / 2), "half of the unused debit is kept");
});

test("hostile 'mint, finish immediately, repeat' loop: the cap still ends it; count and total are pinned", async () => {
  const m = sessionMod();
  const D = m.worstCaseTokens();
  const PM = m.REALTIME_COST.TOKENS_PER_MINUTE;
  const db = ledgerDb(REALTIME_CAP);
  const T = 1_800_000_000_000;
  let sessions = 0;
  for (let i = 0; i < 100; i++) {
    db.now = () => T + i * 2000;
    const s = await m.startRealtimeSession(db, USER, T + i * 2000);
    if (!s.ok) {
      assert.equal(s.code, "ai_budget_exhausted");
      break;
    }
    sessions++;
    db.now = () => T + i * 2000 + 1000;
    await m.reportRealtimeSession(db, USER, { sessionId: s.sessionId, elapsedSeconds: 1, final: true }, T + i * 2000 + 1000);
  }
  const keptPerSession = D - Math.floor((D - PM) / 2);
  assert.equal(sessions, Math.floor((REALTIME_CAP - 1 - D + keptPerSession) / keptPerSession));
  assert.ok(net(db, "rt-") < REALTIME_CAP, "the ledger never passes the cap");
  // each of those sessions could still be a real, ignored-deadline session at OpenAI:
  // the loop is the bound on how many, NOT a bound on what each costs (see VOICE-COST-MODEL.md).
  assert.ok(sessions >= 5 && sessions <= 12, `sessions ${sessions}`);
  console.log(`hostile loop: ${sessions} sessions/day, kept ${keptPerSession} each`);
});
