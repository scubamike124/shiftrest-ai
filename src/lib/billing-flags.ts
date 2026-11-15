// Website (Stripe) checkout switch.
//
// Owner decision (Nov 15 2026): new RestPilot subscriptions are sold through
// Apple's App Store (In-App Purchase in the iPhone app), not Stripe. With
// VITE_WEB_CHECKOUT_ENABLED unset or anything other than "true" (the
// default), the website shows plan information only:
//   - no Stripe checkout and no start-trial button on any page;
//   - createCheckoutSession refuses on the server before any Stripe call.
// Existing Stripe subscribers are not affected: the Stripe webhook, the
// Customer Portal (Profile → Manage subscription / Manage billing), account
// deletion's Stripe cancel and lifetime access all keep working.
//
// REVENUE RISK: while this is off and the App Store app is not live yet,
// nobody can start a new paid subscription anywhere. The owner chooses when
// to Publish it. To sell on the website again, set
// VITE_WEB_CHECKOUT_ENABLED="true" in .env.production and Publish.
//
// The value is inlined at build time (Vite), identically in the client and
// server bundles, so the page and the server always agree.

export function webCheckoutEnabled(): boolean {
  return import.meta.env.VITE_WEB_CHECKOUT_ENABLED === "true";
}

/** Server refusal when website checkout is off. */
export const WEB_CHECKOUT_DISABLED_MESSAGE =
  "New subscriptions aren't sold on the website. Subscribe in the RestPilot iPhone app.";

/** Neutral website copy shown where a purchase or trial button used to be.
 *  No App Store link or badge: the owner adds one once the app is live. */
export const APP_ONLY_PURCHASE_NOTE = "New subscriptions are available in the RestPilot iPhone app.";

/** Publishable Stripe token of this build (pk_test_… / pk_live_…), or "". */
export function paymentsClientToken(): string {
  const token = import.meta.env.VITE_PAYMENTS_CLIENT_TOKEN as string | undefined;
  return typeof token === "string" ? token : "";
}

/** RevenueCat public Apple SDK key (appl_…), or null when unset or malformed.
 *  Public by design (it ships inside every iOS app); no secret lives here.
 *  Without it the iPhone app keeps the neutral "not available yet" screen. */
export function revenueCatIosKey(): string | null {
  const key = import.meta.env.VITE_REVENUECAT_IOS_API_KEY as string | undefined;
  return typeof key === "string" && /^appl_[A-Za-z0-9]+$/.test(key) ? key : null;
}
