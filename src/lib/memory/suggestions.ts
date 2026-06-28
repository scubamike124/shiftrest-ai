/**
 * Phase 6 — Routine Suggestions (cross-skill).
 *
 * Client-side CRUD scoped by RLS to the signed-in user.
 */
import { supabase } from "@/integrations/supabase/client";

export type RoutineStep =
  | { type: "quiet_mode_on" }
  | { type: "quiet_mode_off" }
  | { type: "play_sound"; track: string }
  | { type: "stop_sound" }
  | { type: "set_alarm"; time: string }
  | { type: "set_timer"; minutes: number }
  | { type: "start_sleep_mode" }
  | { type: "departure_reminder"; minutes_before: number }
  | { type: "note"; text: string };

export type RoutineSuggestion = {
  id: string;
  kind: "bedtime" | "wake" | "quiet_mode" | "departure" | "weather" | "calendar" | string;
  title: string;
  reason: string;
  signals: Record<string, unknown>;
  proposedSteps: RoutineStep[];
  dedupeKey: string;
  status: "pending" | "accepted" | "dismissed" | "snoozed" | "expired";
  snoozedUntil: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
};

type Row = {
  id: string;
  kind: string;
  title: string;
  reason: string;
  signals: Record<string, unknown> | null;
  proposed_steps: unknown;
  dedupe_key: string;
  status: string;
  snoozed_until: string | null;
  first_seen_at: string;
  last_seen_at: string;
};

const COLS =
  "id, kind, title, reason, signals, proposed_steps, dedupe_key, status, snoozed_until, first_seen_at, last_seen_at";

function rowToSuggestion(r: Row): RoutineSuggestion {
  return {
    id: r.id,
    kind: r.kind,
    title: r.title,
    reason: r.reason,
    signals: r.signals ?? {},
    proposedSteps: Array.isArray(r.proposed_steps) ? (r.proposed_steps as RoutineStep[]) : [],
    dedupeKey: r.dedupe_key,
    status: (r.status as RoutineSuggestion["status"]) ?? "pending",
    snoozedUntil: r.snoozed_until,
    firstSeenAt: r.first_seen_at,
    lastSeenAt: r.last_seen_at,
  };
}

export async function listPendingRoutineSuggestions(): Promise<RoutineSuggestion[]> {
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("routine_suggestions")
    .select(COLS)
    .in("status", ["pending", "snoozed"])
    .or(`snoozed_until.is.null,snoozed_until.lte.${now}`)
    .order("last_seen_at", { ascending: false });
  if (error || !data) return [];
  return (data as Row[]).map(rowToSuggestion);
}

export async function acceptRoutineSuggestion(id: string): Promise<void> {
  const { error } = await supabase
    .from("routine_suggestions")
    .update({ status: "accepted", decided_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}

export async function dismissRoutineSuggestion(id: string): Promise<void> {
  const { error } = await supabase
    .from("routine_suggestions")
    .update({ status: "dismissed", decided_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}

export async function snoozeRoutineSuggestion(id: string, days = 7): Promise<void> {
  const until = new Date(Date.now() + days * 86_400_000).toISOString();
  const { error } = await supabase
    .from("routine_suggestions")
    .update({ status: "snoozed", snoozed_until: until })
    .eq("id", id);
  if (error) throw error;
}
