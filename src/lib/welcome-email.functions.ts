// Fires the welcome email on the first successful sign-in.
// Idempotent via profiles.welcomed_at — sets the flag transactionally so
// concurrent tabs still send at most one email per account.

import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const ensureWelcomeEmailFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const uid = context.userId;

    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("email, display_name, welcomed_at")
      .eq("id", uid)
      .maybeSingle();

    if (!profile || profile.welcomed_at) {
      return { sent: false as const, reason: "already_welcomed_or_no_profile" };
    }
    if (!profile.email) return { sent: false as const, reason: "no_email" };

    // Set the flag FIRST, guarding against a race between two tabs. Only send
    // if we won the update.
    const { data: updated, error: updateErr } = await supabaseAdmin
      .from("profiles")
      .update({ welcomed_at: new Date().toISOString() })
      .eq("id", uid)
      .is("welcomed_at", null)
      .select("id")
      .maybeSingle();

    if (updateErr || !updated) {
      return { sent: false as const, reason: "raced" };
    }

    const { sendTransactionalEmailServer } = await import("@/lib/email/send.server");
    const result = await sendTransactionalEmailServer({
      templateName: "welcome",
      recipientEmail: profile.email,
      idempotencyKey: `welcome-${uid}`,
      templateData: { name: profile.display_name || undefined },
    });

    if (!("success" in result) || !result.success) {
      // Roll back the flag so a future retry can succeed.
      await supabaseAdmin
        .from("profiles")
        .update({ welcomed_at: null })
        .eq("id", uid);
      return { sent: false as const, reason: result.reason };
    }

    return { sent: true as const };
  });
