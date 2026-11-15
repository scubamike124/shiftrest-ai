/**
 * AI request logging + daily budget check.
 * Uses the service-role client because the orchestrator must write logs
 * regardless of the caller's RLS context.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

type LogRow = {
  user_id: string;
  intent: string;
  model: string;
  prompt_tokens: number;
  completion_tokens: number;
  latency_ms: number;
  status: string;
  error?: string;
};

function serviceClient(): SupabaseClient | null {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function logAIRequest(
  admin: SupabaseClient,
  row: LogRow,
): Promise<void> {
  const { error } = await admin.from("ai_log").insert(row);
  if (error) console.error("ai_log insert failed", error);
}

/** Max time to wait for the budget RPC before treating it as unavailable. */
export const BUDGET_RPC_TIMEOUT_MS = 4000;

/**
 * Daily token cap check. Fails CLOSED: if the budget RPC errors, throws, hangs
 * past BUDGET_RPC_TIMEOUT_MS, or returns anything other than a boolean, we
 * cannot prove the user is under the cap, so the paid provider must not be
 * called. Callers map "unavailable" to a retryable 503 (never a hard lock-out).
 */
export async function checkAIBudget(
  admin: SupabaseClient,
  userId: string,
): Promise<"ok" | "exhausted" | "unavailable"> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("has_ai_budget timeout")), BUDGET_RPC_TIMEOUT_MS);
    });
    const { data, error } = await Promise.race([
      Promise.resolve(admin.rpc("has_ai_budget", { _user_id: userId })),
      timeout,
    ]);
    if (error) {
      console.error("has_ai_budget rpc failed", error);
      return "unavailable";
    }
    if (data === true) return "ok";
    if (data === false) return "exhausted";
    console.error("has_ai_budget returned a non-boolean", typeof data);
    return "unavailable";
  } catch (e) {
    console.error("has_ai_budget rpc threw", e);
    return "unavailable";
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Usage accrual for routes whose provider does not report tokens. The daily cap
 * (has_ai_budget) sums ai_log.total_tokens, so every paid call must write a row.
 * Where the provider reports usage we use it; otherwise these conservative
 * token-equivalent estimates apply. One place, so they can be tuned together.
 */
export const USAGE_ESTIMATE = {
  /** Text: ~4 characters per token. */
  CHARS_PER_TOKEN: 4,
  /**
   * Token-equivalents are valued at $20 per 1M (voice-pricing.ts TOKEN_EQUIVALENT_USD).
   * OpenAI gpt-4o-mini-tts: ~$0.015/min of speech (~900 chars) => ~$0.017/1K chars
   * => ~1 character per token-equivalent (rounded up in cost).
   * Source: https://developers.openai.com/api/docs/pricing (2026-11-15).
   */
  TTS_CHARS_PER_TOKEN: 1,
  /** ElevenLabs Flash: $0.04 per 1K chars (https://elevenlabs.io/pricing/api) => 0.5 chars per token-equivalent. */
  ELEVENLABS_CHARS_PER_TOKEN: 0.5,
  /** Speech-to-text: token-equivalents per KB of uploaded audio, with a floor. */
  STT_TOKENS_PER_KB: 2,
  STT_MIN_TOKENS: 50,
  /** One live voice session mint (OpenAI Realtime) or Simli session token. */
  SESSION_MINT_TOKENS: 3000,
} as const;

export const estimateTextTokens = (chars: number) =>
  Math.max(1, Math.ceil(Math.max(0, chars) / USAGE_ESTIMATE.CHARS_PER_TOKEN));
export const estimateTtsTokens = (chars: number) =>
  Math.max(1, Math.ceil(Math.max(0, chars) / USAGE_ESTIMATE.TTS_CHARS_PER_TOKEN));
export const estimateElevenLabsTokens = (chars: number) =>
  Math.max(1, Math.ceil(Math.max(0, chars) / USAGE_ESTIMATE.ELEVENLABS_CHARS_PER_TOKEN));
export const estimateSttTokens = (bytes: number) =>
  Math.max(
    USAGE_ESTIMATE.STT_MIN_TOKENS,
    Math.ceil(Math.max(0, bytes) / 1024) * USAGE_ESTIMATE.STT_TOKENS_PER_KB,
  );

/** Best-effort usage row for the daily cap. Never throws, never blocks a response. */
export async function recordAIUsage(
  userId: string,
  row: {
    intent: string;
    model: string;
    promptTokens: number;
    completionTokens?: number;
    startedAt?: number;
  },
  admin?: SupabaseClient | null,
): Promise<void> {
  try {
    const client = admin ?? serviceClient();
    if (!client) return;
    await logAIRequest(client, {
      user_id: userId,
      intent: row.intent,
      model: row.model,
      prompt_tokens: Math.max(0, Math.round(row.promptTokens)),
      completion_tokens: Math.max(0, Math.round(row.completionTokens ?? 0)),
      latency_ms: row.startedAt ? Date.now() - row.startedAt : 0,
      status: "ok",
    });
  } catch (e) {
    console.error("recordAIUsage failed", e);
  }
}

/**
 * Route gate. Returns a refusal Response (429 over cap, 503 retryable when the
 * cap cannot be verified) or null when the request may proceed. Run it AFTER
 * consent and rate limit. Pass `admin` if the route already has one.
 */
export async function requireAIBudget(
  userId: string,
  admin?: SupabaseClient | null,
): Promise<Response | null> {
  const client = admin ?? serviceClient();
  const budget = client ? await checkAIBudget(client, userId) : "unavailable";
  if (budget === "ok") return null;
  const json = (status: number, body: Record<string, unknown>, extra?: Record<string, string>) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json", ...extra },
    });
  if (budget === "exhausted") {
    return json(429, { error: "Daily AI limit reached. It resets in 24 hours." });
  }
  return json(
    503,
    {
      error: "AI is temporarily unavailable. Please try again in a moment.",
      code: "ai_budget_unavailable",
      retryable: true,
    },
    { "Retry-After": "10" },
  );
}
