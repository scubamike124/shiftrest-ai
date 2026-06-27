// Server-only helper: send a Web Push notification to every subscription
// belonging to a user. Cleans up expired subscriptions on 404/410.
//
// IMPORTANT: This file uses the service-role client and must never be
// imported at module scope of a client-reachable file. Import lazily inside
// server-function/route handlers: `await import("@/lib/push/web-push.server")`.

import webPush from "web-push";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type PushPayload = {
  title: string;
  body: string;
  tag?: string;
  url?: string;
  kind?: string;
};

let configured = false;
function configure() {
  if (configured) return;
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT || "mailto:notifications@restpilot.ai";
  if (!publicKey || !privateKey) throw new Error("VAPID keys not configured");
  webPush.setVapidDetails(subject, publicKey, privateKey);
  configured = true;
}

type SubRow = {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
};

export async function sendPushToUser(userId: string, payload: PushPayload) {
  configure();
  const { data: subs, error } = await supabaseAdmin
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth")
    .eq("user_id", userId);
  if (error) return { sent: 0, removed: 0, error: error.message };
  if (!subs || subs.length === 0) return { sent: 0, removed: 0 };

  let sent = 0;
  let removed = 0;
  await Promise.all(
    (subs as SubRow[]).map(async (s) => {
      try {
        await webPush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          JSON.stringify(payload),
          { TTL: 60 * 60 },
        );
        sent += 1;
      } catch (err) {
        const statusCode = (err as { statusCode?: number }).statusCode;
        if (statusCode === 404 || statusCode === 410) {
          await supabaseAdmin.from("push_subscriptions").delete().eq("id", s.id);
          removed += 1;
        } else {
          console.error("web-push send failed", { endpoint: s.endpoint.slice(0, 40), err });
        }
      }
    }),
  );
  return { sent, removed };
}
