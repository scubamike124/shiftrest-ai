// Pure RevenueCat helpers shared by the server sync and the app paywall.
// No IO and no env reads: tested in tests/revenuecat-sync.test.mjs.

import type { BillingEnvironment } from "./merge";

/** App Store Connect product IDs (permanent once created; never reuse).
 *  They match the Stripe lookup keys so reports line up across channels.
 *  Prices are set in App Store Connect: $7.99/month, $49.99/year, each with
 *  a 14-day free-trial introductory offer. No lifetime product exists. */
export const APP_STORE_PRODUCTS = Object.freeze({
  restpilot_monthly: "monthly",
  restpilot_annual: "annual",
} as const);
export type AppStorePlan = (typeof APP_STORE_PRODUCTS)[keyof typeof APP_STORE_PRODUCTS];

export function planForProduct(productId: unknown): AppStorePlan | null {
  if (typeof productId !== "string") return null;
  // RevenueCat may report "<subscription id>:<base plan>" on other stores; App
  // Store IDs have no colon, so require an exact match.
  return Object.prototype.hasOwnProperty.call(APP_STORE_PRODUCTS, productId)
    ? APP_STORE_PRODUCTS[productId as keyof typeof APP_STORE_PRODUCTS]
    : null;
}

/** Supabase auth user IDs are UUIDs. RevenueCat anonymous IDs
 *  ("$RCAnonymousID:...") and anything else are never ours. */
export function isAppUserId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
  );
}

export interface StoreSnapshot {
  user_id: string;
  environment: BillingEnvironment;
  store: "app_store" | null;
  product_id: string | null;
  plan: AppStorePlan | null;
  period_type: "trial" | "intro" | "normal" | "prepaid" | null;
  expires_at: string | null;
  grace_expires_at: string | null;
  will_renew: boolean;
  billing_issue: boolean;
  management_url: string | null;
  snapshot_at: string;
}

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json =>
  typeof v === "object" && v !== null && !Array.isArray(v);

function isoOrNull(v: unknown): string | null {
  if (typeof v !== "string" || v === "") return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

function safeManagementUrl(v: unknown): string | null {
  if (typeof v !== "string") return null;
  try {
    const u = new URL(v);
    return u.protocol === "https:" && u.hostname === "apps.apple.com" && !u.username && !u.password
      ? u.toString()
      : null;
  } catch {
    return null;
  }
}

/**
 * Convert a RevenueCat `GET /v1/subscribers/{app_user_id}` response into one
 * snapshot per App Store environment (live and sandbox). An environment with
 * no RestPilot App Store subscription produces an empty snapshot, which
 * clears a stale row (for example after a restore moved the purchase to a
 * different RestPilot account). Refunded subscriptions grant nothing.
 * Throws on a malformed response so the caller returns a retryable error.
 */
export function snapshotsFromSubscriber(userId: string, body: unknown): StoreSnapshot[] {
  if (!isAppUserId(userId)) throw new Error("Invalid app user id");
  if (!isObject(body) || !isObject(body.subscriber))
    throw new Error("Malformed RevenueCat subscriber response");
  const requestMs = body.request_date_ms;
  if (typeof requestMs !== "number" || !Number.isFinite(requestMs) || requestMs <= 0) {
    throw new Error("RevenueCat response has no request time");
  }
  const snapshotAt = new Date(requestMs).toISOString();
  const subscriber = body.subscriber;
  const subscriptions = isObject(subscriber.subscriptions) ? subscriber.subscriptions : {};
  const managementUrl = safeManagementUrl(subscriber.management_url);

  const out: StoreSnapshot[] = [];
  for (const environment of ["live", "sandbox"] as const) {
    let best: { productId: string; sub: Json; end: number } | null = null;
    for (const [productId, sub] of Object.entries(subscriptions)) {
      if (!isObject(sub) || planForProduct(productId) === null) continue;
      if (sub.store !== "app_store") continue;
      if ((sub.is_sandbox === true) !== (environment === "sandbox")) continue;
      if (sub.refunded_at) continue;
      const expires = isoOrNull(sub.expires_date);
      if (!expires) continue;
      const grace = isoOrNull(sub.grace_period_expires_date);
      const end = Math.max(Date.parse(expires), grace ? Date.parse(grace) : 0);
      if (!best || end > best.end) best = { productId, sub, end };
    }
    if (!best) {
      out.push({
        user_id: userId,
        environment,
        store: null,
        product_id: null,
        plan: null,
        period_type: null,
        expires_at: null,
        grace_expires_at: null,
        will_renew: false,
        billing_issue: false,
        management_url: null,
        snapshot_at: snapshotAt,
      });
      continue;
    }
    const pt = best.sub.period_type;
    out.push({
      user_id: userId,
      environment,
      store: "app_store",
      product_id: best.productId,
      plan: planForProduct(best.productId),
      period_type:
        pt === "trial" || pt === "intro" || pt === "normal" || pt === "prepaid" ? pt : null,
      expires_at: isoOrNull(best.sub.expires_date),
      grace_expires_at: isoOrNull(best.sub.grace_period_expires_date),
      will_renew: !best.sub.unsubscribe_detected_at,
      billing_issue: Boolean(best.sub.billing_issues_detected_at),
      management_url: managementUrl,
      snapshot_at: snapshotAt,
    });
  }
  return out;
}

/** RevenueCat user IDs an event can affect: the purchaser, its aliases and
 *  both sides of a TRANSFER. Only RestPilot (Supabase UUID) IDs; deduped;
 *  capped so a hostile payload cannot fan out unbounded API calls. */
export function affectedUserIds(event: unknown, limit = 10): string[] {
  if (!isObject(event)) return [];
  const ids: string[] = [];
  const add = (v: unknown) => {
    if (isAppUserId(v)) {
      const id = v.toLowerCase();
      if (!ids.includes(id)) ids.push(id);
    }
  };
  add(event.app_user_id);
  add(event.original_app_user_id);
  for (const key of ["aliases", "transferred_from", "transferred_to"]) {
    const list = event[key];
    if (Array.isArray(list)) list.forEach(add);
  }
  return ids.slice(0, limit);
}

/** Map RevenueCat offering packages to our plans (client paywall). */
export interface RevenueCatPackage {
  identifier: string;
  product: { identifier: string; priceString?: string; introPrice?: { price?: number } | null };
  [key: string]: unknown;
}
export function packagesByPlan(
  offerings: unknown,
): Partial<Record<AppStorePlan, RevenueCatPackage>> {
  const out: Partial<Record<AppStorePlan, RevenueCatPackage>> = {};
  if (!isObject(offerings) || !isObject(offerings.current)) return out;
  const pkgs = offerings.current.availablePackages;
  if (!Array.isArray(pkgs)) return out;
  for (const pkg of pkgs) {
    if (!isObject(pkg) || !isObject(pkg.product)) continue;
    const plan = planForProduct(pkg.product.identifier);
    if (plan && !out[plan]) out[plan] = pkg as unknown as RevenueCatPackage;
  }
  return out;
}
