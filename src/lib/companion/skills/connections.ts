// Slice 12 — Step 1 (Foundation). Browser-side CRUD for companion_skills.
// Uses the publishable Supabase client; RLS scopes every read/write to the
// signed-in user. No service-role access anywhere on the client.

import { supabase } from "@/integrations/supabase/client";

export interface SkillConnection {
  skill: string;
  status: "connected" | "disabled" | "disconnected";
  config: Record<string, unknown>;
  connectedAt: string;
  updatedAt: string;
}

interface Row {
  skill: string;
  status: string;
  config: Record<string, unknown> | null;
  connected_at: string;
  updated_at: string;
}

function rowToConnection(row: Row): SkillConnection {
  const status =
    row.status === "connected" || row.status === "disabled" || row.status === "disconnected"
      ? (row.status as SkillConnection["status"])
      : "disconnected";
  return {
    skill: row.skill,
    status,
    config: row.config ?? {},
    connectedAt: row.connected_at,
    updatedAt: row.updated_at,
  };
}

export async function listSkillConnections(): Promise<SkillConnection[]> {
  const { data: session } = await supabase.auth.getSession();
  const uid = session.session?.user.id;
  if (!uid) return [];
  const { data, error } = await supabase
    .from("companion_skills")
    .select("skill, status, config, connected_at, updated_at")
    .eq("user_id", uid);
  if (error) {
    console.error("listSkillConnections failed", error);
    return [];
  }
  return (data as Row[]).map(rowToConnection);
}

export async function setSkillStatus(
  skill: string,
  status: SkillConnection["status"],
): Promise<void> {
  const { data: session } = await supabase.auth.getSession();
  const uid = session.session?.user.id;
  if (!uid) throw new Error("Sign in required to change skill status.");
  const { error } = await supabase
    .from("companion_skills")
    .upsert(
      { user_id: uid, skill, status, updated_at: new Date().toISOString() },
      { onConflict: "user_id,skill" },
    );
  if (error) throw error;
}

export async function disconnectSkill(skill: string): Promise<void> {
  const { data: session } = await supabase.auth.getSession();
  const uid = session.session?.user.id;
  if (!uid) throw new Error("Sign in required to disconnect a skill.");
  const { error } = await supabase
    .from("companion_skills")
    .delete()
    .eq("user_id", uid)
    .eq("skill", skill);
  if (error) throw error;
}
