// Subscription lifecycle daily sweep.
//
// Called by pg_cron once per day. Two sweeps:
//
//   1. TRIAL ENDING — status=trialing, current_period_end in [now, now+3d],
//      trial_ending_notified_at IS NULL. Sends `trial-ending` and stamps
//      trial_ending_notified_at atomically (conditional UPDATE) so we never
//      email twice even if the cron double-fires.
//
//   2. EXPIRED — status IN (canceled, unpaid, incomplete_expired),
//      current_period_end < now, expired_notified_at IS NULL. Sends
//      `subscription-expired` and stamps expired_notified_at.
//
// Auth: /api/public/* bypasses site auth; we require the Supabase
// publishable/anon key in the `apikey` header (matches pg_cron convention
// used by dispatch-alarms).

import { createFileRoute } from "@tanstack/react-router";

interface Sub {
  id: string;
  user_id: string;
  status: string;
  current_period_end: string | null;
  environment: string;
}

function jsonError(status: number, body: object) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export const Route = createFileRoute("/api/public/hooks/subscription-lifecycle")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const expected = process.env.SUPABASE_PUBLISHABLE_KEY;
        const provided = request.headers.get("apikey");
        if (!expected || !provided || provided !== expected) {
          return jsonError(401, { error: "unauthorized" });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { sendTransactionalEmailServer } = await import("@/lib/email/send.server");

        const now = new Date();
        const nowIso = now.toISOString();
        const trialWindowIso = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000).toISOString();

        const stats = {
          trialEnding: { scanned: 0, sent: 0, skipped: 0, errors: 0 },
          expired: { scanned: 0, sent: 0, skipped: 0, errors: 0 },
        };

        // ---------- TRIAL ENDING SWEEP ----------
        const { data: trialCandidates, error: trialErr } = await supabaseAdmin
          .from("subscriptions")
          .select("id, user_id, status, current_period_end, environment")
          .eq("status", "trialing")
          .is("trial_ending_notified_at", null)
          .not("current_period_end", "is", null)
          .gte("current_period_end", nowIso)
          .lte("current_period_end", trialWindowIso)
          .limit(500);

        if (trialErr) {
          console.error("subscription-lifecycle trial select failed", trialErr);
          try {
            const { notifyOwner } = await import("@/lib/ops/alert.server");
            void notifyOwner({
              severity: "critical",
              service: "subscription-lifecycle",
              message: `Trial select failed: ${trialErr.message}`,
            });
          } catch { /* noop */ }
        }

        stats.trialEnding.scanned = trialCandidates?.length ?? 0;

        for (const sub of (trialCandidates ?? []) as Sub[]) {
          // Atomic claim: only succeeds if column still NULL. Prevents dupe
          // sends across concurrent invocations.
          const stampIso = new Date().toISOString();
          const { data: claimed, error: claimErr } = await supabaseAdmin
            .from("subscriptions")
            .update({ trial_ending_notified_at: stampIso })
            .eq("id", sub.id)
            .is("trial_ending_notified_at", null)
            .select("id");

          if (claimErr || !claimed || claimed.length === 0) {
            stats.trialEnding.skipped += 1;
            continue;
          }

          // Look up user email
          const { data: userLookup } = await supabaseAdmin.auth.admin.getUserById(sub.user_id);
          const email = userLookup?.user?.email;
          if (!email) {
            stats.trialEnding.skipped += 1;
            continue;
          }

          const endDate = sub.current_period_end ? new Date(sub.current_period_end) : null;
          const daysRemaining = endDate
            ? Math.max(0, Math.ceil((endDate.getTime() - now.getTime()) / (24 * 60 * 60 * 1000)))
            : undefined;
          const trialEndDate = endDate
            ? endDate.toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
                year: "numeric",
              })
            : undefined;

          const result = await sendTransactionalEmailServer({
            templateName: "trial-ending",
            recipientEmail: email,
            idempotencyKey: `trial-ending-${sub.id}`,
            templateData: { daysRemaining, trialEndDate },
          });

          if (result.success) {
            stats.trialEnding.sent += 1;
          } else {
            stats.trialEnding.errors += 1;
            // Roll the stamp back so a future sweep can retry.
            await supabaseAdmin
              .from("subscriptions")
              .update({ trial_ending_notified_at: null })
              .eq("id", sub.id);
          }
        }

        // ---------- EXPIRED SWEEP ----------
        const { data: expiredCandidates, error: expErr } = await supabaseAdmin
          .from("subscriptions")
          .select("id, user_id, status, current_period_end, environment")
          .in("status", ["canceled", "unpaid", "incomplete_expired"])
          .is("expired_notified_at", null)
          .not("current_period_end", "is", null)
          .lt("current_period_end", nowIso)
          .limit(500);

        if (expErr) {
          console.error("subscription-lifecycle expired select failed", expErr);
          try {
            const { notifyOwner } = await import("@/lib/ops/alert.server");
            void notifyOwner({
              severity: "critical",
              service: "subscription-lifecycle",
              message: `Expired select failed: ${expErr.message}`,
            });
          } catch { /* noop */ }
        }

        stats.expired.scanned = expiredCandidates?.length ?? 0;

        for (const sub of (expiredCandidates ?? []) as Sub[]) {
          // Skip if this user has any active/trialing row in the same env
          // (e.g. re-subscribed after cancel). Prevents "your access ended"
          // going out to an active customer.
          const { data: activeRows } = await supabaseAdmin
            .from("subscriptions")
            .select("id")
            .eq("user_id", sub.user_id)
            .eq("environment", sub.environment)
            .in("status", ["active", "trialing", "past_due"])
            .limit(1);
          if (activeRows && activeRows.length > 0) {
            // Stamp so we don't reconsider next tick.
            await supabaseAdmin
              .from("subscriptions")
              .update({ expired_notified_at: new Date().toISOString() })
              .eq("id", sub.id);
            stats.expired.skipped += 1;
            continue;
          }

          const stampIso = new Date().toISOString();
          const { data: claimed, error: claimErr } = await supabaseAdmin
            .from("subscriptions")
            .update({ expired_notified_at: stampIso })
            .eq("id", sub.id)
            .is("expired_notified_at", null)
            .select("id");

          if (claimErr || !claimed || claimed.length === 0) {
            stats.expired.skipped += 1;
            continue;
          }

          const { data: userLookup } = await supabaseAdmin.auth.admin.getUserById(sub.user_id);
          const email = userLookup?.user?.email;
          if (!email) {
            stats.expired.skipped += 1;
            continue;
          }

          const result = await sendTransactionalEmailServer({
            templateName: "subscription-expired",
            recipientEmail: email,
            idempotencyKey: `subscription-expired-${sub.id}`,
          });

          if (result.success) {
            stats.expired.sent += 1;
          } else {
            stats.expired.errors += 1;
            await supabaseAdmin
              .from("subscriptions")
              .update({ expired_notified_at: null })
              .eq("id", sub.id);
          }
        }

        return new Response(JSON.stringify({ ok: true, ...stats }), {
          headers: { "Content-Type": "application/json" },
        });
      },
    },
  },
});
