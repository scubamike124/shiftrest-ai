/**
 * Promptfoo provider that calls an OpenAI-compatible Chat Completions endpoint
 * through RestPilot's own request builder (src/lib/ai/models.server.ts), so the
 * benchmark exercises the exact request shape production sends: the 180-token
 * voice cap, JSON mode for intents, family-specific parameters, and streamed
 * usage. Records time-to-first-token, total latency, tokens and cost.
 *
 * config:
 *   baseUrl     e.g. https://generativelanguage.googleapis.com/v1beta/openai
 *   apiKeyEnv   name of the env var holding the key (value never logged)
 *   model       provider model id
 *   reasoning   optional { coach, voice, structured, brief } reasoning_effort
 */
const path = require("node:path");
const { loadTs } = require("./production-prompt.cjs");
const PRICES = require("../prices.json");
const { guarded, estimateTokens } = require("./guard.cjs");

const MAX_RETRIES = 4;

function priceFor(model) {
  return PRICES[model.replace(/^[a-z]+\//, "")] ?? null;
}

function costOf(model, usage) {
  const p = priceFor(model);
  if (!p || !usage) return undefined;
  const cached = usage.cached ?? 0;
  return ((usage.prompt - cached) * p.input + cached * (p.cachedInput ?? p.input) + usage.completion * p.output) / 1e6;
}

function taskFor(vars) {
  if (vars.kind === "voice") return "voice";
  if (vars.kind === "intent") return "structured";
  if (vars.kind === "brief") return "brief";
  return "coach";
}

async function post(url, key, body) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120_000),
    });
    if ((res.status === 429 || res.status >= 500) && attempt < MAX_RETRIES) {
      const wait = Number(res.headers.get("retry-after")) * 1000 || 2000 * 2 ** attempt;
      await res.body?.cancel();
      await new Promise((r) => setTimeout(r, Math.min(wait, 60_000)));
      continue;
    }
    return res;
  }
}

class RestPilotAppProvider {
  constructor(options = {}) {
    this.config = options.config ?? {};
    this.label = options.label;
    this.providerId = options.id ?? "restpilot-app";
  }

  id() {
    return this.label ?? `${this.providerId}:${this.config.model}`;
  }

  async callApi(prompt, context) {
    const { buildChatBody } = loadTs("@/lib/ai/models.server");
    const vars = context?.vars ?? {};
    const key = process.env[this.config.apiKeyEnv];
    const messages = JSON.parse(prompt);
    const task = taskFor(vars);
    const streaming = task === "coach" || task === "voice";
    const tools = vars.tools ? (typeof vars.tools === "string" ? JSON.parse(vars.tools) : vars.tools) : null;
    const body = buildChatBody(
      {
        model: this.config.model,
        messages,
        maxTokens: task === "voice" ? 180 : 2048,
        jsonMode: task === "structured",
        stream: streaming && !tools,
        reasoningEffort: this.config.reasoning?.[task],
      },
      { AI_STREAM_USAGE: "on" },
    );
    if (tools) body.tools = tools;
    const url = `${this.config.baseUrl.replace(/\/$/, "")}/chat/completions`;
    // Every paid call goes through the spend guard: hard token cap + response cache.
    return guarded({
      parts: { url, body },
      estimate: estimateTokens(JSON.stringify(body.messages)) + (body.max_completion_tokens ?? body.max_tokens ?? 2048),
      context,
      unavailable: key ? null : `missing ${this.config.apiKeyEnv} (benchmark pending key)`,
      call: () => this.send(url, key, body, task),
    });
  }

  async send(url, key, body, task) {
    const started = Date.now();
    let res;
    try {
      res = await post(url, key, body);
    } catch (e) {
      return { error: `request failed: ${e instanceof Error ? e.message : String(e)}` };
    }
    if (!res.ok) {
      const text = (await res.text().catch(() => "")).slice(0, 300);
      return { error: `HTTP ${res.status}: ${text}` };
    }

    let output = "";
    let usage = null;
    let finishReason = null;
    let ttftMs = null;
    if (body.stream) {
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let nl;
        while ((nl = buf.indexOf("\n")) !== -1) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line.startsWith("data:")) continue;
          const json = line.slice(5).trim();
          if (!json || json === "[DONE]") continue;
          try {
            const frame = JSON.parse(json);
            const delta = frame.choices?.[0]?.delta?.content;
            if (delta) {
              if (ttftMs === null) ttftMs = Date.now() - started;
              output += delta;
            }
            finishReason = frame.choices?.[0]?.finish_reason ?? finishReason;
            if (frame.usage) usage = frame.usage;
          } catch {
            /* partial frame */
          }
        }
      }
    } else {
      const data = await res.json();
      const choice = data.choices?.[0];
      finishReason = choice?.finish_reason ?? null;
      usage = data.usage ?? null;
      if (choice?.message?.tool_calls?.length) {
        output = JSON.stringify({
          tool_calls: choice.message.tool_calls.map((c) => ({ name: c.function?.name, arguments: safeJson(c.function?.arguments) })),
          content: choice.message.content ?? "",
        });
      } else {
        output = choice?.message?.content ?? "";
      }
    }
    const latencyMs = Date.now() - started;
    const u = usage
      ? {
          prompt: usage.prompt_tokens ?? 0,
          completion: usage.completion_tokens ?? 0,
          cached: usage.prompt_tokens_details?.cached_tokens ?? 0,
          reasoning: usage.completion_tokens_details?.reasoning_tokens ?? 0,
        }
      : null;
    return {
      output: output.trim(),
      latencyMs,
      cost: costOf(this.config.model, u),
      tokenUsage: u ? { prompt: u.prompt, completion: u.completion, total: u.prompt + u.completion, cached: u.cached } : undefined,
      metadata: { model: this.config.model, task, ttftMs, finishReason, reasoningTokens: u?.reasoning ?? null, usageReported: Boolean(u) },
    };
  }
}

function safeJson(s) {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}

module.exports = RestPilotAppProvider;
module.exports.costOf = costOf;
module.exports.priceFor = priceFor;
module.exports.ROOT = path.resolve(__dirname, "../../../..");
