/**
 * Canonical client-side accessor for the user's preferred name.
 * Returns ONLY user_prefs.preferred_name. Never falls back to email,
 * username, or Google display name. If unset, callers get "" and should
 * render a name-less greeting (e.g. "Good morning" instead of
 * "Good morning, scubamike124").
 */
import { supabase } from "@/integrations/supabase/client";

let cached: { userId: string; name: string; at: number } | null = null;
const TTL_MS = 60_000;

export async function loadPreferredName(): Promise<string> {
  const { data: u } = await supabase.auth.getUser();
  const uid = u.user?.id;
  if (!uid) return "";
  if (cached && cached.userId === uid && Date.now() - cached.at < TTL_MS) {
    return cached.name;
  }
  const { data } = await supabase
    .from("user_prefs")
    .select("preferred_name")
    .eq("user_id", uid)
    .maybeSingle();
  const name = ((data?.preferred_name as string | null) ?? "").trim();
  cached = { userId: uid, name, at: Date.now() };
  return name;
}

export function invalidatePreferredName(): void {
  cached = null;
}
