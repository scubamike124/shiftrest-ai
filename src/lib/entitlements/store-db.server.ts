// Database wiring for the App Store entitlement sync (service role only).
import process from "node:process";
import type { StoreSyncDeps, WebhookDeps } from "./store-sync.server";

type DbDeps = StoreSyncDeps & Pick<WebhookDeps, "isProcessed" | "markProcessed">;

export async function storeSyncDeps(): Promise<DbDeps> {
  const env = process.env as Record<string, string | undefined>;
  const lazyAdmin = async () => (await import("@/integrations/supabase/client.server")).supabaseAdmin;
  return {
    env,
    fetch: (input, init) => fetch(input, init),
    async applySnapshot(snapshot) {
      const db = await lazyAdmin();
      const { data, error } = await db.rpc("apply_store_entitlement", { _snapshot: snapshot as never });
      if (error || typeof data !== "boolean") throw new Error("Store entitlement persistence failed");
      return data;
    },
    async isProcessed(eventId) {
      const db = await lazyAdmin();
      const { data, error } = await db.from("store_webhook_events").select("event_id").eq("event_id", eventId).maybeSingle();
      if (error) throw new Error("Webhook event lookup failed");
      return data !== null;
    },
    async markProcessed(eventId, eventType) {
      const db = await lazyAdmin();
      const { error } = await db.from("store_webhook_events")
        .upsert({ event_id: eventId, event_type: eventType }, { onConflict: "event_id", ignoreDuplicates: true });
      if (error) throw new Error("Webhook event record failed");
    },
  };
}
