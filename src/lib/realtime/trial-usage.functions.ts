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
  const { data } = await supabaseAdmin
    .from("subscriptions")
    .select("status")
    .eq("user_id", userId)
    .eq("environment", env)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (data?.status === "trialing") return true;
  // App Store subscribers in their free trial are metered the same way, once
  // IAP is switched on; with IAP_ENABLED unset nothing changes here.
  if (process.env.IAP_ENABLED !== "true") return false;
  if (data?.status === "active" || data?.status === "lifetime") return false; // paid on the web
  return appleTrialOnly(userId);
}

/** True when the user's only App Store access is a free trial (or the billing
 *  grace right after one). A missing store_entitlements table (migration not
 *  applied) or any read error means "no Apple trial": nothing breaks. */
async function appleTrialOnly(userId: string): Promise<boolean> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const store = await (supabaseAdmin as unknown as {
      from(t: "store_entitlements"): {
        select(c: string): { eq(c: "user_id", v: string): PromiseLike<{ data: unknown; error: unknown }> };
      };
    })
      .from("store_entitlements")
      .select("environment, plan, period_type, expires_at, grace_expires_at, will_renew")
      .eq("user_id", userId);
    if (store.error || !Array.isArray(store.data)) return false;
    const { appleRowsAsSubscriptionRows, appleEnvironmentsFrom } = await import(
      "@/lib/entitlements/merge"
    );
    const rows = appleRowsAsSubscriptionRows(
      store.data,
      appleEnvironmentsFrom(process.env as Record<string, string | undefined>),
    );
    return rows.length > 0 && rows.every((r) => r.status === "trialing");
  } catch {
    return false;
  }
}

async function readUsage(userId: string, env: StripeEnv): Promise<number> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("trial_usage")
    .select("voice_seconds_used")
    .eq("user_id", userId)
    .eq("environment", env)
    .maybeSingle();
  return data?.voice_seconds_used ?? 0;
}

function passthrough(): TrialUsageState {
  return { isTrial: false, limitReached: false, usedSeconds: 0, capSeconds: 0, remainingSeconds: 0 };
}

export async function loadTrialUsageState(
  userId: string,
  env: StripeEnv,
): Promise<TrialUsageState> {
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
  .inputValidator((data: { environment: StripeEnv }) => data)
  .handler(async ({ data, context }): Promise<TrialUsageState> => {
    return loadTrialUsageState(context.userId, data.environment);
  });

export const recordTrialVoiceUsage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { seconds: number; environment: StripeEnv }) => {
    const n = Math.max(0, Math.min(3600, Math.floor(Number(data.seconds) || 0)));
    return { seconds: n, environment: data.environment };
  })
  .handler(async ({ data, context }): Promise<TrialUsageState> => {
    const isTrial = await isUserOnTrial(context.userId, data.environment);
    if (!isTrial) return passthrough();

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
