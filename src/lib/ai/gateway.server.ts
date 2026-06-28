/**
 * Server-only Lovable AI Gateway helpers.
 * Centralises every model call so logging, budget checks, and error mapping
 * happen in exactly one place (Bundle 1 — Smart AI Foundation).
 */

const GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
export const DEFAULT_CHAT_MODEL = "google/gemini-3-flash-preview";
export const FAST_MODEL = "google/gemini-3.1-flash-lite";

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
  const k = process.env.LOVABLE_API_KEY;
  if (!k) throw new AIError(500, "AI not configured");
  return k;
}

export function mapUpstreamError(status: number): string {
  if (status === 429) return "Rate limit reached. Try again in a moment.";
  if (status === 402)
    return "AI credits exhausted. Add funds in Settings > Workspace > Usage.";
  return "AI request failed.";
}

/** Non-streaming JSON completion. Returns the assistant text. */
export async function chatJSON(opts: {
  model?: string;
  messages: ChatMsg[];
  temperature?: number;
  jsonMode?: boolean;
}): Promise<{ text: string; promptTokens: number; completionTokens: number }> {
  const body: Record<string, unknown> = {
    model: opts.model ?? DEFAULT_CHAT_MODEL,
    messages: opts.messages,
  };
  if (opts.temperature !== undefined) body.temperature = opts.temperature;
  if (opts.jsonMode) body.response_format = { type: "json_object" };

  const res = await fetch(GATEWAY_URL, {
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
  const res = await fetch(GATEWAY_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: opts.model ?? DEFAULT_CHAT_MODEL,
      messages: opts.messages,
      temperature: opts.temperature,
      ...(opts.maxTokens ? { max_tokens: opts.maxTokens } : {}),
      stream: true,
    }),
  });
  if (!res.ok) throw new AIError(res.status, mapUpstreamError(res.status));
  return res;
}

