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
  const db = {
    tables,
    auth: {
      async getUser() {
        return { data: { user: { id: USER } }, error: null };
      },
    },
    async rpc() {
      return { data: true, error: null };
    },
    from(table) {
      tables.push(table);
      const q = {
        select() {
          return q;
        },
        eq() {
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
        async insert() {
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
          u.startsWith("https://api.elevenlabs.io/"),
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

test("the gate runs before any prompt is built or provider is called in every AI route", () => {
  for (const file of ["ai", "brief", "insights", "swap", "stt", "tts", "tts-elevenlabs"]) {
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
        SUPABASE_URL: "https://example.supabase.test",
        SUPABASE_SERVICE_ROLE_KEY: "service-role-example",
      },
    },
    fetch: async (url) => {
      spy.calls.push(String(url));
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
    "./consent.functions": {
      getAIConsentFn: async () => ({
        granted: status.granted,
        grantedAt: null,
        version: "2026-11-15",
      }),
      setAIConsentFn: async ({ data }) => {
        setCalls.push(data);
        status.granted = data.allow;
        return { granted: data.allow, grantedAt: null, version: "2026-11-15" };
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
