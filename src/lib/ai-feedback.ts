/**
 * Client-side helpers for the predictive AI loop (Step 3).
 * - Submit feedback on a recommendation
 * - List active patterns + mute / delete them
 * All RLS-scoped to the signed-in user.
 */
import { supabase } from "@/integrations/supabase/client";

export type FeedbackReaction =
  | "helpful"
  | "not_helpful"
  | "already_did"
  | "ignored_today"
  | "dismissed_forever";

export async function submitFeedback(input: {
  recommendationId: string;
  reaction: FeedbackReaction;
  note?: string;
}): Promise<void> {
  const { data: session } = await supabase.auth.getSession();
  const uid = session.session?.user.id;
  if (!uid) throw new Error("Sign in to send feedback");
  const { error } = await supabase.from("ai_feedback").insert({
    user_id: uid,
    recommendation_id: input.recommendationId,
    reaction: input.reaction,
    note: input.note ?? null,
  } as never);
  if (error) throw error;

  // Dismissed forever → mute the linked pattern for 30 days, if any.
  if (input.reaction === "dismissed_forever") {
    const { data: rec } = await supabase
      .from("ai_recommendations")
      .select("pattern_id")
      .eq("id", input.recommendationId)
      .maybeSingle();
    const patternId = (rec as { pattern_id: string | null } | null)?.pattern_id;
    if (patternId) {
      const muted = new Date(Date.now() + 30 * 86_400_000).toISOString();
      await supabase
        .from("ai_patterns")
        .update({ muted_until: muted } as never)
        .eq("id", patternId);
    }
  }
}

export type AIPattern = {
  id: string;
  patternKey: string;
  severity: number;
  signals: Record<string, unknown>;
  lastSeenAt: string;
  occurrences: number;
  mutedUntil: string | null;
};

type PatternRow = {
  id: string;
  pattern_key: string;
  severity: number;
  signals_json: Record<string, unknown> | null;
  last_seen_at: string;
  occurrences: number;
  muted_until: string | null;
};

export async function listPatterns(): Promise<AIPattern[]> {
  const { data, error } = await supabase
    .from("ai_patterns")
    .select("id, pattern_key, severity, signals_json, last_seen_at, occurrences, muted_until")
    .eq("active", true)
    .order("severity", { ascending: false })
    .order("last_seen_at", { ascending: false });
  if (error) throw error;
  return ((data as PatternRow[] | null) ?? []).map((r) => ({
    id: r.id,
    patternKey: r.pattern_key,
    severity: r.severity,
    signals: r.signals_json ?? {},
    lastSeenAt: r.last_seen_at,
    occurrences: r.occurrences,
    mutedUntil: r.muted_until,
  }));
}

export async function mutePattern(id: string, days = 30): Promise<void> {
  const muted = new Date(Date.now() + days * 86_400_000).toISOString();
  const { error } = await supabase
    .from("ai_patterns")
    .update({ muted_until: muted } as never)
    .eq("id", id);
  if (error) throw error;
}

export async function deletePattern(id: string): Promise<void> {
  const { error } = await supabase.from("ai_patterns").delete().eq("id", id);
  if (error) throw error;
}

export const PATTERN_LABELS: Record<string, { title: string; tone: string }> = {
  sleep_debt_3d: { title: "Sleep debt building up", tone: "rose" },
  rotation_change: { title: "Rotation just flipped", tone: "indigo" },
  frequent_overtime: { title: "Heavier-than-usual schedule", tone: "amber" },
  timezone_jump: { title: "Timezone change detected", tone: "indigo" },
  missed_recovery: { title: "Recovery window missed", tone: "amber" },
  caffeine_late: { title: "Late caffeine pattern", tone: "amber" },
  missed_alarms: { title: "Alarm sleep-throughs", tone: "amber" },
  commute_fatigue: { title: "Post-shift commute risk", tone: "rose" },
  hrv_decline: { title: "HRV trending lower", tone: "rose" },
  sleep_inconsistency: { title: "Sleep timing is drifting", tone: "amber" },
};
