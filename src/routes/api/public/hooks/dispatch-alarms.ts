// Smart Alarm Web Push backstop dispatcher.
//
// Called by pg_cron every minute (Phase 3). Also safe to invoke manually via
// curl for QA. Design:
//
//   1. Atomically claim due, undispatched alarm rows using
//      `UPDATE ... FOR UPDATE SKIP LOCKED` — guarantees each alarm is claimed
//      by exactly one caller, even if cron fires overlapping ticks.
//   2. Send Web Push via the existing sendPushToUser() helper.
//   3. If push throws, roll dispatched_at back to NULL so the next tick retries.
//      If push succeeds (or user has no subscriptions), leave it dispatched.
//
// Auth: /api/public/* bypasses site auth, so we require the Supabase
// publishable/anon key in the `apikey` header (matches pg_cron convention).

import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/hooks/dispatch-alarms")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const expected = process.env.SUPABASE_PUBLISHABLE_KEY;
        const provided = request.headers.get("apikey");
        if (!expected || !provided || provided !== expected) {
          return new Response(JSON.stringify({ error: "unauthorized" }), {
            status: 401,
            headers: { "Content-Type": "application/json" },
          });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { sendPushToUser } = await import("@/lib/push/web-push.server");

        // Two-step atomic claim: SELECT candidate ids, then per-row UPDATE
        // with WHERE dispatched_at IS NULL. Per-row conditional UPDATE is
        // atomic in Postgres, so concurrent dispatchers cannot both claim
        // the same row. Window [now-30s, now+90s] means a minute-tick cron
        // never misses a due alarm.
        const nowIso = new Date().toISOString();
        const upperIso = new Date(Date.now() + 90_000).toISOString();
        const lowerIso = new Date(Date.now() - 30_000).toISOString();

        const { data: candidates, error: selErr } = await supabaseAdmin
          .from("user_events")
          .select("id, user_id, title, starts_at")
          .is("dispatched_at", null)
          .eq("kind", "personal")
          .ilike("title", "alarm:%")
          .gte("starts_at", lowerIso)
          .lte("starts_at", upperIso)
          .limit(200);

        if (selErr) {
          console.error("dispatch-alarms select failed", selErr);
          return new Response(JSON.stringify({ error: "select_failed", detail: selErr.message }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }

        let scanned = candidates?.length ?? 0;
        let claimedCount = 0;
        let sent = 0;
        let rolledBack = 0;
        let noSubs = 0;

        for (const row of candidates ?? []) {
          // Atomic per-row claim: only succeeds if still NULL.
          const { data: claimRows, error: updErr } = await supabaseAdmin
            .from("user_events")
            .update({ dispatched_at: nowIso })
            .eq("id", row.id)
            .is("dispatched_at", null)
            .select("id");

          if (updErr) {
            console.error("dispatch-alarms claim failed", { id: row.id, updErr });
            continue;
          }
          if (!claimRows || claimRows.length === 0) {
            // Another concurrent dispatcher already claimed it. Skip.
            continue;
          }
          claimedCount += 1;

          const label = row.title?.replace(/^alarm:\s*/i, "").trim() || "Alarm";
          try {
            const result = await sendPushToUser(row.user_id, {
              title: "⏰ Alarm",
              body: label,
              tag: `alarm:${row.id}`,
              kind: "alarm",
              url: "/",
            });
            if (result.sent >= 1) {
              sent += result.sent;
            } else {
              // No live subscriptions. Terminal — leave dispatched to avoid
              // infinite retry. Foreground timer still rings if app is open.
              noSubs += 1;
            }
          } catch (err) {
            console.error("dispatch-alarms push threw, rolling back", { id: row.id, err });
            await supabaseAdmin
              .from("user_events")
              .update({ dispatched_at: null })
              .eq("id", row.id);
            rolledBack += 1;
          }
        }

        return new Response(
          JSON.stringify({ scanned, claimed: claimedCount, sent, noSubs, rolledBack }),
          { headers: { "Content-Type": "application/json" } },
        );
      },
    },
  },
});
