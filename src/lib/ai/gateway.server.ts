/**
 * Server-only direct AI provider helpers.
 * Centralises every model call so logging, budget checks, and error mapping
 * happen in exactly one place (Bundle 1 — Smart AI Foundation).
 */

import { aiApiKey, aiEndpoint } from "./provider.server";
import {
  buildChatBody,
  fallbackConfig,
  modelForTask,
  reasoningForTask,
  type AITask,
  type FallbackConfig,
} from "./models.server";
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

/**
 * Per-attempt ceiling so a hung provider cannot eat the failover window.
 * Used ONLY when failover is configured: the default path has no timer.
 */
const ATTEMPT_TIMEOUT_MS = 25_000;

function timeoutSignal(): { signal?: AbortSignal; clear: () => void } {
  if (typeof AbortController === "undefined" || typeof setTimeout === "undefined")
    return { clear() {} };
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ATTEMPT_TIMEOUT_MS);
  return { signal: ctl.signal, clear: () => clearTimeout(timer) };
}

/** Statuses where a second model can plausibly succeed: rate limit, quota, timeout, server errors. */
export function isFailoverStatus(status: number): boolean {
  return status === 402 || status === 408 || status === 429 || status >= 500;
}

function apiKey(): string {
  const k = aiApiKey();
  if (!k || !process.env.AI_CHAT_MODEL) throw new AIError(500, "AI not configured");
  return k;
}

export function mapUpstreamError(status: number): string {
  if (status === 429) return "Rate limit reached. Try again in a moment.";
  if (status === 402) return "AI provider quota reached. Please try again later.";
  return "AI request failed.";
}

/** A per-call ceiling complements admission; it is not a monetary budget. */
function validateMessages(messages: ChatMsg[]) {
  if (
    !Array.isArray(messages) ||
    messages.length === 0 ||
    messages.length > 32 ||
    messages.some(
      (m) =>
        !m || !["system", "user", "assistant"].includes(m.role) || typeof m.content !== "string",
    ) ||
    messages.reduce((sum, m) => sum + m.content.length, 0) > 64_000
  ) {
    throw new AIError(400, "AI context is too large or invalid. Please shorten the conversation.");
  }
}

export type ChatJSONResult = {
  text: string;
  promptTokens: number;
  completionTokens: number;
  model: string;
  finishReason: string | null;
  /** True when the fallback model produced this result. */
  fellBack?: boolean;
};

type Attempt = { model: string; base?: string; key: string };

/** The fallback to use for a call whose primary model is `model`, or undefined (default path). */
function activeFallback(model: string): FallbackConfig | undefined {
  const fb = fallbackConfig();
  if (!fb || (fb.model === model && !fb.baseUrl)) return undefined;
  return fb;
}

/** JSON mode output is usable only when it parses (code fences tolerated). */
function jsonUsable(text: string): boolean {
  if (!text) return false;
  try {
    JSON.parse(text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, ""));
    return true;
  } catch {
    return false;
  }
}

/** A reply worth returning: non-empty, and in JSON mode complete and parseable. */
function replyUsable(r: ChatJSONResult, jsonMode?: boolean): boolean {
  if (!r.text) return false;
  return !(jsonMode && (r.finishReason === "length" || !jsonUsable(r.text)));
}

/**
 * One completion request. `guarded` (failover configured) adds the per-attempt
 * timeout and maps transport failures to AIError(502); unguarded is the
 * original behaviour: no timer, raw errors propagate.
 */
async function jsonAttempt(
  opts: { messages: ChatMsg[]; temperature?: number; jsonMode?: boolean },
  task: AITask,
  at: Attempt,
  guarded: boolean,
): Promise<ChatJSONResult> {
  const body = buildChatBody({
    model: at.model,
    messages: opts.messages,
    maxTokens: 2048,
    temperature: opts.temperature,
    jsonMode: opts.jsonMode,
    reasoningEffort: reasoningForTask(task),
  });
  const t = guarded ? timeoutSignal() : { signal: undefined, clear() {} };
  try {
    const res = await fetch(aiEndpoint("chat/completions", at.base), {
      method: "POST",
      headers: { Authorization: `Bearer ${at.key}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      ...(t.signal ? { signal: t.signal } : {}),
    });
    if (!res.ok) throw new AIError(res.status, mapUpstreamError(res.status));
    const data = (await res.json()) as {
      choices?: { message?: { content?: string }; finish_reason?: string | null }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    return {
      text: data.choices?.[0]?.message?.content?.trim() ?? "",
      promptTokens: data.usage?.prompt_tokens ?? 0,
      completionTokens: data.usage?.completion_tokens ?? 0,
      model: at.model,
      finishReason: data.choices?.[0]?.finish_reason ?? null,
    };
  } catch (e) {
    if (!guarded || e instanceof AIError) throw e;
    // Network failure, timeout or an unparseable body: a retryable upstream fault.
    throw new AIError(502, mapUpstreamError(502));
  } finally {
    t.clear();
  }
}

/**
 * Non-streaming completion. Returns the assistant text.
 *
 * Without AI_FALLBACK_MODEL this is exactly the original single request (no
 * timer, raw errors). With failover (see models.server.ts) there is at most ONE
 * extra attempt, on a failover status (402/408/429/5xx), a network error or
 * timeout, an empty reply, or (jsonMode) truncated/unparseable JSON.
 * Budget: callers log the returned usage once. Only the attempt whose answer is
 * returned is reported, so a failed first attempt is never charged to the user
 * and admission (has_ai_budget / consume_ai_request) is not run again.
 * The fallback's answer is returned only if it is usable; otherwise the original
 * outcome stands: the primary's error is thrown, or its (empty/truncated) reply
 * is returned as before.
 */
export async function chatJSON(opts: {
  model?: string;
  /** Routes the call through models.server.ts; defaults to "structured". */
  task?: AITask;
  messages: ChatMsg[];
  temperature?: number;
  jsonMode?: boolean;
}): Promise<ChatJSONResult> {
  validateMessages(opts.messages);
  const task = opts.task ?? "structured";
  const model = opts.model ?? modelForTask(task) ?? DEFAULT_CHAT_MODEL;
  const key = apiKey();
  const fb = activeFallback(model);
  if (!fb) return jsonAttempt(opts, task, { model, key }, false);

  let primary: ChatJSONResult | undefined;
  let primaryErr: AIError | undefined;
  try {
    primary = await jsonAttempt(opts, task, { model, key }, true);
    if (replyUsable(primary, opts.jsonMode)) return primary;
    console.error("ai primary unusable", { model, finishReason: primary.finishReason });
  } catch (e) {
    primaryErr = e instanceof AIError ? e : new AIError(502, mapUpstreamError(502));
    // A 400 under JSON mode may be the provider refusing response_format; other 4xx are our bug or auth.
    const retryable =
      isFailoverStatus(primaryErr.status) || (opts.jsonMode === true && primaryErr.status === 400);
    if (!retryable) throw primaryErr;
    console.error("ai primary failed", { model, status: primaryErr.status });
  }

  try {
    const second = await jsonAttempt(
      opts,
      task,
      { model: fb.model, base: fb.baseUrl, key: fb.apiKey ?? key },
      true,
    );
    if (replyUsable(second, opts.jsonMode)) return { ...second, fellBack: true };
    console.error("ai fallback unusable", { model: fb.model, finishReason: second.finishReason });
  } catch (e) {
    console.error("ai fallback failed", {
      model: fb.model,
      status: e instanceof AIError ? e.status : 0,
    });
  }
  if (primaryErr) throw primaryErr;
  return primary!;
}

/**
 * Streaming SSE passthrough. Returns the upstream Response for piping.
 * Failover (only when configured) applies BEFORE the first byte is returned
 * (connection error, timeout, 402/408/429/5xx): one attempt on the fallback
 * model, and if that fails too the PRIMARY's error is thrown. A stream that
 * fails midway is not retried, because the client has already received text.
 */
export async function chatStream(opts: {
  model?: string;
  /** Routes the call through models.server.ts; defaults to "coach". */
  task?: AITask;
  messages: ChatMsg[];
  temperature?: number;
  maxTokens?: number;
}): Promise<Response> {
  validateMessages(opts.messages);
  const maxTokens = opts.maxTokens === undefined ? 2048 : opts.maxTokens;
  if (!Number.isInteger(maxTokens) || maxTokens < 1 || maxTokens > 2048)
    throw new AIError(400, "Invalid output limit");
  const task = opts.task ?? "coach";
  const key = apiKey();
  const model = opts.model ?? modelForTask(task) ?? DEFAULT_CHAT_MODEL;
  const fb = activeFallback(model);
  const attempt = async (
    m: string,
    base: string | undefined,
    k: string,
    guarded: boolean,
  ): Promise<Response> => {
    const t = guarded ? timeoutSignal() : { signal: undefined, clear() {} };
    try {
      const res = await fetch(aiEndpoint("chat/completions", base), {
        method: "POST",
        headers: { Authorization: `Bearer ${k}`, "Content-Type": "application/json" },
        body: JSON.stringify(
          buildChatBody({
            model: m,
            messages: opts.messages,
            temperature: opts.temperature,
            maxTokens,
            stream: true,
            reasoningEffort: reasoningForTask(task),
          }),
        ),
        ...(t.signal ? { signal: t.signal } : {}),
      });
      if (!res.ok) throw new AIError(res.status, mapUpstreamError(res.status));
      return res;
    } catch (e) {
      if (!guarded || e instanceof AIError) throw e;
      throw new AIError(502, mapUpstreamError(502));
    } finally {
      t.clear(); // the timeout guards connection and headers, not the stream body
    }
  };
  if (!fb) return attempt(model, undefined, key, false);
  try {
    return await attempt(model, undefined, key, true);
  } catch (e) {
    const err = e instanceof AIError ? e : new AIError(502, mapUpstreamError(502));
    if (!isFailoverStatus(err.status)) throw err;
    console.error("ai stream primary failed", { model, status: err.status });
    try {
      return await attempt(fb.model, fb.baseUrl, fb.apiKey ?? key, true);
    } catch {
      throw err;
    }
  }
}
