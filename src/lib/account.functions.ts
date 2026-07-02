import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Tables that store user-scoped data. Order matters for FK safety, but every
 * row is keyed by user_id so we can purge in any order.
 *
 * Retention exceptions (not deleted on user request):
 *   - subscriptions: kept in canceled state for tax/accounting records.
 *   - legal_acceptances: kept as legally-required audit log.
 *   - notification_log / ai_log: aggregate operational logs (retained briefly).
 */
const USER_TABLES = [
  "shifts",
  "employers",
  "user_prefs",
  "coach_messages",
  "ai_memory",
  "ai_recommendations",
  "ai_patterns",
  "ai_feedback",
  "user_events",
  "trips",
  "tz_events",
  "push_subscriptions",
  "notification_prefs",
  "wearable_connections",
  "wearable_readings",
  "profiles",
] as const;

async function attemptStripeCancel(userId: string): Promise<{ canceled: boolean; reason?: string }> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: subs } = await supabaseAdmin
      .from("subscriptions")
      .select("stripe_subscription_id, environment, status")
      .eq("user_id", userId);
    if (!subs || subs.length === 0) return { canceled: false, reason: "no_subscription" };
    const { createStripeClient } = await import("@/lib/stripe.server");
    let canceledAny = false;
    for (const row of subs) {
      if (!row.stripe_subscription_id) continue;
      if (row.status === "canceled") continue;
      try {
        const stripe = createStripeClient((row.environment ?? "sandbox") as "sandbox" | "live");
        await stripe.subscriptions.cancel(row.stripe_subscription_id);
        await supabaseAdmin
          .from("subscriptions")
          .update({ status: "canceled", cancel_at_period_end: true })
          .eq("stripe_subscription_id", row.stripe_subscription_id);
        canceledAny = true;
      } catch (err) {
        console.error("stripe cancel failed", err);
      }
    }
    return { canceled: canceledAny };
  } catch (err) {
    console.error("attemptStripeCancel failed", err);
    return { canceled: false, reason: "error" };
  }
}

/**
 * Permanently delete the signed-in user's account and personal data.
 * Returns a manifest of what was deleted and what was retained for compliance.
 */
export const deleteAccountFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const uid = context.userId;

    // Capture the user's email BEFORE deletion so we can send confirmation.
    const { data: userLookup } = await supabaseAdmin.auth.admin.getUserById(uid);
    const userEmail = userLookup?.user?.email ?? null;

    const stripe = await attemptStripeCancel(uid);

    const deleted: string[] = [];
    const failed: string[] = [];
    for (const table of USER_TABLES) {
      const client = supabaseAdmin as unknown as {
        from: (t: string) => { delete: () => { eq: (c: string, v: string) => Promise<{ error: { message: string } | null }> } };
      };
      const { error } = await client.from(table).delete().eq("user_id", uid);
      if (error) failed.push(`${table}: ${error.message}`);
      else deleted.push(table);
    }

    const { error: authErr } = await supabaseAdmin.auth.admin.deleteUser(uid);
    if (authErr) {
      console.error("deleteAccount auth failed", authErr);
      throw new Error(authErr.message || "Account deletion failed");
    }

    // Post-deletion confirmation email + owner alert (fire-and-forget).
    if (userEmail) {
      try {
        const { sendTransactionalEmailServer } = await import("@/lib/email/send.server");
        await sendTransactionalEmailServer({
          templateName: "account-deletion",
          recipientEmail: userEmail,
          idempotencyKey: `acct-del-${uid}`,
        });
      } catch (e) {
        console.error("account-deletion email failed", e);
      }
    }
    try {
      const { notifyOwner } = await import("@/lib/ops/alert.server");
      await notifyOwner({
        severity: "warning",
        service: "account.delete",
        message: `User ${uid} deleted their account`,
        meta: { email: userEmail, deleted: deleted.length, failed: failed.length, stripe },
      });
    } catch {
      /* noop */
    }

    return {
      ok: true as const,
      deleted,
      failed,
      stripe,
      retained: [
        "subscriptions (canceled, retained for tax/accounting)",
        "legal_acceptances (retained as legal audit log)",
        "ai_log / notification_log (operational logs, short retention)",
      ],
    };
  });

/**
 * Wipe long-term AI memory only, leaving the rest of the account intact.
 */
export const purgeAiMemoryFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const uid = context.userId;
    const tables = ["ai_memory", "ai_recommendations", "ai_patterns", "ai_feedback"] as const;
    const cleared: string[] = [];
    for (const t of tables) {
      const { error } = await supabaseAdmin.from(t).delete().eq("user_id", uid);
      if (!error) cleared.push(t);
    }
    return { ok: true as const, cleared };
  });

/**
 * Export the signed-in user's personal data as a JSON object.
 * Returns a portable snapshot per GDPR/CCPA portability requirements.
 */
export const exportAccountFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const uid = context.userId;
    const tables = [
      ...USER_TABLES,
      "subscriptions",
      "legal_acceptances",
    ] as const;
    type JsonValue = string | number | boolean | null | JsonValue[] | { [k: string]: JsonValue };
    const data: Record<string, JsonValue[]> = {};
    const client = supabaseAdmin as unknown as {
      from: (t: string) => {
        select: (c: string) => { eq: (col: string, v: string) => Promise<{ data: JsonValue[] | null; error: { message: string } | null }> };
      };
    };
    for (const t of tables) {
      const { data: rows, error } = await client.from(t).select("*").eq("user_id", uid);
      if (!error) data[t] = rows ?? [];
    }
    const { data: userInfo } = await supabaseAdmin.auth.admin.getUserById(uid);
    return {
      ok: true as const,
      generatedAt: new Date().toISOString(),
      user: {
        id: uid,
        email: userInfo?.user?.email ?? null,
        createdAt: userInfo?.user?.created_at ?? null,
      },
      data,
    };
  });
