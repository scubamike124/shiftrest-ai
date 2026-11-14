// Server-side App Store entitlement sync through RevenueCat.
//
// Two entry points share one code path:
//   - handleRevenueCatWebhook(): POST /api/public/iap/revenuecat (signed by RevenueCat)
//   - syncStoreEntitlement():   the signed-in user's own "Restore" / post-purchase refresh
//
// Neither trusts a payload for entitlement state. Both fetch the canonical
// subscriber from RevenueCat's REST API (RevenueCat's own recommendation) and
// write it with apply_store_entitlement(), which refuses to let an older
// snapshot overwrite a newer one. Inert unless IAP_ENABLED=true.

import { affectedUserIds, isAppUserId, snapshotsFromSubscriber, type StoreSnapshot } from "./revenuecat";

type Env = Record<string, string | undefined>;

export function iapServerEnabled(env: Env): boolean {
  return env.IAP_ENABLED === "true";
}

export interface StoreSyncDeps {
  env: Env;
  fetch: typeof fetch;
  /** Calls public.apply_store_entitlement; resolves true when written, false when stale/unknown user. */
  applySnapshot(snapshot: StoreSnapshot): Promise<boolean>;
}

export interface WebhookDeps extends StoreSyncDeps {
  isProcessed(eventId: string): Promise<boolean>;
  markProcessed(eventId: string, eventType: string | null): Promise<void>;
  nowSeconds(): number;
  log?(message: string): void;
}

const REVENUECAT_API = "https://api.revenuecat.com/v1/subscribers/";
const MAX_BODY_BYTES = 64 * 1024;
const SIGNATURE_TOLERANCE_SECONDS = 300;

export async function syncStoreEntitlement(userId: string, deps: StoreSyncDeps): Promise<StoreSnapshot[]> {
  if (!isAppUserId(userId)) throw new Error("Invalid app user id");
  const key = deps.env.REVENUECAT_SECRET_API_KEY;
  if (!key) throw new Error("RevenueCat is not configured");
  const res = await deps.fetch(REVENUECAT_API + encodeURIComponent(userId), {
    method: "GET",
    headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
    redirect: "error",
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`RevenueCat subscriber lookup failed (${res.status})`);
  const snapshots = snapshotsFromSubscriber(userId, await res.json());
  for (const snapshot of snapshots) await deps.applySnapshot(snapshot);
  return snapshots;
}

function constantTimeEqual(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a);
  const eb = new TextEncoder().encode(b);
  let diff = ea.length ^ eb.length;
  const n = Math.max(ea.length, eb.length);
  for (let i = 0; i < n; i++) diff |= (ea[i] ?? 0) ^ (eb[i] ?? 0);
  return diff === 0;
}

/** RevenueCat webhook HMAC: header `t=<unix>,v1=<hex>` over `${t}.${rawBody}`. */
export async function verifyRevenueCatSignature(
  header: string | null,
  rawBody: string,
  secret: string,
  nowSeconds: number,
): Promise<boolean> {
  if (!header || !secret) return false;
  let t: string | undefined;
  const v1: string[] = [];
  for (const part of header.split(",")) {
    const [k, v] = part.trim().split("=", 2);
    if (k === "t") t = v;
    else if (k === "v1" && v) v1.push(v.toLowerCase());
  }
  if (!t || !/^\d{1,12}$/.test(t) || v1.length === 0) return false;
  if (Math.abs(nowSeconds - Number(t)) > SIGNATURE_TOLERANCE_SECONDS) return false;
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${t}.${rawBody}`));
  const expected = Array.from(new Uint8Array(mac), (b) => b.toString(16).padStart(2, "0")).join("");
  let ok = false;
  for (const candidate of v1) ok = constantTimeEqual(candidate, expected) || ok;
  return ok;
}

const text = (body: string, status: number) =>
  new Response(body, { status, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });

export async function handleRevenueCatWebhook(request: Request, deps: WebhookDeps): Promise<Response> {
  const { env } = deps;
  if (!iapServerEnabled(env)) return text("Not found", 404);
  if (!env.REVENUECAT_WEBHOOK_SECRET || !env.REVENUECAT_SECRET_API_KEY) {
    deps.log?.("RevenueCat webhook received but REVENUECAT_WEBHOOK_SECRET or REVENUECAT_SECRET_API_KEY is not set");
    return text("Not configured", 503);
  }
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > MAX_BODY_BYTES) return text("Payload too large", 413);
  const raw = await request.text();
  if (new TextEncoder().encode(raw).length > MAX_BODY_BYTES) return text("Payload too large", 413);

  const signed = await verifyRevenueCatSignature(
    request.headers.get("x-revenuecat-webhook-signature"), raw, env.REVENUECAT_WEBHOOK_SECRET, deps.nowSeconds(),
  );
  const expectedAuth = env.REVENUECAT_WEBHOOK_AUTHORIZATION;
  const authorized = !expectedAuth || constantTimeEqual(request.headers.get("authorization") ?? "", expectedAuth);
  if (!signed || !authorized) return text("Invalid signature", 401);

  let event: Record<string, unknown>;
  try {
    const parsed = JSON.parse(raw) as { event?: unknown };
    if (typeof parsed?.event !== "object" || parsed.event === null) throw new Error("no event");
    event = parsed.event as Record<string, unknown>;
  } catch {
    return text("Malformed event", 400);
  }
  const eventId = event.id;
  if (typeof eventId !== "string" || eventId.length < 1 || eventId.length > 128) return text("Malformed event", 400);
  const eventType = typeof event.type === "string" ? event.type.slice(0, 64) : null;

  try {
    if (await deps.isProcessed(eventId)) return Response.json({ received: true, duplicate: true });
    // TEST events and anonymous purchasers carry no RestPilot user: acknowledge.
    for (const userId of affectedUserIds(event)) await syncStoreEntitlement(userId, deps);
    await deps.markProcessed(eventId, eventType);
    return Response.json({ received: true });
  } catch (error) {
    deps.log?.(`RevenueCat webhook sync failed: ${error instanceof Error ? error.message : String(error)}`);
    // Retryable: RevenueCat redelivers non-200 responses with backoff.
    return text("Webhook error", 500);
  }
}
