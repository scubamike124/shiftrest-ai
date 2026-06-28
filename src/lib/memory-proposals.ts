/**
 * Client-side CRUD for ai_memory_proposals and the learning pause flag.
 * RLS scopes everything to the signed-in user.
 */
import { supabase } from "@/integrations/supabase/client";
import type { MemoryCategory } from "@/lib/ai-memory";

export type MemoryProposal = {
  id: string;
  category: MemoryCategory;
  content: string;
  evidence: Record<string, unknown>;
  confidence: number;
  observedCount: number;
  dedupeKey: string;
  firstSeenAt: string;
  lastSeenAt: string;
  status: "pending" | "accepted" | "declined" | "expired";
};

type Row = {
  id: string;
  category: string;
  content: string;
  evidence: Record<string, unknown> | null;
  confidence: number;
  observed_count: number;
  dedupe_key: string;
  first_seen_at: string;
  last_seen_at: string;
  status: string;
};

function rowToProposal(r: Row): MemoryProposal {
  return {
    id: r.id,
    category: r.category as MemoryCategory,
    content: r.content,
    evidence: r.evidence ?? {},
    confidence: Number(r.confidence ?? 0.7),
    observedCount: r.observed_count ?? 0,
    dedupeKey: r.dedupe_key,
    firstSeenAt: r.first_seen_at,
    lastSeenAt: r.last_seen_at,
    status: (r.status as MemoryProposal["status"]) ?? "pending",
  };
}

const COLS =
  "id, category, content, evidence, confidence, observed_count, dedupe_key, first_seen_at, last_seen_at, status";

async function uid(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.user.id ?? null;
}

export async function listPendingProposals(): Promise<MemoryProposal[]> {
  const { data, error } = await supabase
    .from("ai_memory_proposals")
    .select(COLS)
    .eq("status", "pending")
    .order("confidence", { ascending: false })
    .order("last_seen_at", { ascending: false });
  if (error || !data) return [];
  return (data as Row[]).map(rowToProposal);
}

/** Accept → insert into ai_memory (source='derived'), mark proposal accepted. */
export async function acceptProposal(p: MemoryProposal): Promise<void> {
  const user = await uid();
  if (!user) throw new Error("Sign in required");

  // Dedupe: if an active memory with the same content already exists, skip insert.
  const { data: dup } = await supabase
    .from("ai_memory")
    .select("id")
    .eq("user_id", user)
    .ilike("content", p.content)
    .is("superseded_by", null)
    .maybeSingle();

  if (!dup) {
    const { error } = await supabase.from("ai_memory").insert({
      user_id: user,
      content: p.content.trim().slice(0, 280),
      category: p.category,
      source: "derived",
      confidence: p.confidence,
      importance: 3,
      embedding_hash: `proposal:${p.dedupeKey}`,
    } as never);
    if (error) throw error;
  }

  const { error: updErr } = await supabase
    .from("ai_memory_proposals")
    .update({ status: "accepted", decided_at: new Date().toISOString() } as never)
    .eq("id", p.id);
  if (updErr) throw updErr;
}

export async function declineProposal(id: string): Promise<void> {
  const { error } = await supabase
    .from("ai_memory_proposals")
    .update({ status: "declined", decided_at: new Date().toISOString() } as never)
    .eq("id", id);
  if (error) throw error;
}

export async function setLearningPaused(paused: boolean): Promise<void> {
  const user = await uid();
  if (!user) throw new Error("Sign in required");
  const { error } = await supabase
    .from("user_prefs")
    .upsert(
      { user_id: user, memory_learning_paused: paused },
      { onConflict: "user_id" },
    );
  if (error) throw error;
}

export async function getLearningPaused(): Promise<boolean> {
  const user = await uid();
  if (!user) return false;
  const { data } = await supabase
    .from("user_prefs")
    .select("memory_learning_paused")
    .eq("user_id", user)
    .maybeSingle();
  return Boolean((data as { memory_learning_paused?: boolean } | null)?.memory_learning_paused);
}

/** Fetch the top "sleep-domain" memories used by the Companion. */
export async function fetchCompanionHints(): Promise<{
  favoriteSoundTrack: string | null;
  bedtimeMemory: string | null;
}> {
  const user = await uid();
  if (!user) return { favoriteSoundTrack: null, bedtimeMemory: null };

  const { data } = await supabase
    .from("ai_memory")
    .select("content, category, embedding_hash")
    .eq("user_id", user)
    .is("superseded_by", null)
    .in("category", ["favorite_sounds", "sleep_habits"])
    .order("updated_at", { ascending: false })
    .limit(20);

  const rows = (data as Array<{ content: string; category: string; embedding_hash: string | null }> | null) ?? [];
  const fav = rows.find((r) => r.category === "favorite_sounds");
  const bed = rows.find((r) => r.category === "sleep_habits" && /bed/i.test(r.content));

  // Pull the track id from the dedupe-key form `proposal:sound:favorite:<id>` if present.
  let track: string | null = null;
  if (fav) {
    const m = (fav.embedding_hash || "").match(/sound:favorite:([\w-]+)/i);
    if (m) track = m[1];
    else {
      const w = fav.content.match(/listens to ([\w ]+?)(?:$|\.)/i);
      if (w) track = w[1].trim().toLowerCase().replace(/\s+/g, "_");
    }
  }
  return { favoriteSoundTrack: track, bedtimeMemory: bed?.content ?? null };
}
