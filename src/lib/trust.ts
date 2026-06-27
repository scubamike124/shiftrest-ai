/**
 * Trust Layer helpers — normalizing confidence values and fetching
 * recommendation evidence/history for the detail sheet + WhatChanged diff.
 */
import { supabase } from "@/integrations/supabase/client";

export type ConfidenceLevel = "low" | "medium" | "high";
export type ConfidenceInput = number | ConfidenceLevel | null | undefined;

export type TrustChange = {
  label: string;
  from: string;
  to: string;
  reason?: string;
};

export type RecommendationDetail = {
  id: string;
  intent: string;
  headline: string;
  rationale: string | null;
  confidence: number;
  evidence: Record<string, unknown>;
  predictedImpact: Record<string, unknown>;
  createdAt: string;
  patternId: string | null;
};

/** Normalize any confidence input to a 0–1 score. */
export function normalizeConfidence(input: ConfidenceInput): number | null {
  if (input == null) return null;
  if (typeof input === "number") return Math.max(0, Math.min(1, input));
  if (input === "high") return 0.85;
  if (input === "medium") return 0.6;
  if (input === "low") return 0.35;
  return null;
}

export function confidenceLabel(score: number | null): ConfidenceLevel | null {
  if (score == null) return null;
  if (score >= 0.75) return "high";
  if (score >= 0.5) return "medium";
  return "low";
}

/** Heuristic readable list of data sources for an evidence_json blob. */
const SOURCE_LABELS: Record<string, string> = {
  shifts: "Your shift schedule",
  shift: "Your shift schedule",
  upcomingShifts: "Upcoming shifts",
  trip: "Active trip plan",
  trips: "Trip history",
  tz: "Timezone state",
  sun: "Local sunrise & sunset",
  weather: "Local weather",
  commute: "Commute window",
  wearable: "Connected wearable",
  hrv: "Recent HRV",
  sleep: "Recent sleep log",
  sleepDebt: "Sleep debt trend",
  caffeine: "Caffeine cutoff window",
  patterns: "Detected patterns",
  pattern: "Detected pattern",
  memories: "Your saved AI memory",
  prefs: "Your preferences",
  feedback: "Your past feedback",
  events: "Calendar events",
};

export function deriveSources(evidence: Record<string, unknown> | null | undefined): string[] {
  if (!evidence || typeof evidence !== "object") return [];
  const seen = new Set<string>();
  const out: string[] = [];
  const visit = (key: string) => {
    const label = SOURCE_LABELS[key];
    if (label && !seen.has(label)) {
      seen.add(label);
      out.push(label);
    }
  };
  for (const k of Object.keys(evidence)) visit(k);
  // Nested object: one level deep
  for (const v of Object.values(evidence)) {
    if (v && typeof v === "object" && !Array.isArray(v)) {
      for (const k of Object.keys(v as Record<string, unknown>)) visit(k);
    }
  }
  return out;
}

/** Fetch a recommendation row (RLS scoped to current user). */
export async function fetchRecommendation(id: string): Promise<RecommendationDetail | null> {
  const { data, error } = await supabase
    .from("ai_recommendations")
    .select("id, intent, headline, rationale, confidence, evidence_json, predicted_impact_json, created_at, pattern_id")
    .eq("id", id)
    .maybeSingle();
  if (error || !data) return null;
  const row = data as {
    id: string;
    intent: string;
    headline: string;
    rationale: string | null;
    confidence: number;
    evidence_json: unknown;
    predicted_impact_json: unknown;
    created_at: string;
    pattern_id: string | null;
  };
  return {
    id: row.id,
    intent: row.intent,
    headline: row.headline,
    rationale: row.rationale,
    confidence: row.confidence,
    evidence: (row.evidence_json as Record<string, unknown>) ?? {},
    predictedImpact: (row.predicted_impact_json as Record<string, unknown>) ?? {},
    createdAt: row.created_at,
    patternId: row.pattern_id,
  };
}

/** Fetch the previous recommendation for the same intent (for WhatChanged). */
export async function fetchPreviousForIntent(
  intent: string,
  currentId: string,
): Promise<{ headline: string; rationale: string | null; createdAt: string } | null> {
  const { data: session } = await supabase.auth.getSession();
  const uid = session.session?.user.id;
  if (!uid) return null;
  const { data } = await supabase
    .from("ai_recommendations")
    .select("headline, rationale, created_at")
    .eq("user_id", uid)
    .eq("intent", intent)
    .neq("id", currentId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  const row = data as { headline: string; rationale: string | null; created_at: string };
  return { headline: row.headline, rationale: row.rationale, createdAt: row.created_at };
}
