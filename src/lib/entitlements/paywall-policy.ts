// What the paywall may show, by surface and App Store storefront.
//
// Pure decision table, unit-tested in tests/paywall-policy.test.mjs. The UI
// (src/components/subscription/NativeSubscription.tsx) renders only what this returns.
//
// Rules (see docs/restpilot-upgrade-2026-11/APPLE-IAP-SETUP.md; Apple rule research
// with sources is in SUBSCRIPTIONS.md on the Railway branch and APP-STORE-COMPLIANCE.md):
//   - Inside the native app, Stripe checkout and web purchase links are never
//     offered. (The table supports a US-storefront link-out next to IAP, but
//     main always passes usExternalLinkEnabled=false: owner decision.)
//   - Status unknown (loading or error) never shows a buy button: a returning
//     subscriber must not be offered a second subscription.
//   - Already entitled through any channel: show status and that channel's
//     manage path, never a buy button (double-billing prevention).
//   - A Stripe subscription that is past_due/unpaid can still charge again:
//     show the billing problem and the Stripe manage path, never a buy button.
//   - Storefront unknown is treated as non-US.

import type { Entitlement, EntitlementSource } from "./merge";

export type Surface = "web" | "ios" | "other_native";

export interface PaywallInput {
  surface: Surface;
  /** IAP flag on AND the native purchases plugin and public SDK key are present. */
  iapAvailable: boolean;
  /** App Store storefront country (StoreKit: ISO 3166-1 alpha-3, e.g. "USA"). */
  storefront: string | null;
  /** Separate flag for the US-storefront external purchase link. */
  usExternalLinkEnabled: boolean;
  /** NEW website Stripe checkout is enabled (VITE_WEB_CHECKOUT_ENABLED; web only). */
  webCheckoutEnabled: boolean;
  /** null while loading or when the status could not be read. */
  entitlement: Entitlement | null;
}

/** How a channel's subscription is managed or canceled from this surface.
 *  - app_store: Apple's subscription management (Settings or apps.apple.com).
 *  - stripe_portal: a working button into the Stripe billing portal (web) or
 *    a link to the website account page (US storefront link flag only).
 *  - stripe_text_only: plain text naming the website, no link or button. */
export type ManagePath = "app_store" | "stripe_portal" | "stripe_text_only";

export interface PaywallDecision {
  view: "loading" | "status" | "billing_issue" | "purchase" | "unavailable";
  purchase: "iap" | "web_checkout" | null;
  manage: { source: EntitlementSource; path: ManagePath }[];
  restore: boolean;
  externalPurchaseLink: boolean;
  duplicateBillingWarning: boolean;
}

export function isUsStorefront(storefront: string | null | undefined): boolean {
  if (typeof storefront !== "string") return false;
  const code = storefront.trim().toUpperCase();
  return code === "USA" || code === "US";
}

function managePath(source: EntitlementSource, input: PaywallInput): ManagePath {
  if (source === "apple") return "app_store";
  // On the website the Stripe Customer Portal always works for existing
  // subscribers, whether or not NEW website checkout is enabled.
  if (input.surface === "web") return "stripe_portal";
  // Native: a link to the website billing page is only allowed where links to
  // other purchase mechanisms are allowed (US storefront), behind its flag.
  if (input.surface === "ios" && input.usExternalLinkEnabled && isUsStorefront(input.storefront)) {
    return "stripe_portal";
  }
  return "stripe_text_only";
}

export function decidePaywall(input: PaywallInput): PaywallDecision {
  const native = input.surface !== "web";
  const restore = input.surface === "ios" && input.iapAvailable;
  const base: PaywallDecision = {
    view: "unavailable",
    purchase: null,
    manage: [],
    restore,
    externalPurchaseLink: false,
    duplicateBillingWarning: false,
  };

  if (input.entitlement === null) return { ...base, view: "loading" };

  const ent = input.entitlement;
  if (ent.active) {
    const sources: EntitlementSource[] = [];
    for (const c of ent.channels) if (!sources.includes(c.source)) sources.push(c.source);
    return {
      ...base,
      view: "status",
      manage: sources.map((source) => ({ source, path: managePath(source, input) })),
      duplicateBillingWarning: ent.duplicateBilling,
    };
  }

  if (ent.stripeBillingIssue) {
    return {
      ...base,
      view: "billing_issue",
      manage: [{ source: "stripe", path: managePath("stripe", input) }],
    };
  }

  if (!native) {
    return input.webCheckoutEnabled
      ? { ...base, view: "purchase", purchase: "web_checkout" }
      : base;
  }
  if (input.surface !== "ios" || !input.iapAvailable) return base;
  return {
    ...base,
    view: "purchase",
    purchase: "iap",
    externalPurchaseLink: input.usExternalLinkEnabled && isUsStorefront(input.storefront),
  };
}
