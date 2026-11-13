import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Explicit deletion targets. Most use user_id; profiles uses its auth-user id.
 * Other auth-linked rows (including subscriptions, legal_acceptances, ai_log,
 * and notification_log) are removed by ON DELETE CASCADE in the migrations.
 * This operation does not delete records held separately by payment providers.
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
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: subs, error: lookupError } = await supabaseAdmin
    .from("subscriptions")
    .select("stripe_subscription_id, environment, status")
    .eq("user_id", userId);
  if (lookupError || !subs) {
    throw new Error("We couldn't verify your subscriptions. Your account has not been deleted. Please retry.");
  }
  if (subs.length === 0) return { canceled: false, reason: "no_subscription" };
  const { createStripeClient } = await import("@/lib/stripe.server");
  let canceledAny = false;
  for (const row of subs) {
    if (row.status === "canceled") continue;
    // The payment-mode webhook stores one-time purchases with this exact
    // status/key convention. They are not Stripe subscriptions to cancel.
    if (row.status === "lifetime" && row.stripe_subscription_id?.startsWith("lifetime_cs_")) continue;
    // Missing identifiers or environments must not silently bypass cancellation.
    if (!row.stripe_subscription_id || (row.environment !== "sandbox" && row.environment !== "live")) {
      throw new Error("We couldn't verify a subscription for cancellation. Your account has not been deleted. Please contact support.");
    }
    try {
      const stripe = createStripeClient(row.environment);
      // Retrieve first so retrying after a successful cancellation but failed
      // database update can reconcile the already-canceled subscription.
      const current = await stripe.subscriptions.retrieve(row.stripe_subscription_id);
      if (current.status !== "canceled") {
        const canceled = await stripe.subscriptions.cancel(row.stripe_subscription_id);
        if (canceled.status !== "canceled") throw new Error("Cancellation was not confirmed");
      }
      const { error } = await supabaseAdmin
        .from("subscriptions")
        .update({ status: "canceled", cancel_at_period_end: false })
        .eq("stripe_subscription_id", row.stripe_subscription_id);
      if (error) throw new Error("Cancellation record could not be saved");
      canceledAny = true;
    } catch {
      throw new Error("We couldn't confirm all subscription cancellations. Your account remains available; some subscriptions may already be canceled. Please retry before deleting your account.");
    }
  }
  return { canceled: canceledAny };
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
      const { error } = await client.from(table).delete().eq(table === "profiles" ? "id" : "user_id", uid);
      if (error) failed.push(`${table}: ${error.message}`);
      else deleted.push(table);
    }

    if (failed.length > 0) {
      throw new Error("Account deletion is incomplete. Some data may already be removed, but your sign-in remains available. Please retry to finish deleting your data and account.");
    }

    const { error: authErr } = await supabaseAdmin.auth.admin.deleteUser(uid);
    if (authErr) {
      console.error("deleteAccount auth failed", authErr);
      throw new Error("Your data was removed, but we couldn't finish deleting your sign-in. Please retry to complete account deletion.");
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
      cascaded: ["subscriptions", "legal_acceptances", "ai_log", "notification_log"],
      retained: [] as string[],
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
    const tables = ["ai_memory_proposals", "ai_memory", "ai_recommendations", "ai_patterns", "ai_feedback"] as const;
    const cleared: string[] = [];
    let failed = false;
    for (const t of tables) {
      const { error } = await supabaseAdmin.from(t).delete().eq("user_id", uid);
      if (!error) cleared.push(t);
      else failed = true;
    }
    if (failed) {
      throw new Error("Some AI memory could not be cleared. Please retry to finish erasing it.");
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
      "subscriptions", "legal_acceptances", "ai_memory_proposals",
      "personal_items", "calendar_feeds", "traffic_destinations", "sound_mixes",
      "partner_shares", "companion_skills", "companion_routines", "smart_devices",
      "automations", "automation_runs", "routine_suggestions", "user_roles",
      "ai_log", "notification_log",
    ] as const;
    type JsonValue = string | number | boolean | null | JsonValue[] | { [k: string]: JsonValue };
    type ExportResult = { data: JsonValue[] | null; error: { message: string } | null };
    const data: Record<string, JsonValue[]> = {};
    const client = supabaseAdmin as unknown as {
      from: (t: string) => {
        select: (c: string) => {
          eq: (col: string, v: string) => {
            order: (column: string, options: { ascending: boolean }) => {
              range: (from: number, to: number) => Promise<ExportResult>;
            };
          };
        };
      };
    };
    const pageSize = 500;
    for (const t of tables) {
      const key = t === "profiles" ? "id" : "user_id";
      const order = t === "user_prefs" || t === "notification_prefs" ? "user_id"
        : t === "companion_skills" ? "skill" : "id";
      const allRows: JsonValue[] = [];
      for (let offset = 0; ; ) {
        const { data: rows, error } = await client.from(t).select("*")
          .eq(key, uid).order(order, { ascending: true }).range(offset, offset + pageSize - 1);
        if (error || !rows) {
          throw new Error("We couldn't export all your data. No complete export was created. Please retry.");
        }
        if (rows.length === 0) break;
        allRows.push(...rows);
        // Advance by the received count, even if the server applies a smaller
        // row cap than requested. Continue until an empty page, not a short one.
        offset += rows.length;
      }
      data[t] = allRows;
    }
    const { data: userInfo, error: userError } = await supabaseAdmin.auth.admin.getUserById(uid);
    if (userError || !userInfo?.user) {
      throw new Error("We couldn't complete your account export. Please retry.");
    }

    // Fire-and-forget confirmation email that an export was generated.
    if (userInfo?.user?.email) {
      try {
        const { sendTransactionalEmailServer } = await import("@/lib/email/send.server");
        await sendTransactionalEmailServer({
          templateName: "data-export-ready",
          recipientEmail: userInfo.user.email,
          idempotencyKey: `export-${uid}-${Date.now()}`,
          templateData: {},
        });
      } catch (e) {
        console.error("data-export-ready email failed", e);
      }
    }

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
