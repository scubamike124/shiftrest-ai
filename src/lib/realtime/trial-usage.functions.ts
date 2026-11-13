/**
 * Trial voice-usage accounting.
 *
 * Small server functions the browser calls while an OpenAI Realtime session
 * is running. Only trial subscribers are gated; paying subscribers get a
 * passthrough state.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { StripeEnv } from "@/lib/stripe.server";
import { realtimeEnvironment, voiceEntitlement } from "./access.server";
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

async function isUserOnTrial(userId: string, env: StripeEnv): Promise<boolean> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin.from("subscriptions")
    .select("status, current_period_end").eq("user_id", userId).eq("environment", env);
  if (error || !Array.isArray(data)) throw new Error("Voice subscription checks are unavailable");
  return voiceEntitlement(data) === "trial";
}

async function readUsage(userId: string, env: StripeEnv): Promise<number> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("trial_usage")
    .select("voice_seconds_used")
    .eq("user_id", userId)
    .eq("environment", env)
    .maybeSingle();
  if (error) throw new Error("Voice usage checks are unavailable");
  const used = data?.voice_seconds_used ?? 0;
  if (!Number.isInteger(used) || used < 0) throw new Error("Invalid voice usage state");
  return used;
}

function passthrough(): TrialUsageState {
  return { isTrial: false, limitReached: false, usedSeconds: 0, capSeconds: 0, remainingSeconds: 0 };
}

export async function loadTrialUsageState(
  userId: string,
  env: StripeEnv,
): Promise<TrialUsageState> {
  env = realtimeEnvironment(env);
  const isTrial = await isUserOnTrial(userId, env);
  if (!isTrial) return passthrough();
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
  .inputValidator((data: { environment: StripeEnv }) => ({ environment: realtimeEnvironment(data?.environment) }))
  .handler(async ({ data, context }): Promise<TrialUsageState> => {
    return loadTrialUsageState(context.userId, data.environment);
  });

export const recordTrialVoiceUsage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { seconds: number; environment: StripeEnv }) => {
    if (!data || !Number.isInteger(data.seconds) || data.seconds < 0 || data.seconds > 3600) throw new Error("Invalid voice usage duration");
    return { seconds: data.seconds, environment: realtimeEnvironment(data.environment) };
  })
  .handler(async ({ data, context }): Promise<TrialUsageState> => {
    const isTrial = await isUserOnTrial(context.userId, data.environment);
    if (!isTrial) return passthrough();

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: used, error } = await supabaseAdmin.rpc("increment_trial_voice_usage", {
      _user_id: context.userId, _environment: data.environment, _seconds: data.seconds,
    });
    if (error || typeof used !== "number" || !Number.isInteger(used) || used < 0) {
      throw new Error("Voice usage could not be recorded");
    }
    const next = used;
    const remaining = Math.max(0, TRIAL_VOICE_SECONDS_CAP - next);
    return {
      isTrial: true,
      limitReached: remaining <= 0,
      usedSeconds: next,
      capSeconds: TRIAL_VOICE_SECONDS_CAP,
      remainingSeconds: remaining,
    };
  });
