/**
 * Live voice heartbeat / finish report. Authenticated and rate limited.
 * The client calls it every TRIAL_VOICE_HEARTBEAT_MS while a session runs and
 * once on finish; the server answers with endNow=true when the session is past
 * its deadline (or unknown / already finished) and the client must hang up.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { ReportResult } from "@/lib/realtime/session-cost.server";

export type RealtimeReportInput = {
  sessionId: string;
  elapsedSeconds: number;
  final?: boolean;
};

export const reportRealtimeSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: RealtimeReportInput) => ({
    sessionId: String(input?.sessionId ?? "").slice(0, 64),
    elapsedSeconds: Math.max(0, Math.min(86_400, Number(input?.elapsedSeconds) || 0)),
    final: input?.final === true,
  }))
  .handler(async ({ data, context }): Promise<ReportResult> => {
    const { enforceRateLimit, RATE_LIMITS } = await import("@/lib/api/ratelimit.server");
    const limited = await enforceRateLimit(context.userId, RATE_LIMITS.realtimeReport);
    if (limited) return { endNow: false, deadlineAt: null, refunded: 0, overage: 0 };
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { reportRealtimeSession: report } = await import("@/lib/realtime/session-cost.server");
    return report(supabaseAdmin, context.userId, {
      sessionId: data.sessionId,
      elapsedSeconds: data.elapsedSeconds,
      final: data.final,
    });
  });
