/**
 * Trial voice-usage accounting.
 *
 * Small server functions the browser calls while an OpenAI Realtime session
 * is running. Only trial subscribers are gated; paying subscribers get an
 * ok=true response with unlimited usage.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { StripeEnv } from "@/lib/stripe.server";
import { TRIAL_VOICE_SECONDS_CAP } from "@/lib/trial-limits";

export type TrialUsageState = {
  /** true when the user is in a `trialing` subscription and gated by the cap. */
  isTrial: boolean;
  /** true when the user has hit the cap and cannot start a new session. */
  limitReached: boolean;
  /** How many seconds of voice have been used so far. */
  usedSeconds: number;
  /** Cap in seconds; 0 for non-trial users. */
  capSeconds: number;
  /** capSeconds - usedSeconds, clamped ≥ 0. Ignored when isTrial=false. */
  remainingSeconds: number;
};

type SupabaseLike = {
  from: (table: string) => {
    select: (cols: string) => {
      eq: (c: string, v: unknown) => {
        eq: (c: string, v: unknown) => {
          order: (c: string, o: { ascending: boolean }) => {
            limit: (n: number) => {
              maybeSingle: () => Promise<{ data: { status: string; current_period_end: string | null } | null }>;
            };
          };
        };
      };
    };
  };
};

async function loadTrialContext(
  supabase: SupabaseLike,
  userId: string,
  env: StripeEnv,
): Promise<{ isTrial: boolean }> {
  const { data } = await supabase
    .from("subscriptions")
    .select("status, current_period_end")
    .eq("user_id", userId)
    .eq("environment", env)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return { isTrial: false };
  return { isTrial: data.status === "trialing" };
}

async function readUsage(
  userId: string,
  env: StripeEnv,
): Promise<number> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("trial_usage")
    .select("voice_seconds_used")
    .eq("user_id", userId)
    .eq("environment", env)
    .maybeSingle();
  return data?.voice_seconds_used ?? 0;
}

export async function loadTrialUsageState(
  supabase: SupaFromContext,
  userId: string,
  env: StripeEnv,
): Promise<TrialUsageState> {
  const { isTrial } = await loadTrialContext(supabase, userId, env);
  if (!isTrial) {
    return {
      isTrial: false,
      limitReached: false,
      usedSeconds: 0,
      capSeconds: 0,
      remainingSeconds: 0,
    };
  }
  const used = await readUsage(userId, env);
  const remaining = Math.max(0, TRIAL_VOICE_SECONDS_CAP - used);
  return {
    isTrial: true,
    limitReached: remaining <= 0,
    usedSeconds: used,
    capSeconds: TRIAL_VOICE_SECONDS_CAP,
    remainingSeconds: remaining,
  };
}

export const getTrialUsage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { environment: StripeEnv }) => data)
  .handler(async ({ data, context }): Promise<TrialUsageState> => {
    return loadTrialUsageState(context.supabase as SupaFromContext, context.userId, data.environment);
  });

export const recordTrialVoiceUsage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { seconds: number; environment: StripeEnv }) => {
    const n = Math.max(0, Math.min(3600, Math.floor(Number(data.seconds) || 0)));
    return { seconds: n, environment: data.environment };
  })
  .handler(async ({ data, context }): Promise<TrialUsageState> => {
    const { isTrial } = await loadTrialContext(
      context.supabase as SupaFromContext,
      context.userId,
      data.environment,
    );
    // Paying subscribers: don't record. Just return a passthrough state.
    if (!isTrial) {
      return {
        isTrial: false,
        limitReached: false,
        usedSeconds: 0,
        capSeconds: 0,
        remainingSeconds: 0,
      };
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const current = await readUsage(context.userId, data.environment);
    const next = Math.min(TRIAL_VOICE_SECONDS_CAP, current + data.seconds);
    await supabaseAdmin
      .from("trial_usage")
      .upsert(
        {
          user_id: context.userId,
          environment: data.environment,
          voice_seconds_used: next,
          last_updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id,environment" },
      );
    const remaining = Math.max(0, TRIAL_VOICE_SECONDS_CAP - next);
    return {
      isTrial: true,
      limitReached: remaining <= 0,
      usedSeconds: next,
      capSeconds: TRIAL_VOICE_SECONDS_CAP,
      remainingSeconds: remaining,
    };
  });
