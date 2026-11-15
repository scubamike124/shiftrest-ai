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
import { createRequire } from "node:module";

const nodeRequire = createRequire(import.meta.url);

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
      if (!target) {
        // Plain npm packages with no network or database side effects.
        if (["zod"].includes(spec)) return nodeRequire(spec);
        throw new Error(`unexpected import "${spec}" in ${rel}`);
      }
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
    rpcs: [],
    async rpc(name) {
      db.rpcs.push(name);
      if (name === "consume_ai_request") return { data: { allowed: true }, error: null };
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

// One JSON object that satisfies every intent's output check (chat intents,
// insights, swap), so "permission given" exercises the real happy path.
const SAMPLE_OUTPUT = {
  ok: true,
  tip: "Rest before your shift.",
  generatedAt: "2026-11-15T10:00:00.000Z",
  greeting: "Good morning",
  headline: "Protect your sleep window",
  fatigue_note: "Two night shifts in a row.",
  top_actions: [
    { icon: "moon", title: "Sleep at 9", detail: "Blackout the room." },
    { icon: "coffee", title: "Caffeine cutoff", detail: "None after 3 am." },
    { icon: "sun", title: "Morning light", detail: "Avoid it on the way home." },
  ],
  coach_note: "You've got this.",
  verdict: "take_with_caveats",
  verdict_label: "Take it — with caveats",
  cost: "medium",
  cost_reason: "Short recovery before the next block.",
  risks: ["Short sleep"],
  naps: [{ time: "15:00", duration_min: 20, why: "Bank sleep." }],
  summary: "You can take it if you nap first.",
};

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
      choices: [{ message: { content: JSON.stringify(SAMPLE_OUTPUT) } }],
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
    AI_API_KEY: "ai-example",
    AI_BASE_URL: "https://generativelanguage.googleapis.com/v1beta/openai",
    AI_CHAT_MODEL: "gemini-3-flash-preview",
    AI_FAST_MODEL: "gemini-3.1-flash-lite",
    AI_AUDIO_API_KEY: "audio-example",
    AI_AUDIO_BASE_URL: "https://api.openai.com/v1",
    AI_TTS_MODEL: "gpt-4o-mini-tts",
    AI_STT_MODEL: "gpt-4o-mini-transcribe",
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
  const names = c.AI_CONSENT_PROVIDERS.map((p) => `${p.name} ${p.what}`).join(" | ");
  for (const n of ["Google Gemini", "OpenAI", "ElevenLabs"]) assert.match(names, new RegExp(n));
  assert.match(names, /Never Apple Health/);
  // provider.server.ts can send text AI to OpenAI when AI_BASE_URL is unset,
  // so the text entry must name OpenAI as well as Google.
  const text = c.AI_CONSENT_PROVIDERS.find((p) => /coach messages/.test(p.what));
  assert.match(text.name, /Google Gemini/);
  assert.match(text.name, /OpenAI/);
  assert.match(read("src/lib/ai/provider.server.ts"), /api\.openai\.com/);
  assert.notEqual(c.AI_CONSENT_VERSION, "2026-11-15", "main's grants don't count on Railway");
  const dialog = read("src/components/ai/AIConsentDialog.tsx");
  assert.match(dialog, /to="\/legal\/privacy"/);
  assert.match(dialog, />\s*Allow\s*|"Allow"/);
  assert.match(dialog, /Not now/);
  const policy = read("src/routes/legal.privacy.tsx");
  assert.match(policy, /id="ai-providers"/);
  for (const n of ["Google Gemini", "OpenAI", "ElevenLabs"]) assert.match(policy, new RegExp(n));
  assert.match(
    policy,
    /Apple Health data stays\s+on\s+your\s+iPhone\s+and\s+is\s+never\s+sent\s+to\s+AI\s+providers/,
  );
  assert.match(policy, /Google Gemini \(Google's Gemini API\), or OpenAI/);
  const subprocessors = read("src/routes/legal.third-parties.tsx");
  assert.match(subprocessors, /ElevenLabs/);
  assert.match(subprocessors, /Google \(Gemini API\), or OpenAI/);
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
      assert.ok(
        !db.rpcs.includes("consume_ai_request"),
        "a refusal does not use up the AI allowance",
      );
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
          u.startsWith("https://generativelanguage.googleapis.com/") ||
          u.startsWith("https://api.openai.com/") ||
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

test("consent is checked before admission, so a refusal never uses up the AI allowance", () => {
  for (const f of [
    "src/routes/api/ai.ts",
    "src/routes/api/brief.ts",
    "src/routes/api/insights.ts",
    "src/routes/api/swap.ts",
    "src/routes/api/stt.ts",
    "src/routes/api/tts.ts",
    "src/routes/api/tts-elevenlabs.ts",
    "src/routes/api/lab/simli/speak.ts",
    "src/routes/api/lab/simli/session.ts",
  ]) {
    const src = read(f);
    const gate = src.indexOf("requireAIConsent(");
    const admission = src.indexOf("requireAIAdmission(", src.indexOf("handlers:"));
    assert.ok(gate > 0 && admission > 0 && gate < admission, `${f}: consent before admission`);
  }
  const rt = read("src/lib/realtime/openai.functions.ts");
  const handler = rt.indexOf(".handler(");
  assert.ok(
    rt.indexOf("assertAIConsent(", handler) < rt.indexOf("requireAIAdmission(", handler),
    "mintRealtimeSession: consent before admission",
  );
});

test("the legacy /api/coach route only forwards to the gated /api/ai", () => {
  const src = read("src/routes/api/coach.ts");
  assert.match(src, /fetch\(aiForwardUrl\(request\.url\)/);
  assert.match(read("src/lib/ai/forward.server.ts"), /\/api\/ai/);
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
    for (const upstream of ["aiEndpoint(", "api.elevenlabs.io", "chatJSON(", "chatStream("]) {
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
    "./access.server": { realtimeEnvironment: () => "sandbox" },
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
    AbortSignal,
    AbortController,
    setTimeout,
    clearTimeout,
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
    // A file may alias aiFetch as `fetch` (kept so an unformatted file's
    // call sites stay untouched); then every fetch in it is aiFetch.
    if (/^import \{ aiFetch as fetch \} from "@\/lib\/ai\/consent-client";$/m.test(src)) continue;
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
      ai.indexOf("await proposeMemoriesFromChat("),
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
