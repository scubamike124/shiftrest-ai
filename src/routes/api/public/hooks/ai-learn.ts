// pg_cron target — runs nightly. For each opted-in user:
//   1) Runs pattern detection over their last 28 days of shifts/wearables.
//   2) Fills outcome_json on feedback rows from the previous 18-36h with
//      next-day wearable deltas, so the coach can learn what actually worked.
//   3) Aggregates feedback into ranked `ai_memory` rows of category
//      "preferences" — Step 2's ranker boosts these automatically.
//
// Auth: anon publishable key (the standard cron pattern for /api/public/*).

import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/hooks/ai-learn")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const apikey = request.headers.get("apikey") ?? request.headers.get("x-api-key") ?? "";
        const expected = process.env.SUPABASE_PUBLISHABLE_KEY ?? "";
        if (!expected || apikey !== expected) {
          return new Response("Unauthorized", { status: 401 });
        }

        const { createClient } = await import("@supabase/supabase-js");
        const url = process.env.SUPABASE_URL!;
        const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
        const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

        const { runPatternDetection } = await import("@/lib/ai/patterns.server");

        // 1) Pull all opted-in users.
        const { data: users } = await admin
          .from("user_prefs")
          .select("user_id, sleep_hours, predictive_enabled, feedback_learning_enabled")
          .eq("predictive_enabled", true);

        let detected = 0;
        let learned = 0;
        let outcomes = 0;

        for (const u of (users as Array<{
          user_id: string;
          sleep_hours: number | null;
          predictive_enabled: boolean | null;
          feedback_learning_enabled: boolean | null;
        }> | null) ?? []) {
          // a) Patterns
          try {
            const found = await runPatternDetection(admin, u.user_id, Number(u.sleep_hours ?? 8));
            detected += found.length;
          } catch (e) {
            console.warn("pattern detection failed", u.user_id, e);
          }

          if (!u.feedback_learning_enabled) continue;

          // b) Outcome backfill: feedback rows from 18-36h ago with empty outcome.
          const since = new Date(Date.now() - 36 * 3_600_000).toISOString();
          const until = new Date(Date.now() - 18 * 3_600_000).toISOString();
          const { data: pending } = await admin
            .from("ai_feedback")
            .select("id, reaction, created_at, outcome_json")
            .eq("user_id", u.user_id)
            .gte("created_at", since)
            .lte("created_at", until);
          for (const f of (pending as Array<{
            id: string;
            reaction: string;
            created_at: string;
            outcome_json: Record<string, unknown> | null;
          }> | null) ?? []) {
            if (f.outcome_json && Object.keys(f.outcome_json).length > 0) continue;
            const day = new Date(new Date(f.created_at).getTime() + 24 * 3_600_000)
              .toISOString().slice(0, 10);
            const { data: w } = await admin
              .from("wearable_readings")
              .select("sleep_minutes, hrv, readiness")
              .eq("user_id", u.user_id)
              .eq("date", day)
              .maybeSingle();
            const outcome = (w as { sleep_minutes: number | null; hrv: number | null; readiness: number | null } | null) ?? null;
            await admin
              .from("ai_feedback")
              .update({
                outcome_json: outcome ?? { note: "no_wearable_data" },
              } as never)
              .eq("id", f.id);
            outcomes++;
          }

          // c) Aggregate last 30d feedback into a single learned memory.
          const { data: agg } = await admin
            .from("ai_feedback")
            .select("reaction, recommendation_id, ai_recommendations!inner(intent)")
            .eq("user_id", u.user_id)
            .gte("created_at", new Date(Date.now() - 30 * 86_400_000).toISOString());
          const map = new Map<string, { helpful: number; ignored: number }>();
          for (const r of (agg as unknown as Array<{
            reaction: string;
            ai_recommendations: { intent: string } | { intent: string }[] | null;
          }> | null) ?? []) {
            const rec = Array.isArray(r.ai_recommendations) ? r.ai_recommendations[0] : r.ai_recommendations;
            const intent = rec?.intent;
            if (!intent) continue;
            const cur = map.get(intent) ?? { helpful: 0, ignored: 0 };
            if (r.reaction === "helpful" || r.reaction === "already_did") cur.helpful++;
            if (r.reaction === "not_helpful" || r.reaction === "ignored_today" || r.reaction === "dismissed_forever") cur.ignored++;
            map.set(intent, cur);
          }
          for (const [intent, c] of map) {
            if (c.helpful + c.ignored < 2) continue;
            const verdict = c.helpful > c.ignored
              ? `Tends to find ${intent} recommendations helpful (${c.helpful} helpful vs ${c.ignored} not, last 30 days)`
              : `Tends to ignore ${intent} recommendations (${c.ignored} not helpful vs ${c.helpful} helpful, last 30 days)`;
            // Use the existing memory table — dedupe key kept simple via hash of intent.
            const hash = `learned:${intent}`;
            const { data: existing } = await admin
              .from("ai_memory")
              .select("id")
              .eq("user_id", u.user_id)
              .eq("hash", hash)
              .maybeSingle();
            if (existing) {
              await admin
                .from("ai_memory")
                .update({ content: verdict, importance: 4 } as never)
                .eq("id", (existing as { id: string }).id);
            } else {
              await admin.from("ai_memory").insert({
                user_id: u.user_id,
                content: verdict,
                category: "preferences",
                source: "derived",
                importance: 4,
                hash,
              } as never);
            }
            learned++;
          }
        }

        return Response.json({ ok: true, detected, outcomes, learned });
      },
      GET: async () => Response.json({ ok: true, info: "POST with apikey header to trigger" }),
    },
  },
});
