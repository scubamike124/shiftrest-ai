/**
 * Client-side CRUD + export/wipe for ai_memory.
 * All ops are scoped to the signed-in user by RLS.
 */
import { supabase } from "@/integrations/supabase/client";

export type MemoryCategory =
  | "general"
  | "schedule"
  | "health"
  | "preferences"
  | "employer"
  | "recovery"
  | "caffeine"
  | "family"
  | "goals"
  // Slice 5 — sleep-domain categories
  | "sleep_habits"
  | "alarm_prefs"
  | "favorite_sounds"
  | "daily_routine"
  | "companion_prefs";

export type AIMemory = {
  id: string;
  content: string;
  category: MemoryCategory;
  pinned: boolean;
  source: "chat" | "manual" | "derived" | "onboarding";
  importance: number;
  useCount: number;
  lastReferencedAt: string | null;
  expiresAt: string | null;
  supersededBy: string | null;
  createdAt: string;
  updatedAt: string;
};

type Row = {
  id: string;
  content: string;
  category: string;
  pinned: boolean;
  source: string;
  importance: number | null;
  use_count: number | null;
  last_referenced_at: string | null;
  expires_at: string | null;
  superseded_by: string | null;
  created_at: string;
  updated_at: string;
};

const COLS =
  "id, content, category, pinned, source, importance, use_count, last_referenced_at, expires_at, superseded_by, created_at, updated_at";

function rowToMemory(r: Row): AIMemory {
  return {
    id: r.id,
    content: r.content,
    category: r.category as MemoryCategory,
    pinned: r.pinned,
    source: r.source as AIMemory["source"],
    importance: r.importance ?? 3,
    useCount: r.use_count ?? 0,
    lastReferencedAt: r.last_referenced_at,
    expiresAt: r.expires_at,
    supersededBy: r.superseded_by,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

async function uid(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.user.id ?? null;
}

export type ListOpts = {
  query?: string;
  category?: MemoryCategory | "all";
  pinnedOnly?: boolean;
  includeArchived?: boolean;
};

export async function listMemories(opts: ListOpts = {}): Promise<AIMemory[]> {
  let q = supabase
    .from("ai_memory")
    .select(COLS)
    .order("pinned", { ascending: false })
    .order("updated_at", { ascending: false });

  if (!opts.includeArchived) q = q.is("superseded_by", null);
  if (opts.category && opts.category !== "all") q = q.eq("category", opts.category);
  if (opts.pinnedOnly) q = q.eq("pinned", true);
  if (opts.query && opts.query.trim().length > 0) {
    q = q.ilike("content", `%${opts.query.trim()}%`);
  }

  const { data, error } = await q;
  if (error || !data) return [];
  return (data as Row[]).map(rowToMemory);
}

export async function addMemory(
  content: string,
  category: MemoryCategory = "general",
  importance = 3,
): Promise<AIMemory | null> {
  const user = await uid();
  if (!user) return null;
  const { data, error } = await supabase
    .from("ai_memory")
    .insert({
      user_id: user,
      content: content.trim().slice(0, 280),
      category,
      source: "manual",
      confidence: 1,
      importance: Math.max(1, Math.min(5, Math.round(importance))),
    })
    .select(COLS)
    .single();
  if (error || !data) return null;
  return rowToMemory(data as Row);
}

export async function updateMemory(
  id: string,
  patch: Partial<
    Pick<AIMemory, "content" | "category" | "pinned" | "importance" | "expiresAt">
  >,
): Promise<void> {
  const row: {
    content?: string;
    category?: MemoryCategory;
    pinned?: boolean;
    importance?: number;
    expires_at?: string | null;
  } = {};
  if (patch.content !== undefined) row.content = patch.content.trim().slice(0, 280);
  if (patch.category !== undefined) row.category = patch.category;
  if (patch.pinned !== undefined) row.pinned = patch.pinned;
  if (patch.importance !== undefined)
    row.importance = Math.max(1, Math.min(5, Math.round(patch.importance)));
  if (patch.expiresAt !== undefined) row.expires_at = patch.expiresAt;
  if (Object.keys(row).length === 0) return;
  const { error } = await supabase.from("ai_memory").update(row).eq("id", id);
  if (error) throw error;
}

export async function deleteMemory(id: string): Promise<void> {
  const { error } = await supabase.from("ai_memory").delete().eq("id", id);
  if (error) throw error;
}

export async function wipeAllMemories(): Promise<number> {
  const user = await uid();
  if (!user) return 0;
  const { data, error } = await supabase
    .from("ai_memory")
    .delete()
    .eq("user_id", user)
    .select("id");
  if (error) throw error;
  return data?.length ?? 0;
}

/** JSON export — user owns their memory and can take it with them. */
export async function exportMemoriesAsJSON(): Promise<string> {
  const mems = await listMemories({ includeArchived: true });
  return JSON.stringify(
    {
      exported_at: new Date().toISOString(),
      count: mems.length,
      memories: mems,
    },
    null,
    2,
  );
}

/** Toggle long-term memory on/off (writes user_prefs.memory_enabled). */
export async function setMemoryEnabled(enabled: boolean): Promise<void> {
  const user = await uid();
  if (!user) return;
  const { error } = await supabase
    .from("user_prefs")
    .upsert(
      { user_id: user, memory_enabled: enabled },
      { onConflict: "user_id" },
    );
  if (error) throw error;
}

export async function getMemoryEnabled(): Promise<boolean> {
  const user = await uid();
  if (!user) return false;
  const { data } = await supabase
    .from("user_prefs")
    .select("memory_enabled")
    .eq("user_id", user)
    .maybeSingle();
  return Boolean(data?.memory_enabled);
}
