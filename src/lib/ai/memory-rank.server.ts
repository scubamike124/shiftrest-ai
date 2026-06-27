/**
 * Pure-TS ranker for ai_memory rows. No LLM call — runs on every
 * system-prompt build to pick the most useful long-term facts to inject.
 *
 * Used by context.server.ts. Keeps fetchRelevantMemories cheap (one query,
 * one in-memory sort, one fire-and-forget UPDATE).
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export type RankedMemory = {
  id: string;
  content: string;
  category: string;
  pinned: boolean;
  importance: number;
  confidence: number;
  use_count: number;
  last_referenced_at: string | null;
  updated_at: string;
  expires_at: string | null;
  superseded_by: string | null;
  score: number;
};

type Row = Omit<RankedMemory, "score">;

/** Maps each intent → categories that should get a relevance bump. */
const INTENT_RELEVANCE: Record<string, Set<string>> = {
  right_now: new Set(["caffeine", "recovery", "health", "preferences"]),
  smart_alarm: new Set(["schedule", "health", "recovery"]),
  daily_plan: new Set(["schedule", "caffeine", "recovery", "goals"]),
  commute: new Set(["schedule", "employer"]),
  brief: new Set(["schedule", "recovery", "preferences"]),
  coach_tip: new Set(["goals", "preferences", "recovery"]),
  adjust_plan: new Set(["schedule", "recovery", "caffeine"]),
  coach: new Set(), // general chat — no category bias
};

function halfLifeDecay(iso: string | null, halfLifeDays: number): number {
  if (!iso) return 0;
  const ageDays = (Date.now() - new Date(iso).getTime()) / 86_400_000;
  if (ageDays < 0) return 1;
  return Math.pow(0.5, ageDays / halfLifeDays);
}

export function scoreMemory(row: Row, intent: string): number {
  const now = Date.now();
  const expired =
    row.expires_at && new Date(row.expires_at).getTime() < now ? 1 : 0;
  const superseded = row.superseded_by ? 1 : 0;
  const categoryBoost = (INTENT_RELEVANCE[intent] ?? new Set()).has(row.category)
    ? 1
    : 0;

  return (
    1.6 * (row.pinned ? 1 : 0) +
    1.0 * (row.importance / 5) +
    0.8 * row.confidence +
    0.6 * halfLifeDecay(row.updated_at, 60) +
    0.4 * halfLifeDecay(row.last_referenced_at, 30) +
    0.3 * (Math.log1p(row.use_count) / 3) +
    1.2 * categoryBoost -
    2.0 * expired -
    5.0 * superseded
  );
}

export type FetchOpts = {
  intent?: string;
  limit?: number;
  poolSize?: number;
};

export async function fetchRankedMemories(
  admin: SupabaseClient,
  userId: string,
  opts: FetchOpts = {},
): Promise<RankedMemory[]> {
  const intent = opts.intent ?? "coach";
  const limit = opts.limit ?? 25;
  const pool = opts.poolSize ?? 80;

  const { data, error } = await admin
    .from("ai_memory")
    .select(
      "id, content, category, pinned, importance, confidence, use_count, last_referenced_at, updated_at, expires_at, superseded_by",
    )
    .eq("user_id", userId)
    .is("superseded_by", null)
    .order("pinned", { ascending: false })
    .order("updated_at", { ascending: false })
    .limit(pool);

  if (error || !data) return [];

  const ranked = (data as Row[])
    .map((r) => ({ ...r, score: scoreMemory(r, intent) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  // Fire-and-forget usage bump for the chosen rows.
  if (ranked.length > 0) {
    const ids = ranked.map((r) => r.id);
    const nowIso = new Date().toISOString();
    void (async () => {
      try {
        await admin
          .from("ai_memory")
          .update({ last_referenced_at: nowIso })
          .in("id", ids);
        for (const r of ranked) {
          await admin
            .from("ai_memory")
            .update({ use_count: (r.use_count ?? 0) + 1 })
            .eq("id", r.id);
        }
      } catch {
        // best-effort; never fail the prompt build over a usage bump
      }
    })();
  }

  return ranked;
}
