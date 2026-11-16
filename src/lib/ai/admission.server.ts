import { createClient } from "@supabase/supabase-js";
import { AI_REFUSAL, dailyLimitBody, rateLimitScope, rateLimitedBody } from "./refusal";

export type AdmissionClient = {
  rpc: (
    name: string,
    args: { _user_id: string; _token?: string },
  ) => PromiseLike<{ data: unknown; error: unknown }>;
};

/**
 * A route that can give its request back passes an empty object to
 * requireAIAdmission. It is filled only when the request was admitted.
 * refundProviderFailure never throws and gives back at most once.
 */
export type AIRefundHandle = {
  refundProviderFailure?: (status: number | null, signal?: AbortSignal) => Promise<boolean>;
};

/**
 * True when the provider gave the customer nothing for a reason that is not the
 * customer's doing: unreachable (null), its auth/credits/rate limit (401, 402,
 * 403, 408, 429) or its own fault (5xx). Any other 4xx is a request the provider
 * rejected, which may be the customer's input: never refunded.
 */
export function isRefundableProviderStatus(status: number | null): boolean {
  if (status === null) return true;
  if (!Number.isInteger(status)) return false;
  return status >= 500 || [401, 402, 403, 408, 429].includes(status);
}

const REFUND_TIMEOUT_MS = 2000;

function makeRefund(client: AdmissionClient, userId: string, token: string) {
  let spent = false;
  return async (status: number | null, signal?: AbortSignal): Promise<boolean> => {
    try {
      // Not on a client abort, not for a request the provider rejected, never twice here.
      if (spent || signal?.aborted || !isRefundableProviderStatus(status)) return false;
      spent = true;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const result = await Promise.race([
        Promise.resolve(client.rpc("refund_ai_request", { _user_id: userId, _token: token })),
        new Promise<null>((resolve) => {
          timer = setTimeout(() => resolve(null), REFUND_TIMEOUT_MS);
        }),
      ]);
      if (timer) clearTimeout(timer);
      const data = result?.data as { refunded?: unknown } | null | undefined;
      return !result?.error && data?.refunded === true;
    } catch {
      // A missing or failing refund must never fail the customer's request.
      return false;
    }
  };
}

/** One database-atomic shared allowance across chat, voice and avatar routes.
 * Never call a provider when configuration, budget checks or admission fail.
 * Request limits bound frequency; they are not a dollar-denominated spend cap.
 */
export async function checkAIAdmission(
  client: AdmissionClient,
  userId: string,
  handle?: AIRefundHandle,
): Promise<Response | null> {
  try {
    const budget = await client.rpc("has_ai_budget", { _user_id: userId });
    if (budget.error || typeof budget.data !== "boolean") return unavailable();
    // The user's own token allowance (rolling 24 hours). The ONLY refusal that may
    // carry an upgrade prompt on the client (never in the native app).
    if (!budget.data) return refuse(429, dailyLimitBody(), 3600);
    const result = await client.rpc("consume_ai_request", { _user_id: userId });
    if (result.error) return unavailable();
    const row = result.data as { allowed?: unknown; retry_after_seconds?: unknown } | null;
    if (!row || typeof row.allowed !== "boolean") return unavailable();
    if (row.allowed) {
      // consume_ai_request's opaque per-request token (absent before the refund
      // migration is applied: then there is simply nothing to give back).
      const token = (row as { token?: unknown }).token;
      if (handle && typeof token === "string" && token) {
        handle.refundProviderFailure = makeRefund(client, userId, token);
      }
      return null;
    }
    const seconds = row.retry_after_seconds;
    if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds < 1) return unavailable();
    // consume_ai_request's per-minute or per-UTC-day REQUEST limit: not the token allowance.
    const wait = Math.ceil(seconds);
    return refuse(429, rateLimitedBody(wait, rateLimitScope(wait)), wait);
  } catch {
    return unavailable();
  }
}

/** Fail closed: the allowance could not be verified. Retryable; says nothing about the user's limit. */
function unavailable() {
  return refuse(
    503,
    {
      error: "AI usage checks are temporarily unavailable. Please try again shortly.",
      code: AI_REFUSAL.BUDGET_UNAVAILABLE,
      retryable: true,
    },
    30,
  );
}

function refuse(status: 429 | 503, body: Record<string, unknown>, retryAfter: number) {
  return Response.json(body, {
    status,
    headers: { "Retry-After": String(retryAfter), "Cache-Control": "no-store" },
  });
}

export async function requireAIAdmission(
  userId: string,
  handle?: AIRefundHandle,
): Promise<Response | null> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return unavailable();
  try {
    const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    return await checkAIAdmission(client, userId, handle);
  } catch {
    return unavailable();
  }
}
