/**
 * AI request logging + daily budget check.
 * Uses the service-role client because the orchestrator must write logs
 * regardless of the caller's RLS context.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

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

/** Returns true if the user is under their daily token cap. */
export async function checkAIBudget(
  admin: SupabaseClient,
  userId: string,
): Promise<boolean> {
  const { data, error } = await admin.rpc("has_ai_budget", { _user_id: userId });
  if (error) {
    console.error("has_ai_budget rpc failed", error);
    return true; // fail-open: don't lock users out on a logging failure
  }
  return data === true;
}
