/**
 * Saved sound mixes — CRUD against `public.sound_mixes` via the browser
 * Supabase client (RLS scopes everything to auth.uid()).
 */
import { supabase } from "@/integrations/supabase/client";

export type SavedMix = {
  id: string;
  name: string;
  is_favorite: boolean;
  tracks: { slug: string; volume: number }[];
  updated_at: string;
};

type MixRow = {
  id: string;
  name: string;
  is_favorite: boolean;
  tracks: unknown;
  updated_at: string;
};

function rowToMix(row: MixRow): SavedMix {
  const tracks = Array.isArray(row.tracks)
    ? (row.tracks as unknown[])
        .filter((t): t is { slug: string; volume: number } => {
          return Boolean(t) && typeof t === "object"
            && typeof (t as { slug?: unknown }).slug === "string"
            && typeof (t as { volume?: unknown }).volume === "number";
        })
    : [];
  return {
    id: row.id,
    name: row.name,
    is_favorite: row.is_favorite,
    tracks,
    updated_at: row.updated_at,
  };
}

export async function listMixes(): Promise<SavedMix[]> {
  const { data, error } = await supabase
    .from("sound_mixes")
    .select("id, name, is_favorite, tracks, updated_at")
    .order("is_favorite", { ascending: false })
    .order("updated_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((r) => rowToMix(r as MixRow));
}

export async function saveMix(
  name: string,
  tracks: { slug: string; volume: number }[],
): Promise<SavedMix> {
  const { data: userRes } = await supabase.auth.getUser();
  const userId = userRes.user?.id;
  if (!userId) throw new Error("Sign in to save a mix.");
  const { data, error } = await supabase
    .from("sound_mixes")
    .insert({ user_id: userId, name, tracks })
    .select("id, name, is_favorite, tracks, updated_at")
    .single();
  if (error) throw error;
  return rowToMix(data as MixRow);
}

export async function deleteMix(id: string): Promise<void> {
  const { error } = await supabase.from("sound_mixes").delete().eq("id", id);
  if (error) throw error;
}

export async function toggleFavorite(id: string, is_favorite: boolean): Promise<void> {
  const { error } = await supabase
    .from("sound_mixes")
    .update({ is_favorite })
    .eq("id", id);
  if (error) throw error;
}
