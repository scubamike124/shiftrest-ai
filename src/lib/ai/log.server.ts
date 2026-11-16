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
  try {
    const { data, error } = await admin.rpc("has_ai_budget", { _user_id: userId });
    if (error) return false;
    return data === true;
  } catch {
    return false;
  }
}

/**
 * Conservative token estimate for text the provider did not meter (about 4
 * characters per token). Used only when a delivered chat turn has no usable
 * provider usage frame, so the turn still counts toward has_ai_budget.
 */
export const CHARS_PER_TOKEN = 4;
export const estimateTextTokens = (chars: number) =>
  Math.max(1, Math.ceil(Math.max(0, chars) / CHARS_PER_TOKEN));
