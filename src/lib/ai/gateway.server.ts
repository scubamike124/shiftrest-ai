/**
 * Server-only direct AI provider helpers.
 * Centralises every model call so logging, budget checks, and error mapping
 * happen in exactly one place (Bundle 1 — Smart AI Foundation).
 */

import { aiApiKey, aiEndpoint } from "./provider.server";
export const DEFAULT_CHAT_MODEL = process.env.AI_CHAT_MODEL || "not-configured";
export const FAST_MODEL = process.env.AI_FAST_MODEL || DEFAULT_CHAT_MODEL;

export type ChatMsg = { role: "system" | "user" | "assistant"; content: string };

export type GatewayError = {
  status: number;
  message: string;
};

export class AIError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = "AIError";
  }
}

function apiKey(): string {
  const k = aiApiKey();
  if (!k || !process.env.AI_CHAT_MODEL) throw new AIError(500, "AI not configured");
  return k;
}

export function mapUpstreamError(status: number): string {
  if (status === 429) return "Rate limit reached. Try again in a moment.";
  if (status === 402)
    return "AI provider quota reached. Please try again later.";
  return "AI request failed.";
}

/** A per-call ceiling complements admission; it is not a monetary budget. */
function validateMessages(messages: ChatMsg[]) {
  if (!Array.isArray(messages) || messages.length === 0 || messages.length > 32 ||
      messages.some(m => !m || !["system", "user", "assistant"].includes(m.role) || typeof m.content !== "string") ||
      messages.reduce((sum, m) => sum + m.content.length, 0) > 64_000) {
    throw new AIError(400, "AI context is too large or invalid. Please shorten the conversation.");
  }
}

/** Non-streaming JSON completion. Returns the assistant text. */
export async function chatJSON(opts: {
  model?: string;
  messages: ChatMsg[];
  temperature?: number;
  jsonMode?: boolean;
}): Promise<{ text: string; promptTokens: number; completionTokens: number }> {
  validateMessages(opts.messages);
  const body: Record<string, unknown> = {
    max_tokens: 2048,
    model: opts.model ?? DEFAULT_CHAT_MODEL,
    messages: opts.messages,
  };
  if (opts.temperature !== undefined) body.temperature = opts.temperature;
  if (opts.jsonMode) body.response_format = { type: "json_object" };

  const res = await fetch(aiEndpoint("chat/completions"), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) throw new AIError(res.status, mapUpstreamError(res.status));

  const data = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  return {
    text: data.choices?.[0]?.message?.content?.trim() ?? "",
    promptTokens: data.usage?.prompt_tokens ?? 0,
    completionTokens: data.usage?.completion_tokens ?? 0,
  };
}

/** Streaming SSE passthrough. Returns the upstream Response for piping. */
export async function chatStream(opts: {
  model?: string;
  messages: ChatMsg[];
  temperature?: number;
  maxTokens?: number;
}): Promise<Response> {
  validateMessages(opts.messages);
  const maxTokens = opts.maxTokens === undefined ? 2048 : opts.maxTokens;
  if (!Number.isInteger(maxTokens) || maxTokens < 1 || maxTokens > 2048) throw new AIError(400, "Invalid output limit");
  const res = await fetch(aiEndpoint("chat/completions"), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: opts.model ?? DEFAULT_CHAT_MODEL,
      messages: opts.messages,
      temperature: opts.temperature,
      max_tokens: maxTokens,
      stream: true,
    }),
  });
  if (!res.ok) throw new AIError(res.status, mapUpstreamError(res.status));
  return res;
}
