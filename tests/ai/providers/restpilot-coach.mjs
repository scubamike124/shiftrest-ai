// Promptfoo provider for the RestPilot AI companion ("Lisa" / Pilot).
//
// It follows the same path as POST /api/ai {intent:"coach"}:
//   loadAssistantProfile -> buildTimeDirective -> classifyIntent ->
//   buildSystemPrompt (memories, patterns, TZ state, personal signals) ->
//   gateway.chatStream (same OpenAI-compatible endpoint, key, output limits).
// Only the database is replaced, by per-scenario fixtures (lib/fake-supabase),
// and the clock is frozen per scenario so prompts are reproducible and cacheable.
//
// Provider config (promptfooconfig.yaml):
//   model:  model ID; defaults to the app's own choice (AI_MODEL_COACH /
//           AI_MODEL_VOICE via models.server.ts when present, else AI_CHAT_MODEL)
//   now:    default frozen clock (ISO), overridable per test with vars.now
// Scenario vars: see tests/ai/README.md.
import fs from "node:fs";
import path from "node:path";
import { loadAppModule, repoRoot } from "../lib/app-loader.mjs";
import { createFakeSupabase } from "../lib/fake-supabase.mjs";
import { withFrozenClock } from "../lib/frozen-clock.mjs";
import { cacheEnabled, cacheKey, readCache, writeCache } from "../lib/response-cache.mjs";
import {
  BudgetExceeded,
  estimateTokens,
  noteCacheHit,
  priceUsd,
  release,
  reserve,
  settle,
} from "../lib/budget.mjs";

const EVAL_USER = "00000000-0000-4000-8000-0000000e7a11";
const DEFAULT_NOW = "2026-11-16T20:00:00.000Z"; // Mon 2 p.m. in America/Chicago

function asObject(v) {
  if (!v) return {};
  if (typeof v === "string") {
    try {
      return JSON.parse(v);
    } catch {
      return {};
    }
  }
  return v;
}

function asArray(v) {
  if (!v) return [];
  if (typeof v === "string") {
    try {
      return JSON.parse(v);
    } catch {
      return [];
    }
  }
  return Array.isArray(v) ? v : [];
}

async function appModel(surface) {
  if (!fs.existsSync(path.join(repoRoot, "src/lib/ai/models.server.ts")))
    return process.env.AI_CHAT_MODEL;
  try {
    const m = await loadAppModule("lib/ai/models.server.ts");
    if (typeof m.modelForTask === "function") {
      return m.modelForTask(surface === "voice" ? "voice" : "coach");
    }
  } catch {
    /* models.server.ts not merged yet: use the legacy mapping */
  }
  return process.env.AI_CHAT_MODEL;
}

/** Assemble exactly what /api/ai sends upstream for a coach turn. */
export async function assembleCoachRequest(vars, providerConfig = {}) {
  const now = vars.now || providerConfig.now || DEFAULT_NOW;
  const fixtures = { ...asObject(vars.fixtures) };
  const profile = asObject(vars.profile);
  const prefs = { ...(asArray(fixtures.user_prefs)[0] ?? {}), ...profile };
  const timezone = vars.timezone || prefs.current_tz || prefs.home_tz || "America/Chicago";
  if (!prefs.home_tz) prefs.home_tz = timezone;
  fixtures.user_prefs = [prefs];
  const surface = vars.surface === "voice" ? "voice" : "text";
  const expand = vars.expand === true || vars.expand === "true";
  const history = asArray(vars.history).filter(
    (m) => m && (m.role === "user" || m.role === "assistant"),
  );
  const message = String(vars.message ?? "");

  const [ctx, td, ih] = await Promise.all([
    loadAppModule("lib/ai/context.server.ts"),
    loadAppModule("lib/ai/time-directive.ts"),
    loadAppModule("lib/ai/intent-hint.server.ts"),
  ]);

  return withFrozenClock(now, async (frozenNow) => {
    const admin = createFakeSupabase(fixtures, frozenNow, EVAL_USER);
    const appProfile = await ctx.loadAssistantProfile(admin, EVAL_USER);
    const timeDirective = td.buildTimeDirective({
      localTime: frozenNow.toISOString(),
      timezone,
    }).directive;
    const intentHint = ih.classifyIntent(message);
    const system = await ctx.buildSystemPrompt({
      admin,
      userId: EVAL_USER,
      profile: appProfile,
      liveContext: vars.context || undefined,
      intent: "coach",
      surface,
      expand,
      intentHint,
    });
    const turns = [...history, { role: "user", content: message }].slice(-20);
    return {
      surface,
      intentHint,
      messages: [{ role: "system", content: system + timeDirective }, ...turns],
      // Same output ceiling as /api/ai: 180 tokens for short voice replies.
      maxTokens: surface === "voice" && !expand ? 180 : 2048,
    };
  });
}

/** Read an OpenAI-compatible SSE stream to completion. */
async function readStream(res, startedAt) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let text = "";
  let ttft = null;
  let usage = null;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (data === "[DONE]") continue;
      try {
        const json = JSON.parse(data);
        const delta = json.choices?.[0]?.delta?.content ?? "";
        if (delta && ttft === null) ttft = Date.now() - startedAt;
        text += delta;
        if (json.usage) usage = json.usage;
      } catch {
        /* keep-alive or partial line */
      }
    }
  }
  return { text: text.trim(), ttftMs: ttft, usage };
}

export default class RestPilotCoachProvider {
  constructor(options = {}) {
    this.config = options.config ?? {};
    this.providerId = options.id ?? `restpilot-coach:${this.config.model || "app-default"}`;
    this.label = options.label;
  }

  id() {
    return this.providerId;
  }

  async callApi(_prompt, context = {}) {
    const vars = context.vars ?? {};
    let req;
    try {
      req = await assembleCoachRequest(vars, this.config);
    } catch (e) {
      return { error: `Prompt assembly failed: ${e?.message ?? e}` };
    }
    const model = this.config.model || (await appModel(req.surface));
    const meta = {
      surface: req.surface,
      intentHint: req.intentHint,
      systemPromptChars: req.messages[0].content.length,
    };

    if (process.env.RESTPILOT_EVAL_DRY_RUN === "1") {
      return { output: req.messages[0].content, metadata: { ...meta, dryRun: true } };
    }
    let host = "default";
    try {
      host = new URL(process.env.AI_BASE_URL || "https://api.openai.com/v1").host;
    } catch {
      /* gateway will reject it with a clear error */
    }
    const key = cacheKey({
      v: 1,
      host,
      model: model || "unset",
      messages: req.messages,
      maxTokens: req.maxTokens,
      repeat: context.repeatIndex ?? 0,
    });
    const useCache = cacheEnabled(context);
    if (useCache) {
      const hit = readCache(key);
      if (hit) {
        noteCacheHit();
        return {
          ...hit,
          cached: true,
          tokenUsage: { ...hit.tokenUsage, cached: hit.tokenUsage?.total ?? 0 },
        };
      }
    }

    // Cache first: with a warm cache an eval runs without any key at all.
    if (!model || !(process.env.AI_API_KEY || process.env.OPENAI_API_KEY)) {
      return {
        error: "BLOCKED: needs AI_API_KEY (or OPENAI_API_KEY), AI_BASE_URL and AI_CHAT_MODEL",
      };
    }
    const promptChars = req.messages.reduce((n, m) => n + m.content.length, 0);
    let reservation;
    try {
      reservation = reserve(Math.ceil(promptChars / 3.5) + req.maxTokens);
    } catch (e) {
      if (e instanceof BudgetExceeded) return { error: e.message };
      throw e;
    }

    const gateway = await loadAppModule("lib/ai/gateway.server.ts");
    const started = Date.now();
    let spent = 0;
    let cost = 0;
    try {
      const res = await gateway.chatStream({
        model,
        messages: req.messages,
        maxTokens: req.maxTokens,
      });
      const { text, ttftMs, usage } = await readStream(res, started);
      const latencyMs = Date.now() - started;
      const promptTokens = usage?.prompt_tokens ?? Math.ceil(promptChars / 3.5);
      const completionTokens = usage?.completion_tokens ?? estimateTokens(text);
      spent = promptTokens + completionTokens;
      cost = priceUsd(promptTokens, completionTokens);
      const result = {
        output: text,
        tokenUsage: {
          total: spent,
          prompt: promptTokens,
          completion: completionTokens,
          numRequests: 1,
        },
        cost,
        metadata: { ...meta, model, ttftMs, latencyMs, usageReported: Boolean(usage) },
      };
      if (useCache && text) writeCache(key, result);
      return result;
    } catch (e) {
      // A failed call still costs the prompt; charge the estimate to stay safe.
      spent = Math.ceil(promptChars / 3.5);
      return { error: `Model call failed: ${e?.message ?? e}` };
    } finally {
      release(reservation);
      settle(0, spent, cost);
    }
  }
}
