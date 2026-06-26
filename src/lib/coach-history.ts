import { supabase } from "@/integrations/supabase/client";

export type CoachRole = "user" | "assistant";
export type CoachMsg = { role: CoachRole; content: string };

async function uid(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.user.id ?? null;
}

/** Load up to the most recent 100 messages for the signed-in user, oldest first. Guests get []. */
export async function fetchCoachHistory(): Promise<CoachMsg[]> {
  const user = await uid();
  if (!user) return [];
  const { data, error } = await supabase
    .from("coach_messages")
    .select("role, content, created_at")
    .eq("user_id", user)
    .order("created_at", { ascending: false })
    .limit(100);
  if (error || !data) return [];
  return data
    .slice()
    .reverse()
    .map((r) => ({ role: r.role as CoachRole, content: r.content }));
}

/** Persist a single message. No-op for guests. */
export async function saveCoachMessage(role: CoachRole, content: string): Promise<void> {
  const user = await uid();
  if (!user) return;
  const trimmed = content.trim();
  if (!trimmed) return;
  await supabase.from("coach_messages").insert({ user_id: user, role, content: trimmed });
}

/** Wipe all coach history for the current user (used by account deletion fallback). */
export async function clearCoachHistory(): Promise<void> {
  const user = await uid();
  if (!user) return;
  await supabase.from("coach_messages").delete().eq("user_id", user);
}
