/**
 * Server-side counterpart of loadPreferredName().
 * Reads ONLY user_prefs.preferred_name. Never falls back to email, username,
 * or Google identity metadata.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export async function loadPreferredNameServer(
  admin: SupabaseClient,
  userId: string,
): Promise<string> {
  const { data } = await admin
    .from("user_prefs")
    .select("preferred_name")
    .eq("user_id", userId)
    .maybeSingle();
  return (((data as { preferred_name?: string | null } | null)?.preferred_name ?? "")).trim();
}
