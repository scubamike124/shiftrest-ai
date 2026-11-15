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

export async function logAIRequest(
  admin: SupabaseClient,
  row: LogRow,
): Promise<void> {
  const { error } = await admin.from("ai_log").insert(row);
  if (error) console.error("ai_log insert failed", error);
}

/**
 * Daily token cap check. Fails CLOSED: if the budget RPC errors we cannot
 * prove the user is under the cap, so the paid provider must not be called.
 * Callers map "unavailable" to a retryable 503 (never a hard lock-out).
 */
export async function checkAIBudget(
  admin: SupabaseClient,
  userId: string,
): Promise<"ok" | "exhausted" | "unavailable"> {
  const { data, error } = await admin.rpc("has_ai_budget", { _user_id: userId });
  if (error) {
    console.error("has_ai_budget rpc failed", error);
    return "unavailable";
  }
  return data === true ? "ok" : "exhausted";
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
  let client = admin ?? null;
  if (!client) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (url && key) {
      client = createClient(url, key, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
    }
  }
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
