/**
 * Bundle 2 — AI Decision Center
 *
 * Client-side hooks that turn the existing `ai_recommendations` and `ai_log`
 * tables into a unified "what the AI did today" feed. Pure reads on top of
 * data already being written; no new server logic, no new tables.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { submitFeedback } from "@/lib/ai-feedback";

export type Decision = {
  id: string;
  intent: string;
  headline: string;
  rationale: string | null;
  confidence: number | null;
  evidence: Record<string, unknown>;
  predictedImpact: Record<string, unknown>;
  createdAt: string;
  patternId: string | null;
  /** Most recent feedback reaction the user has left on this decision, if any. */
  reaction:
    | "helpful"
    | "not_helpful"
    | "already_did"
    | "ignored_today"
    | "dismissed_forever"
    | null;
};

export type ActivityEvent = {
  id: string;
  kind: "decision" | "system";
  intent: string;
  label: string;
  sublabel?: string | null;
  at: string;
  decisionId?: string | null;
  /** How many raw events this row collapses (>=1). */
  count?: number;
};

const INTENT_LABELS: Record<string, string> = {
  right_now: "Coach window updated",
  daily_plan: "Plan recalculated",
  tomorrow_preview: "Tomorrow preview built",
  daily_review: "Today's recap generated",
  smart_alarm: "Alarm optimized",
  commute: "Commute reassessed",
  coach_tip: "Coach tip refreshed",
  light_plan: "Light plan adjusted",
  jetlag_plan: "Jet-lag plan updated",
  companion_whisper: "Companion check-in",
  pattern_alert: "Pattern detected",
  caffeine: "Caffeine cutoff adjusted",
  recovery: "Recovery recalculated",
  sync: "Sleep data synchronized",
  sleep_plan: "Sleep window refined",
};

export function intentLabel(intent: string): string {
  return (
    INTENT_LABELS[intent] ??
    intent.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase())
  );
}

function startOfLocalDayIso(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

type RecRow = {
  id: string;
  intent: string;
  headline: string;
  rationale: string | null;
  confidence: number | null;
  evidence_json: unknown;
  predicted_impact_json: unknown;
  created_at: string;
  pattern_id: string | null;
};

type FeedbackRow = {
  recommendation_id: string;
  reaction: Decision["reaction"];
  created_at: string;
};

type LogRow = {
  id: string;
  intent: string;
  status: string | null;
  created_at: string;
};

async function getUid(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.user.id ?? null;
}

async function loadTodayDecisions(): Promise<Decision[]> {
  const uid = await getUid();
  if (!uid) return [];
  const since = startOfLocalDayIso();
  const { data, error } = await supabase
    .from("ai_recommendations")
    .select(
      "id, intent, headline, rationale, confidence, evidence_json, predicted_impact_json, created_at, pattern_id",
    )
    .eq("user_id", uid)
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(80);
  if (error) throw error;
  const rows = (data as RecRow[] | null) ?? [];
  if (rows.length === 0) return [];

  const ids = rows.map((r) => r.id);
  const { data: fbData } = await supabase
    .from("ai_feedback")
    .select("recommendation_id, reaction, created_at")
    .in("recommendation_id", ids)
    .order("created_at", { ascending: false });
  const reactionById = new Map<string, Decision["reaction"]>();
  for (const f of (fbData as FeedbackRow[] | null) ?? []) {
    if (!reactionById.has(f.recommendation_id)) reactionById.set(f.recommendation_id, f.reaction);
  }

  return rows.map((r) => ({
    id: r.id,
    intent: r.intent,
    headline: r.headline,
    rationale: r.rationale,
    confidence: r.confidence,
    evidence: (r.evidence_json as Record<string, unknown>) ?? {},
    predictedImpact: (r.predicted_impact_json as Record<string, unknown>) ?? {},
    createdAt: r.created_at,
    patternId: r.pattern_id,
    reaction: reactionById.get(r.id) ?? null,
  }));
}

export function useTodayDecisions() {
  return useQuery({
    queryKey: ["ai", "decisions", "today"],
    queryFn: loadTodayDecisions,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });
}

async function loadTodayActivity(): Promise<ActivityEvent[]> {
  const uid = await getUid();
  if (!uid) return [];
  const since = startOfLocalDayIso();

  const [recRes, logRes] = await Promise.all([
    supabase
      .from("ai_recommendations")
      .select("id, intent, headline, created_at")
      .eq("user_id", uid)
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(60),
    supabase
      .from("ai_log")
      .select("id, intent, status, created_at")
      .eq("user_id", uid)
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(60),
  ]);

  const recRows = (recRes.data as Array<{
    id: string;
    intent: string;
    headline: string;
    created_at: string;
  }> | null) ?? [];
  const logRows = (logRes.data as LogRow[] | null) ?? [];

  const decisionLogIntents = new Set(recRows.map((r) => `${r.intent}|${r.created_at.slice(0, 16)}`));

  const events: ActivityEvent[] = [];
  for (const r of recRows) {
    events.push({
      id: `dec-${r.id}`,
      kind: "decision",
      intent: r.intent,
      label: intentLabel(r.intent),
      sublabel: r.headline,
      at: r.created_at,
      decisionId: r.id,
    });
  }
  for (const l of logRows) {
    // De-dup: every recommendation also writes a log row. Skip log rows that
    // already have a matching decision in the same minute.
    if (decisionLogIntents.has(`${l.intent}|${l.created_at.slice(0, 16)}`)) continue;
    events.push({
      id: `log-${l.id}`,
      kind: "system",
      intent: l.intent,
      label: intentLabel(l.intent),
      sublabel: l.status === "error" ? "Retry pending" : null,
      at: l.created_at,
    });
  }

  events.sort((a, b) => b.at.localeCompare(a.at));

  // Collapse adjacent system events of the same intent (e.g. repeated `sync`)
  // into a single row with a count. Decisions are never collapsed.
  const COLLAPSIBLE = new Set(["sync", "recovery", "coach_tip", "light_plan"]);
  const collapsed: ActivityEvent[] = [];
  for (const e of events) {
    const last = collapsed[collapsed.length - 1];
    if (
      last &&
      e.kind === "system" &&
      last.kind === "system" &&
      last.intent === e.intent &&
      COLLAPSIBLE.has(e.intent)
    ) {
      last.count = (last.count ?? 1) + 1;
      // Keep the earliest timestamp's sublabel; just bump the badge.
      continue;
    }
    collapsed.push({ ...e, count: 1 });
  }
  return collapsed.slice(0, 50);
}

export function useTodayActivity() {
  return useQuery({
    queryKey: ["ai", "activity", "today"],
    queryFn: loadTodayActivity,
    staleTime: 30_000,
  });
}

const LAST_VISIT_KEY = "rp_last_visit_v1";

/**
 * Returns "how many decisions has the AI made since the user last opened
 * the dashboard?". Reads the previous visit timestamp first, then writes
 * the new one — so the very next mount sees the up-to-date baseline.
 */
export function useDecisionsSinceLastVisit(): {
  total: number;
  sinceLastVisit: number;
  lastVisitAt: string | null;
} {
  const { data: decisions } = useTodayDecisions();
  const [lastVisit, setLastVisit] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const prev = window.localStorage.getItem(LAST_VISIT_KEY);
    setLastVisit(prev);
    window.localStorage.setItem(LAST_VISIT_KEY, new Date().toISOString());
  }, []);

  const total = decisions?.length ?? 0;
  const since = lastVisit
    ? (decisions ?? []).filter((d) => d.createdAt > lastVisit).length
    : total;

  return { total, sinceLastVisit: since, lastVisitAt: lastVisit };
}

/** Soonest decision whose evidence timeWindow.startIso is still in the future. */
export function useNextDecision(): Decision | null {
  const { data } = useTodayDecisions();
  if (!data) return null;
  const now = Date.now();
  let best: { d: Decision; at: number } | null = null;
  for (const d of data) {
    const ev = d.evidence as { timeWindow?: { startIso?: string } } | null;
    const start = ev?.timeWindow?.startIso;
    if (!start) continue;
    const at = Date.parse(start);
    if (Number.isNaN(at) || at <= now) continue;
    if (!best || at < best.at) best = { d, at };
  }
  return best?.d ?? null;
}

/** Most-recent decision per intent (for mapping into the Long Clock). */
export function useDecisionsByIntent(): Record<string, Decision> {
  const { data } = useTodayDecisions();
  const map: Record<string, Decision> = {};
  for (const d of data ?? []) {
    if (!map[d.intent]) map[d.intent] = d;
  }
  return map;
}

export type ActionKind = "accept" | "snooze" | "ignore";

const REACTION_MAP: Record<ActionKind, "helpful" | "ignored_today" | "dismissed_forever"> = {
  accept: "helpful",
  snooze: "ignored_today",
  ignore: "dismissed_forever",
};

export function useRecommendationActions() {
  const qc = useQueryClient();
  return async (recommendationId: string, action: ActionKind) => {
    await submitFeedback({ recommendationId, reaction: REACTION_MAP[action] });
    await qc.invalidateQueries({ queryKey: ["ai", "decisions", "today"] });
  };
}
