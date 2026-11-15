// Database wiring for the App Store entitlement sync (service role only).
//
// public.store_entitlements, public.store_webhook_events and
// public.apply_store_entitlement() come from
// supabase/pending-migrations/20261115120000_store_entitlements.sql, which is
// applied only with the owner's approval. They are deliberately not in the
// generated Supabase types, so they are reached through a narrow untyped view
// of the client. If they are missing, every call throws StoreNotReadyError and
// the callers stay inert (webhook 503, restore "not available").
import process from "node:process";
import {
  isMissingRelationError,
  StoreNotReadyError,
  type StoreSyncDeps,
  type WebhookDeps,
} from "./store-sync.server";

type DbDeps = StoreSyncDeps & Pick<WebhookDeps, "isProcessed" | "markProcessed">;

type Result<T = unknown> = PromiseLike<{ data: T; error: unknown }>;
/** Just the calls made here, on tables the generated types don't know yet. */
export interface UntypedStoreClient {
  rpc(fn: "apply_store_entitlement", args: { _snapshot: unknown }): Result;
  from(table: "store_webhook_events"): {
    select(columns: string): { eq(column: string, value: string): { maybeSingle(): Result } };
    upsert(row: unknown, options: { onConflict: string; ignoreDuplicates: boolean }): Result;
  };
}

function fail(error: unknown, message: string): never {
  if (isMissingRelationError(error)) throw new StoreNotReadyError();
  throw new Error(message);
}

export function storeDbDeps(db: UntypedStoreClient, env: Record<string, string | undefined>): DbDeps {
  return {
    env,
    fetch: (input, init) => fetch(input, init),
    async applySnapshot(snapshot) {
      const { data, error } = await db.rpc("apply_store_entitlement", { _snapshot: snapshot });
      if (error) fail(error, "Store entitlement persistence failed");
      if (typeof data !== "boolean") throw new Error("Store entitlement persistence failed");
      return data;
    },
    async isProcessed(eventId) {
      const { data, error } = await db
        .from("store_webhook_events")
        .select("event_id")
        .eq("event_id", eventId)
        .maybeSingle();
      if (error) fail(error, "Webhook event lookup failed");
      return data !== null;
    },
    async markProcessed(eventId, eventType) {
      const { error } = await db
        .from("store_webhook_events")
        .upsert(
          { event_id: eventId, event_type: eventType },
          { onConflict: "event_id", ignoreDuplicates: true },
        );
      if (error) fail(error, "Webhook event record failed");
    },
  };
}

export async function storeSyncDeps(): Promise<DbDeps> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return storeDbDeps(
    supabaseAdmin as unknown as UntypedStoreClient,
    process.env as Record<string, string | undefined>,
  );
}
