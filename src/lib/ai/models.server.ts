/**
 * Task-aware model routing for the direct OpenAI-compatible chat provider.
 *
 * DEFAULT = UNCHANGED BEHAVIOUR. With only AI_CHAT_MODEL / AI_FAST_MODEL set,
 * every task resolves exactly as before this module existed: background memory
 * extraction uses AI_FAST_MODEL (falling back to AI_CHAT_MODEL) and every other
 * task uses AI_CHAT_MODEL.
 *
 * Optional, benchmark-driven overrides (each takes effect only when set):
 *   AI_MODEL_COACH       text coach chat (streamed)
 *   AI_MODEL_VOICE       short spoken companion replies (streamed, latency-sensitive)
 *   AI_MODEL_STRUCTURED  JSON intents: plans, alarm, commute, insights, swap
 *   AI_MODEL_BRIEF       voice-briefing rewrite
 *   AI_MODEL_BACKGROUND  memory extraction
 *   AI_REASONING_<TASK>  reasoning_effort for that task (none|minimal|low|medium|high)
 *
 * Optional failover (off unless AI_FALLBACK_MODEL is set; see fallbackConfig):
 *   AI_FALLBACK_MODEL     model tried once when the routed model fails
 *   AI_FALLBACK_BASE_URL  other provider endpoint (then AI_FALLBACK_API_KEY is required).
 *                         Only the vendors users were told about are allowed:
 *                         generativelanguage.googleapis.com and api.openai.com. Any other
 *                         host leaves failover disabled and logs a warning. Adding a vendor
 *                         requires updating consent.ts and legal.third-parties.tsx and
 *                         bumping AI_CONSENT_VERSION FIRST, then FALLBACK_HOSTS below.
 *   AI_FALLBACK_API_KEY   key for AI_FALLBACK_BASE_URL (never the primary key)
 *   AI_FALLBACK=off       turns failover off without touching the other settings
 *
 * Failover limits (read before relying on it):
 *   - It lives in gateway.server.ts (chatJSON / chatStream) only. /api/insights, /api/swap,
 *     TTS and STT call provider.server directly and get NO failover.
 *   - When the fallback answers, a 402/429/401 on the primary is only console-logged (no
 *     owner alert), and the coach stream's ai_log row still records the primary model name.
 *   - The gateway must not import log/budget modules; callers log the returned usage once.
 *
 * Rollback: AI_ROUTING=off ignores every per-task override and reasoning setting
 * in one step, returning to the AI_CHAT_MODEL / AI_FAST_MODEL mapping.
 * AI_CHAT_MODEL stays required, so a rollback target always exists.
 */

export type AITask = "coach" | "voice" | "structured" | "brief" | "background";
export const AI_TASKS: readonly AITask[] = ["coach", "voice", "structured", "brief", "background"];

type Env = Record<string, string | undefined>;

const TASK_SUFFIX: Record<AITask, string> = {
  coach: "COACH",
  voice: "VOICE",
  structured: "STRUCTURED",
  brief: "BRIEF",
  background: "BACKGROUND",
};

const REASONING = new Set(["none", "minimal", "low", "medium", "high"]);
const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,119}$/;

function cleanModel(value: string | undefined): string | undefined {
  const v = value?.trim();
  return v && MODEL_ID.test(v) ? v : undefined;
}

export function routingEnabled(env: Env = process.env): boolean {
  const v = (env.AI_ROUTING ?? "").trim().toLowerCase();
  return !["off", "0", "false", "legacy"].includes(v);
}

/** Hosts that expect bare model IDs; a Lovable-style "google/…" prefix is stripped. */
function stripsVendorPrefix(env: Env): boolean {
  try {
    const host = new URL(env.AI_BASE_URL ?? "").hostname;
    return (
      host === "generativelanguage.googleapis.com" ||
      host === "api.openai.com" ||
      host === "api.anthropic.com"
    );
  } catch {
    return false;
  }
}

function normalize(model: string, env: Env): string {
  return stripsVendorPrefix(env) ? model.replace(/^(google|openai|anthropic)\//, "") : model;
}

/** The model a task should use, or undefined when AI is not configured. */
export function modelForTask(task: AITask, env: Env = process.env): string | undefined {
  if (routingEnabled(env)) {
    const override = cleanModel(env[`AI_MODEL_${TASK_SUFFIX[task]}`]);
    if (override) return normalize(override, env);
  }
  const chat = cleanModel(env.AI_CHAT_MODEL);
  const model = task === "background" ? (cleanModel(env.AI_FAST_MODEL) ?? chat) : chat;
  return model ? normalize(model, env) : undefined;
}

export function reasoningForTask(task: AITask, env: Env = process.env): string | undefined {
  if (!routingEnabled(env)) return undefined;
  const v = env[`AI_REASONING_${TASK_SUFFIX[task]}`]?.trim().toLowerCase();
  return v && REASONING.has(v) ? v : undefined;
}

export type FallbackConfig = { model: string; baseUrl?: string; apiKey?: string };

/** Vendors disclosed to users (consent.ts, legal.third-parties.tsx): Google Gemini and OpenAI. */
const FALLBACK_HOSTS = new Set(["generativelanguage.googleapis.com", "api.openai.com"]);

function warnFallback(reason: string): void {
  try {
    console.warn(`AI failover disabled: ${reason}`);
  } catch {
    /* no console */
  }
}

/**
 * Second model for provider failures. Disabled (undefined) unless AI_FALLBACK_MODEL
 * is a valid model ID. Off switches: AI_FALLBACK=off|0|false, or AI_ROUTING=off.
 * A different endpoint must be https, on an allowed vendor host, without credentials,
 * query or hash, and needs its own key: the primary key is never sent to another host.
 */
export function fallbackConfig(env: Env = process.env): FallbackConfig | undefined {
  if (!routingEnabled(env)) return undefined;
  if (["off", "0", "false"].includes((env.AI_FALLBACK ?? "").trim().toLowerCase()))
    return undefined;
  const raw = cleanModel(env.AI_FALLBACK_MODEL);
  if (!raw) return undefined;
  const baseUrl = env.AI_FALLBACK_BASE_URL?.trim() || undefined;
  if (!baseUrl) return { model: normalize(raw, env) };
  let u: URL;
  try {
    u = new URL(baseUrl);
  } catch {
    warnFallback("AI_FALLBACK_BASE_URL is not a valid URL");
    return undefined;
  }
  if (
    u.protocol !== "https:" ||
    u.username ||
    u.password ||
    u.search ||
    u.hash ||
    !FALLBACK_HOSTS.has(u.hostname)
  ) {
    warnFallback(
      `AI_FALLBACK_BASE_URL host "${u.hostname}" is not an allowed provider (generativelanguage.googleapis.com, api.openai.com) or the URL is not plain https`,
    );
    return undefined;
  }
  const apiKey = env.AI_FALLBACK_API_KEY?.trim();
  if (!apiKey) {
    warnFallback("AI_FALLBACK_BASE_URL is set without AI_FALLBACK_API_KEY");
    return undefined;
  }
  return { model: normalize(raw, { ...env, AI_BASE_URL: baseUrl }), baseUrl, apiKey };
}

export type ModelFamily = "openai-reasoning" | "claude" | "gemini" | "other";

export function modelFamily(model: string): ModelFamily {
  const m = model.toLowerCase().replace(/^[a-z]+\//, "");
  if (/^(gpt-5|gpt-6|o[1-9])/.test(m)) return "openai-reasoning";
  if (m.startsWith("claude-")) return "claude";
  if (m.startsWith("gemini-")) return "gemini";
  return "other";
}

export type ChatBodyInput = {
  model: string;
  messages: unknown[];
  temperature?: number;
  maxTokens?: number;
  jsonMode?: boolean;
  stream?: boolean;
  reasoningEffort?: string;
};

/**
 * Build a Chat Completions body that each provider family accepts.
 * - OpenAI reasoning models (gpt-5/6, o-series): max_completion_tokens, no temperature.
 * - Claude (OpenAI-compatible endpoint): no temperature below 1, no json_object
 *   (prompts already demand JSON and responses are parsed defensively), no reasoning_effort.
 * - Gemini and others: unchanged from the pre-routing request shape.
 * Streaming asks for a final usage frame so token budgets count streamed chat;
 * AI_STREAM_USAGE=off disables that for a provider that rejects stream_options.
 */
export function buildChatBody(
  input: ChatBodyInput,
  env: Env = process.env,
): Record<string, unknown> {
  const family = modelFamily(input.model);
  const body: Record<string, unknown> = { model: input.model, messages: input.messages };
  if (input.maxTokens !== undefined) {
    body[family === "openai-reasoning" ? "max_completion_tokens" : "max_tokens"] = input.maxTokens;
  }
  if (input.temperature !== undefined && family !== "openai-reasoning" && family !== "claude") {
    body.temperature = input.temperature;
  }
  if (input.jsonMode && family !== "claude") body.response_format = { type: "json_object" };
  if (input.reasoningEffort && family !== "claude") body.reasoning_effort = input.reasoningEffort;
  if (input.stream) {
    body.stream = true;
    const usage = (env.AI_STREAM_USAGE ?? "").trim().toLowerCase();
    if (!["off", "0", "false"].includes(usage)) body.stream_options = { include_usage: true };
  }
  return body;
}
