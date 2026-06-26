import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Permanently delete the signed-in user's auth account.
 * FK cascades remove shifts, user_prefs, profiles, and coach_messages automatically.
 */
export const deleteAccountFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // Clean up user-owned rows not covered by an auth FK cascade.
    await supabaseAdmin.from("shifts").delete().eq("user_id", context.userId);
    await supabaseAdmin.from("employers").delete().eq("user_id", context.userId);
    await supabaseAdmin.from("user_prefs").delete().eq("user_id", context.userId);
    await supabaseAdmin.from("coach_messages").delete().eq("user_id", context.userId);
    const { error } = await supabaseAdmin.auth.admin.deleteUser(context.userId);
    if (error) {
      console.error("deleteAccount failed:", error);
      throw new Error(error.message || "Account deletion failed");
    }
    return { ok: true as const };
  });
