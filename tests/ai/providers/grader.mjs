// Grader for llm-rubric / model-graded assertions. It uses the app's own
// OpenAI-compatible gateway (chatJSON) with AI_GRADER_MODEL (default:
// AI_CHAT_MODEL), and it draws on the same token cap as the app provider, so
// grading can never be the thing that blows the budget.
import { loadAppModule } from "../lib/app-loader.mjs";
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

// chatJSON allows up to 2048 output tokens; reserve all of it.
const GRADER_MAX_OUTPUT = 2048;

function toMessages(prompt) {
  try {
    const parsed = JSON.parse(prompt);
    if (Array.isArray(parsed) && parsed.every((m) => m && typeof m.content === "string")) {
      return parsed.map((m) => ({
        role: m.role === "assistant" || m.role === "system" ? m.role : "user",
        content: m.content,
      }));
    }
  } catch {
    /* plain-text grading prompt */
  }
  return [{ role: "user", content: String(prompt) }];
}

export default class RestPilotGraderProvider {
  constructor(options = {}) {
    this.config = options.config ?? {};
  }

  id() {
    return `restpilot-grader:${this.config.model || process.env.AI_GRADER_MODEL || process.env.AI_CHAT_MODEL || "unset"}`;
  }

  async callApi(prompt, context = {}) {
    const model = this.config.model || process.env.AI_GRADER_MODEL || process.env.AI_CHAT_MODEL;
    const messages = toMessages(prompt);
    const key = cacheKey({ v: 1, grader: true, model: model || "unset", messages });
    const useCache = cacheEnabled(context);
    if (useCache) {
      const hit = readCache(key);
      if (hit) {
        noteCacheHit();
        return { ...hit, cached: true };
      }
    }
    if (!model || !(process.env.AI_API_KEY || process.env.OPENAI_API_KEY)) {
      return { error: "BLOCKED: grader needs AI_API_KEY and AI_GRADER_MODEL or AI_CHAT_MODEL" };
    }
    const promptTokens = estimateTokens(messages.map((m) => m.content).join("\n"));
    let reservation;
    try {
      reservation = reserve(promptTokens + GRADER_MAX_OUTPUT);
    } catch (e) {
      if (e instanceof BudgetExceeded) return { error: e.message };
      throw e;
    }
    const gateway = await loadAppModule("lib/ai/gateway.server.ts");
    let spent = promptTokens;
    let cost = 0;
    try {
      const r = await gateway.chatJSON({ model, messages, temperature: 0, jsonMode: true });
      spent = (r.promptTokens || promptTokens) + (r.completionTokens || estimateTokens(r.text));
      cost = priceUsd(r.promptTokens || promptTokens, r.completionTokens || 0);
      const result = {
        output: r.text,
        tokenUsage: {
          total: spent,
          prompt: r.promptTokens,
          completion: r.completionTokens,
          numRequests: 1,
        },
        cost,
      };
      if (useCache && r.text) writeCache(key, result);
      return result;
    } catch (e) {
      return { error: `Grader call failed: ${e?.message ?? e}` };
    } finally {
      release(reservation);
      settle(0, spent, cost);
    }
  }
}
