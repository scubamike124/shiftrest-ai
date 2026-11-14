// What the paywall may show, by surface and App Store storefront.
//
// Pure decision table, unit-tested in tests/paywall-policy.test.mjs. The UI
// (src/components/AppAwarePaywall.tsx) renders only what this returns.
//
// Rules (see docs/restpilot-upgrade-2026-11/SUBSCRIPTIONS.md for sources):
//   - Inside the native app, Stripe checkout and web purchase links are never
//     offered, except a US-storefront link-out behind its own flag, and only
//     next to In-App Purchase (never instead of it).
//   - Status unknown (loading or error) never shows a buy button: a returning
//     subscriber must not be offered a second subscription.
//   - Already entitled through any channel: show status and that channel's
//     manage path, never a buy button (double-billing prevention).
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
  /** Website Stripe checkout is configured for this build (web only). */
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
  view: "loading" | "status" | "purchase" | "unavailable";
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
  if (input.surface === "web") return input.webCheckoutEnabled ? "stripe_portal" : "stripe_text_only";
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

  if (!native) {
    return input.webCheckoutEnabled ? { ...base, view: "purchase", purchase: "web_checkout" } : base;
  }
  if (input.surface !== "ios" || !input.iapAvailable) return base;
  return {
    ...base,
    view: "purchase",
    purchase: "iap",
    externalPurchaseLink: input.usExternalLinkEnabled && isUsStorefront(input.storefront),
  };
}
