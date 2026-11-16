// Shared helpers for tests that run the REAL AI route handlers
// (src/routes/api/*.ts) with Supabase and the AI providers replaced. No
// network. The rate limiter, budget gate, gateway and refusal modules are the
// real ones unless a test stubs them, so the tests see the same responses a
// browser would.
import { existsSync, readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

export const ROOT = new URL("../", import.meta.url);
export const read = (p) => readFileSync(new URL(p, ROOT), "utf8");
export const USER = "22222222-2222-4222-8222-222222222222";

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

/** Transpile-and-run loader for src/ modules (CommonJS in a fresh VM context). */
export function makeLoader(stubs = {}, globals = {}) {
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
    vm.runInNewContext(js, { module, exports: module.exports, require: req, ...globals });
    return module.exports;
  }
  return load;
}

/** The real grant record, built by the app's own consent module. */
export const GRANTED = {
  terms: "2026-06-27",
  ...makeLoader()("src/lib/ai/consent.ts").aiConsentGrantPatch("2026-11-15T10:00:00.000Z"),
};

/**
 * Supabase stand-in. `budgetOk` answers has_ai_budget, `rateCount` answers
 * rate_limit_hit (the limiter refuses above its limit of 20). Every insert is
 * recorded so a test can see exactly what was written to ai_log.
 */
export function fakeDb({ consent = GRANTED, budgetOk = true, rateCount = 1 } = {}) {
  const inserts = [];
  const rpcCalls = [];
  return {
    inserts,
    rpcCalls,
    /** Rows written to ai_log (the table has_ai_budget sums). */
    get aiLog() {
      return inserts.filter((i) => i.table === "ai_log").map((i) => i.row);
    },
    /** Token-equivalents debited against the allowance. */
    get debited() {
      return this.aiLog.reduce(
        (n, r) => n + (r.prompt_tokens ?? 0) + (r.completion_tokens ?? 0),
        0,
      );
    },
    auth: {
      async getUser(token) {
        return token === "user-token"
          ? { data: { user: { id: USER } }, error: null }
          : { data: { user: null }, error: { message: "bad" } };
      },
    },
    async rpc(name) {
      const n = String(name ?? "");
      rpcCalls.push(n);
      if (n === "has_ai_budget") return { data: budgetOk, error: null };
      if (n === "rate_limit_hit") return { data: rateCount, error: null };
      return { data: true, error: null };
    },
    from(table) {
      const base = {
        insert(row) {
          inserts.push({ table, row });
          return q;
        },
        async maybeSingle() {
          if (table === "user_prefs") return { data: { consent_json: consent }, error: null };
          return { data: null, error: null };
        },
        async single() {
          return { data: null, error: null };
        },
        then: (resolve) => resolve({ data: null, error: null }),
      };
      const q = new Proxy(base, { get: (t, k) => (k in t ? t[k] : () => q) });
      return q;
    },
  };
}

const sse = (o) => `data: ${JSON.stringify(o)}\n\n`;

/**
 * Stands for every external AI provider. `status` other than 200 is the
 * provider failing; `network: true` is the request never arriving;
 * `breakStream: true` is a stream that dies after its first chunk.
 */
export function provider({
  status = 200,
  network = false,
  breakStream = false,
  breakBeforeText = false,
  /** After the first chunk, wait this long (ms) before the rest: a client can cancel in between. */
  gapMs = 0,
  reply = "Nap at 3 pm.",
  usage = { prompt_tokens: 900, completion_tokens: 60 },
} = {}) {
  const calls = [];
  const fetch = async (url, init) => {
    const u = String(url);
    calls.push({ url: u, body: typeof init?.body === "string" ? init.body : "" });
    if (network) throw new TypeError("fetch failed");
    if (status !== 200) {
      return new Response(JSON.stringify({ error: { message: "upstream says no" } }), {
        status,
        headers: { "content-type": "application/json" },
      });
    }
    if (u.includes("/audio/speech") || u.includes("elevenlabs")) {
      return new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: { "content-type": "audio/mpeg" },
      });
    }
    if (u.includes("/audio/transcriptions")) return Response.json({ text: "hello there" });
    let wantsStream = false;
    try {
      wantsStream = JSON.parse(String(init?.body ?? "{}")).stream === true;
    } catch {
      /* not JSON */
    }
    if (!wantsStream) {
      return Response.json({
        choices: [{ message: { content: JSON.stringify({ tip: "Rest.", memories: [] }) } }],
        usage,
      });
    }
    const enc = new TextEncoder();
    const body = new ReadableStream({
      start(c) {
        if (breakBeforeText) {
          c.error(new Error("provider stream broke"));
          return;
        }
        c.enqueue(enc.encode(sse({ choices: [{ delta: { content: reply } }] })));
        if (breakStream) {
          // After the browser has been sent the text.
          setTimeout(() => c.error(new Error("provider stream broke")), 10);
          return;
        }
        const rest = () => {
          try {
            c.enqueue(enc.encode(sse({ choices: [{ delta: { content: " Then stay dark." } }] })));
            c.enqueue(enc.encode(sse({ choices: [{ delta: {} }], ...(usage ? { usage } : {}) })));
            c.enqueue(enc.encode("data: [DONE]\n\n"));
            c.close();
          } catch {
            /* the consumer cancelled */
          }
        };
        if (gapMs) setTimeout(rest, gapMs);
        else rest();
      },
    });
    return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
  };
  return { calls, fetch };
}

/**
 * Load a real route handler. `stubs` overrides or adds module stubs; pass
 * `realContext: true` to build the real system prompt (for measuring it).
 */
export function loadRoute(file, { db, spy, stubs = {}, realContext = false, env = {} }) {
  const alerts = [];
  const logs = [];
  const base = {
    "@tanstack/react-router": { createFileRoute: () => (cfg) => cfg },
    "@supabase/supabase-js": { createClient: () => db },
    "@/lib/api/auth.server": { requireUser: async () => ({ userId: USER }) },
    "@/lib/ops/alert.server": { notifyOwnerAsync: (a) => alerts.push(a) },
    "@/lib/ai/recommendations.server": {
      persistRecommendation: async () => null,
      fetchFeedbackSummary: async () => [],
      fetchPreviousRecommendation: async () => null,
    },
    "@/lib/api/lab-gate.server": { requireLabAccess: async () => null },
  };
  if (!realContext) {
    base["@/lib/ai/intent-hint.server"] = { classifyIntent: () => null };
    base["@/lib/ai/memory-extractor.server"] = { extractAndStoreMemories: async () => {} };
    base["@/lib/ai/context.server"] = {
      DEFAULT_ASSISTANT_PROFILE: { language: "en-US", accent: null, memoryEnabled: false },
      loadAssistantProfile: async () => ({ language: "en-US", accent: null, memoryEnabled: false }),
      buildSystemPrompt: async () => "system",
    };
  }
  const log = (...a) => logs.push(a.map(String).join(" "));
  const globals = {
    process: {
      env: {
        SUPABASE_URL: "https://example.supabase.test",
        SUPABASE_SERVICE_ROLE_KEY: "service-role-example",
        LOVABLE_API_KEY: "lovable-example",
        ELEVENLABS_API_KEY: "eleven-example",
        ...env,
      },
    },
    fetch: spy.fetch,
    console: { log, info: log, warn: log, error: log },
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
    Intl,
    setTimeout,
    clearTimeout,
    Promise,
    Date,
    Math,
    JSON,
  };
  const mod = makeLoader({ ...base, ...stubs }, globals)(`src/routes/api/${file}.ts`);
  return { post: mod.Route.server.handlers.POST, alerts, logs };
}

export const jsonRequest = (body, path = "/api/ai") =>
  new Request(`https://restpilotai.com${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer user-token" },
    body: JSON.stringify(body),
  });

export const coachBody = (text = "What time should I nap before nights?", extra = {}) => ({
  intent: "coach",
  messages: [{ role: "user", content: text }],
  surface: "voice",
  ...extra,
});

export function sttRequest() {
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(2048)], { type: "audio/wav" }), "recording.wav");
  return new Request("https://restpilotai.com/api/stt", {
    method: "POST",
    headers: { authorization: "Bearer user-token" },
    body: form,
  });
}

/** Read a whole response body as text (drains an SSE stream). */
export const drain = async (res) => (res.body ? await res.text() : "");

/** Give the route's post-stream work (logging) a chance to finish. */
export const settle = () => new Promise((r) => setTimeout(r, 20));
