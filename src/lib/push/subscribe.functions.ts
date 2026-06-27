// Server functions for managing the current user's push subscriptions
// and firing a one-off test push.

import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type SubscribeInput = {
  endpoint: string;
  p256dh: string;
  auth: string;
  userAgent?: string;
};

function validateSub(input: unknown): SubscribeInput {
  const v = input as Partial<SubscribeInput> | null | undefined;
  if (!v || typeof v.endpoint !== "string" || !v.endpoint.startsWith("https://"))
    throw new Error("Invalid endpoint");
  if (typeof v.p256dh !== "string" || v.p256dh.length < 20) throw new Error("Invalid p256dh");
  if (typeof v.auth !== "string" || v.auth.length < 10) throw new Error("Invalid auth");
  return {
    endpoint: v.endpoint,
    p256dh: v.p256dh,
    auth: v.auth,
    userAgent: typeof v.userAgent === "string" ? v.userAgent.slice(0, 300) : undefined,
  };
}

export const subscribePush = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(validateSub)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { error } = await supabase
      .from("push_subscriptions")
      .upsert(
        {
          user_id: userId,
          endpoint: data.endpoint,
          p256dh: data.p256dh,
          auth: data.auth,
          user_agent: data.userAgent ?? null,
          last_seen_at: new Date().toISOString(),
        },
        { onConflict: "user_id,endpoint" },
      );
    if (error) throw new Error(error.message);
    // Ensure a prefs row exists with sensible defaults
    await supabase
      .from("notification_prefs")
      .upsert({ user_id: userId }, { onConflict: "user_id", ignoreDuplicates: true });
    return { ok: true };
  });

export const unsubscribePush = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => {
    const v = input as { endpoint?: string } | null | undefined;
    if (!v || typeof v.endpoint !== "string") throw new Error("Invalid endpoint");
    return { endpoint: v.endpoint };
  })
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { error } = await supabase
      .from("push_subscriptions")
      .delete()
      .eq("user_id", userId)
      .eq("endpoint", data.endpoint);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const sendTestNotification = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { sendPushToUser } = await import("@/lib/push/web-push.server");
    const result = await sendPushToUser(context.userId, {
      title: "RestPilot test 🚀",
      body: "Smart reminders are wired up. You're all set.",
      tag: "test",
    });
    return result;
  });
