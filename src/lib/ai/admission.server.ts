import { createClient } from "@supabase/supabase-js";
import { AI_REFUSAL, dailyLimitBody, rateLimitScope, rateLimitedBody } from "./refusal";

export type AdmissionClient = {
  rpc: (name: string, args: { _user_id: string }) => PromiseLike<{ data: unknown; error: unknown }>;
};

/** One database-atomic shared allowance across chat, voice and avatar routes.
 * Never call a provider when configuration, budget checks or admission fail.
 * Request limits bound frequency; they are not a dollar-denominated spend cap.
 */
export async function checkAIAdmission(client: AdmissionClient, userId: string): Promise<Response | null> {
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
    if (row.allowed) return null;
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

export async function requireAIAdmission(userId: string): Promise<Response | null> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return unavailable();
  try {
    const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    return await checkAIAdmission(client, userId);
  } catch {
    return unavailable();
  }
}
