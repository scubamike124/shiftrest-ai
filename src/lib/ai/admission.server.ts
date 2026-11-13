import { createClient } from "@supabase/supabase-js";

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
    if (!budget.data) return limited(3600, "Daily AI allowance reached. Try again later.");
    const result = await client.rpc("consume_ai_request", { _user_id: userId });
    if (result.error) return unavailable();
    const row = result.data as { allowed?: unknown; retry_after_seconds?: unknown } | null;
    if (!row || typeof row.allowed !== "boolean") return unavailable();
    if (row.allowed) return null;
    const seconds = row.retry_after_seconds;
    if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds < 1) return unavailable();
    return limited(Math.ceil(seconds), "AI request limit reached. Please try again later.");
  } catch {
    return unavailable();
  }
}

function unavailable() {
  return Response.json({ error: "AI usage checks are temporarily unavailable. Please try again shortly." }, {
    status: 503, headers: { "Retry-After": "30", "Cache-Control": "no-store" },
  });
}

function limited(seconds: number, error: string) {
  return Response.json({ error }, {
    status: 429, headers: { "Retry-After": String(seconds), "Cache-Control": "no-store" },
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
