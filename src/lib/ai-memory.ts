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
  | "goals";

export type AIMemory = {
  id: string;
  content: string;
  category: MemoryCategory;
  pinned: boolean;
  source: "chat" | "manual" | "derived" | "onboarding";
  createdAt: string;
  updatedAt: string;
};

type Row = {
  id: string;
  content: string;
  category: string;
  pinned: boolean;
  source: string;
  created_at: string;
  updated_at: string;
};

function rowToMemory(r: Row): AIMemory {
  return {
    id: r.id,
    content: r.content,
    category: r.category as MemoryCategory,
    pinned: r.pinned,
    source: r.source as AIMemory["source"],
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

async function uid(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.user.id ?? null;
}

export async function listMemories(): Promise<AIMemory[]> {
  const { data, error } = await supabase
    .from("ai_memory")
    .select("id, content, category, pinned, source, created_at, updated_at")
    .order("pinned", { ascending: false })
    .order("updated_at", { ascending: false });
  if (error || !data) return [];
  return (data as Row[]).map(rowToMemory);
}

export async function addMemory(
  content: string,
  category: MemoryCategory = "general",
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
    })
    .select("id, content, category, pinned, source, created_at, updated_at")
    .single();
  if (error || !data) return null;
  return rowToMemory(data as Row);
}

export async function updateMemory(
  id: string,
  patch: Partial<Pick<AIMemory, "content" | "category" | "pinned">>,
): Promise<void> {
  const row: {
    content?: string;
    category?: MemoryCategory;
    pinned?: boolean;
  } = {};
  if (patch.content !== undefined) row.content = patch.content.trim().slice(0, 280);
  if (patch.category !== undefined) row.category = patch.category;
  if (patch.pinned !== undefined) row.pinned = patch.pinned;
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
  const mems = await listMemories();
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
