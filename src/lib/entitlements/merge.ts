// One entitlement per user, merged from every billing channel.
//
// Channels:
//   - "stripe": rows in public.subscriptions, written only by the signed Stripe
//     webhook (src/routes/api/public/payments/webhook.ts). Unchanged here.
//   - "apple":  rows in public.store_entitlements, written only by the signed
//     RevenueCat webhook / authenticated sync (src/lib/entitlements/store-sync.server.ts).
//
// This module is pure (no IO, no env) so the merge rules are unit-tested in
// tests/entitlement-merge.test.mjs. It never grants access on missing or
// malformed data: unknown statuses, unparsable dates and absent expiry all
// resolve to "no entitlement from this row".

export type Plan = "monthly" | "annual" | "lifetime";
export type EntitlementSource = "stripe" | "apple";
/** active: paid period running; trialing: free trial; grace: access continues
 *  without renewal (Stripe canceled-but-paid-through, Apple billing grace);
 *  lifetime: legacy one-time Stripe purchase (no longer sold, still honored). */
export type ChannelState = "active" | "trialing" | "grace" | "lifetime";
export type BillingEnvironment = "live" | "sandbox";

export interface ChannelEntitlement {
  source: EntitlementSource;
  plan: Plan | null;
  state: ChannelState;
  /** Epoch ms when access ends; null only for lifetime. */
  expiresAt: number | null;
  /** True when this channel will charge the user again. */
  willRenew: boolean;
  environment: BillingEnvironment;
}

export interface Entitlement {
  active: boolean;
  /** Channel that the UI treats as the user's plan (highest-ranked). */
  source: EntitlementSource | null;
  plan: Plan | null;
  state: ChannelState | "none";
  expiresAt: number | null;
  willRenew: boolean;
  /** Every channel currently granting access, highest-ranked first. */
  channels: ChannelEntitlement[];
  hasStripe: boolean;
  hasApple: boolean;
  /** Two or more channels will renew: the user is (or will be) double billed. */
  duplicateBilling: boolean;
  /** A Stripe subscription in this environment is past_due or unpaid: it
   *  grants nothing now but can charge again once the card is fixed. Never
   *  offer a second (App Store) subscription on top of it. */
  stripeBillingIssue: boolean;
}

export const NO_ENTITLEMENT: Entitlement = Object.freeze({
  active: false,
  source: null,
  plan: null,
  state: "none",
  expiresAt: null,
  willRenew: false,
  channels: [],
  hasStripe: false,
  hasApple: false,
  duplicateBilling: false,
  stripeBillingIssue: false,
}) as Entitlement;

/** Shape of public.subscriptions columns the merge needs. */
export interface StripeSubscriptionRow {
  status: string | null;
  price_id: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean | null;
  environment: string | null;
}

/** Shape of public.store_entitlements (supabase/migrations/20261114120000_store_entitlements.sql). */
export interface StoreEntitlementRow {
  environment: string | null;
  plan: string | null;
  period_type: string | null;
  expires_at: string | null;
  grace_expires_at: string | null;
  will_renew: boolean | null;
}

const STRIPE_PLAN_BY_PRICE: Record<string, Plan> = {
  restpilot_monthly: "monthly",
  restpilot_annual: "annual",
  restpilot_lifetime: "lifetime",
};

function parseTime(value: string | null | undefined): number | null {
  if (typeof value !== "string" || value === "") return null;
  const t = Date.parse(value);
  return Number.isFinite(t) ? t : null;
}

function env(value: string | null | undefined): BillingEnvironment | null {
  return value === "live" || value === "sandbox" ? value : null;
}

/** Same grant rules as the voice gate (src/lib/realtime/access.server.ts):
 *  lifetime; active/trialing with a future period end; canceled but paid
 *  through a future period end. Everything else (past_due, unpaid,
 *  incomplete, paused, null dates) grants nothing. */
export function stripeChannel(row: StripeSubscriptionRow, now: number): ChannelEntitlement | null {
  const environment = env(row.environment);
  if (!environment) return null;
  const plan = (row.price_id && STRIPE_PLAN_BY_PRICE[row.price_id]) || null;
  if (row.status === "lifetime") {
    return {
      source: "stripe",
      plan: "lifetime",
      state: "lifetime",
      expiresAt: null,
      willRenew: false,
      environment,
    };
  }
  const end = parseTime(row.current_period_end);
  if (end === null || end <= now) return null;
  const renewing = row.cancel_at_period_end !== true;
  switch (row.status) {
    case "active":
      return {
        source: "stripe",
        plan,
        state: renewing ? "active" : "grace",
        expiresAt: end,
        willRenew: renewing,
        environment,
      };
    case "trialing":
      return {
        source: "stripe",
        plan,
        state: "trialing",
        expiresAt: end,
        willRenew: renewing,
        environment,
      };
    case "canceled":
      return {
        source: "stripe",
        plan,
        state: "grace",
        expiresAt: end,
        willRenew: false,
        environment,
      };
    default:
      return null;
  }
}

/** Apple (via RevenueCat) snapshot row. Access runs to the later of the
 *  entitlement expiry and Apple's billing grace period. A row without an
 *  expiry grants nothing: we sell no non-expiring App Store products. */
export function appleChannel(row: StoreEntitlementRow, now: number): ChannelEntitlement | null {
  const environment = env(row.environment);
  if (!environment) return null;
  const expires = parseTime(row.expires_at);
  if (expires === null) return null;
  const grace = parseTime(row.grace_expires_at);
  const end = grace !== null && grace > expires ? grace : expires;
  if (end <= now) return null;
  const plan: Plan | null = row.plan === "monthly" || row.plan === "annual" ? row.plan : null;
  const willRenew = row.will_renew === true;
  let state: ChannelState;
  if (expires <= now) state = "grace";
  else if (row.period_type === "trial") state = "trialing";
  else state = willRenew ? "active" : "grace";
  return { source: "apple", plan, state, expiresAt: end, willRenew, environment };
}

const STATE_RANK: Record<ChannelState, number> = { lifetime: 3, active: 2, grace: 1, trialing: 0 };

/** Higher first: lifetime > paid active > paid grace > trial; then renewing;
 *  then later expiry; then Stripe before Apple (stable, existing customers). */
function compareChannels(a: ChannelEntitlement, b: ChannelEntitlement): number {
  return (
    STATE_RANK[b.state] - STATE_RANK[a.state] ||
    Number(b.willRenew) - Number(a.willRenew) ||
    (b.expiresAt ?? Infinity) - (a.expiresAt ?? Infinity) ||
    (a.source === b.source ? 0 : a.source === "stripe" ? -1 : 1)
  );
}

export interface MergeOptions {
  /** Stripe environment of this deployment; other environments are ignored. */
  stripeEnvironment: BillingEnvironment | null;
  /** Apple environments to honor. App Review purchases are sandbox, so a
   *  production server that sells via IAP must honor sandbox too. */
  appleEnvironments: readonly BillingEnvironment[];
  now?: number;
}

export function mergeEntitlements(
  stripeRows: readonly StripeSubscriptionRow[] | null | undefined,
  storeRows: readonly StoreEntitlementRow[] | null | undefined,
  options: MergeOptions,
): Entitlement {
  const now = options.now ?? Date.now();
  const channels: ChannelEntitlement[] = [];
  const stripeBillingIssue = (stripeRows ?? []).some(
    (row) =>
      options.stripeEnvironment !== null &&
      env(row.environment) === options.stripeEnvironment &&
      (row.status === "past_due" || row.status === "unpaid"),
  );
  for (const row of stripeRows ?? []) {
    const c = stripeChannel(row, now);
    if (c && c.environment === options.stripeEnvironment) channels.push(c);
  }
  for (const row of storeRows ?? []) {
    const c = appleChannel(row, now);
    if (c && options.appleEnvironments.includes(c.environment)) channels.push(c);
  }
  if (channels.length === 0)
    return stripeBillingIssue
      ? { ...NO_ENTITLEMENT, channels: [], stripeBillingIssue }
      : NO_ENTITLEMENT;
  channels.sort(compareChannels);
  const top = channels[0];
  return {
    active: true,
    source: top.source,
    plan: top.plan,
    state: top.state,
    expiresAt: top.expiresAt,
    willRenew: top.willRenew,
    channels,
    hasStripe: channels.some((c) => c.source === "stripe"),
    hasApple: channels.some((c) => c.source === "apple"),
    duplicateBilling: channels.filter((c) => c.willRenew).length >= 2,
    stripeBillingIssue,
  };
}

/** Adapter for row-based gates such as voiceEntitlement(): Apple channels in
 *  the {status, current_period_end} shape those gates already understand. */
export function appleRowsAsSubscriptionRows(
  storeRows: readonly StoreEntitlementRow[],
  appleEnvironments: readonly BillingEnvironment[],
  now = Date.now(),
): { status: string; current_period_end: string }[] {
  const out: { status: string; current_period_end: string }[] = [];
  for (const row of storeRows) {
    const c = appleChannel(row, now);
    if (!c || !appleEnvironments.includes(c.environment) || c.expiresAt === null) continue;
    // Anything that started as a free trial and has not been paid for yet
    // (trial, or billing grace right after a trial) stays metered as a trial.
    const status =
      c.state === "trialing" || row.period_type === "trial"
        ? "trialing"
        : c.state === "grace"
          ? "canceled"
          : "active";
    out.push({ status, current_period_end: new Date(c.expiresAt).toISOString() });
  }
  return out;
}

/** Which Stripe environment's rows count as "already subscribed" when
 *  deciding whether to offer a purchase. Same precedence as the voice gate
 *  (PAYMENTS_ENVIRONMENT, then the build's publishable token), but it never
 *  throws: when neither is configured — as on the Railway build, where web
 *  checkout is disabled — existing LIVE Stripe subscribers still count, so a
 *  paying website customer is never offered a second, App Store subscription. */
export function statusStripeEnvironment(
  vars: Record<string, string | undefined>,
): BillingEnvironment {
  const configured = vars.PAYMENTS_ENVIRONMENT;
  if (configured === "live" || configured === "sandbox") return configured;
  const token = vars.VITE_PAYMENTS_CLIENT_TOKEN;
  if (token?.startsWith("pk_test_")) return "sandbox";
  return "live";
}

/** App Store environments whose rows grant access on this server.
 *  Nothing unless IAP_ENABLED=true. Sandbox (App Review, TestFlight, sandbox
 *  testers) only with IAP_HONOR_SANDBOX=true as well: App Review needs it,
 *  but left on in production it gives every TestFlight tester free Premium. */
export function appleEnvironmentsFrom(
  vars: Record<string, string | undefined>,
): BillingEnvironment[] {
  if (vars.IAP_ENABLED !== "true") return [];
  return vars.IAP_HONOR_SANDBOX === "true" ? ["live", "sandbox"] : ["live"];
}
