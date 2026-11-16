/**
 * Server-only Lovable AI Gateway helpers.
 * Centralises every model call so logging, budget checks, and error mapping
 * happen in exactly one place (Bundle 1 — Smart AI Foundation).
 */

import { PROVIDER_BUSY_MESSAGE, PROVIDER_UNAVAILABLE_MESSAGE } from "./refusal";

const GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
export const DEFAULT_CHAT_MODEL = "google/gemini-3-flash-preview";
export const FAST_MODEL = "google/gemini-3.1-flash-lite";

export type ChatMsg = { role: "system" | "user" | "assistant"; content: string };

export type GatewayError = {
  status: number;
  message: string;
};

export class AIError extends Error {
  /**
   * For an upstream failure this is the PROVIDER's status (used for owner
   * alerts and logs). It must never be sent to the browser as-is: a provider
   * 429 is not the user's limit. Routes answer with providerFailureResponse().
   */
  status: number;
  /** True when the AI provider / gateway (not RestPilot, not the user) failed. */
  upstream: boolean;
  constructor(status: number, message: string, opts?: { upstream?: boolean }) {
    super(message);
    this.status = status;
    this.upstream = opts?.upstream === true;
    this.name = "AIError";
  }
}

function apiKey(): string {
  const k = process.env.LOVABLE_API_KEY;
  if (!k) throw new AIError(500, "AI not configured");
  return k;
}

export function mapUpstreamError(status: number): string {
  // The provider's rate limit, not the user's: say so, so nobody reads it as
  // their own allowance.
  if (status === 429) return PROVIDER_BUSY_MESSAGE;
  // User-safe wording only. The operator detail (provider credits exhausted)
  // is delivered via notifyOwnerAsync + server logs, never to the client.
  if (status === 402) return "AI is temporarily unavailable. Please try again later.";
  return "AI request failed.";
}

/**
 * One call to the gateway. A network failure or a non-2xx answer becomes an
 * AIError flagged `upstream`, carrying the provider's status for alerts only.
 */
async function gatewayFetch(body: Record<string, unknown>): Promise<Response> {
  const key = apiKey();
  let res: Response;
  try {
    res = await fetch(GATEWAY_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
  } catch (e) {
    console.error("[ai-gateway] network error", e instanceof Error ? e.message : String(e));
    throw new AIError(503, PROVIDER_UNAVAILABLE_MESSAGE, { upstream: true });
  }
  if (!res.ok) throw new AIError(res.status, mapUpstreamError(res.status), { upstream: true });
  return res;
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

  const res = await gatewayFetch(body);

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
  const body: Record<string, unknown> = {
    model: opts.model ?? DEFAULT_CHAT_MODEL,
    messages: opts.messages,
    temperature: opts.temperature,
    ...(opts.maxTokens ? { max_tokens: opts.maxTokens } : {}),
    stream: true,
  };
  try {
    // OpenAI-compatible: ask for a final usage frame so the turn is logged
    // with the provider's numbers. Streams only; chatJSON already returns usage.
    return await gatewayFetch({ ...body, stream_options: { include_usage: true } });
  } catch (e) {
    // A gateway that rejects stream_options must not break every reply. Only a
    // 400/422 answer (no stream body was returned, so nothing was delivered and
    // the rejected request was never answered) is retried, once, without it.
    // Usage for that turn then comes from the route's estimate.
    if (e instanceof AIError && e.upstream && (e.status === 400 || e.status === 422)) {
      console.warn(
        `[ai-gateway] ${e.status} on stream_options.include_usage; retrying once without it`,
      );
      return gatewayFetch(body);
    }
    throw e;
  }
}
