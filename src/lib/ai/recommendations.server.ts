/**
 * Persist + read AI recommendations + summarize feedback for the context
 * builder. Server-only.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

type StoreInput = {
  userId: string;
  intent: string;
  payload: Record<string, unknown>;
  patternId?: string | null;
};

const HEADLINE_FIELDS = ["action", "headline", "summary", "tip", "message"];
const RATIONALE_FIELDS = ["why", "reason", "rationale", "confidenceReason"];

function pickString(payload: Record<string, unknown>, keys: string[], fallback = ""): string {
  for (const k of keys) {
    const v = payload[k];
    if (typeof v === "string" && v.trim()) return v.slice(0, 280);
  }
  return fallback;
}

function pickConfidence(payload: Record<string, unknown>): number {
  const c = payload["confidence"];
  if (typeof c === "number") return Math.max(0, Math.min(1, c));
  if (c === "high") return 0.85;
  if (c === "medium") return 0.6;
  if (c === "low") return 0.35;
  return 0.5;
}

export async function persistRecommendation(
  admin: SupabaseClient,
  input: StoreInput,
): Promise<string | null> {
  const headline = pickString(input.payload, HEADLINE_FIELDS, input.intent);
  const rationale = pickString(input.payload, RATIONALE_FIELDS);
  const { data, error } = await admin
    .from("ai_recommendations")
    .insert({
      user_id: input.userId,
      intent: input.intent,
      headline,
      rationale: rationale || null,
      evidence_json: input.payload,
      confidence: pickConfidence(input.payload),
      pattern_id: input.patternId ?? null,
    } as never)
    .select("id")
    .single();
  if (error) {
    console.error("persistRecommendation failed", error);
    return null;
  }
  return (data as { id: string } | null)?.id ?? null;
}

export async function fetchPreviousRecommendation(
  admin: SupabaseClient,
  userId: string,
  intent: string,
): Promise<{ headline: string; rationale: string | null } | null> {
  const { data } = await admin
    .from("ai_recommendations")
    .select("headline, rationale")
    .eq("user_id", userId)
    .eq("intent", intent)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as { headline: string; rationale: string | null } | null) ?? null;
}

export type FeedbackSummary = {
  intent: string;
  helpful: number;
  not_helpful: number;
  ignored: number;
};

/** Aggregate the last 14d of feedback so the model can dampen ignored advice. */
export async function fetchFeedbackSummary(
  admin: SupabaseClient,
  userId: string,
): Promise<FeedbackSummary[]> {
  const since = new Date(Date.now() - 14 * 86_400_000).toISOString();
  const { data } = await admin
    .from("ai_feedback")
    .select("reaction, recommendation_id, ai_recommendations!inner(intent)")
    .eq("user_id", userId)
    .gte("created_at", since);
  const rows = (data as unknown as Array<{
    reaction: string;
    ai_recommendations: { intent: string } | { intent: string }[] | null;
  }> | null) ?? [];

  const counts = new Map<string, FeedbackSummary>();
  for (const r of rows) {
    const rec = Array.isArray(r.ai_recommendations) ? r.ai_recommendations[0] : r.ai_recommendations;
    const intent = rec?.intent;
    if (!intent) continue;
    const cur = counts.get(intent) ?? { intent, helpful: 0, not_helpful: 0, ignored: 0 };
    if (r.reaction === "helpful" || r.reaction === "already_did") cur.helpful++;
    else if (r.reaction === "not_helpful" || r.reaction === "dismissed_forever") cur.not_helpful++;
    else if (r.reaction === "ignored_today") cur.ignored++;
    counts.set(intent, cur);
  }
  return [...counts.values()];
}
