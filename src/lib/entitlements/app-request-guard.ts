// App Store Review Guideline 3.1.1: digital subscriptions used inside the iPhone
// app must be sold through In-App Purchase, never through website Stripe.
//
// The iPhone shell appends "RestPilotApp/<version>" to its WebView user agent
// (ios-app/capacitor.config.json, tests/native-user-agent.test.mjs). The Stripe
// server functions refuse any request that carries it, so even a hand-built call
// from inside the app cannot create a website checkout or open the Stripe portal.
// Defense in depth: the in-app UI already never renders these controls.

export const NATIVE_APP_UA_TOKEN = "RestPilotApp/";

export const APP_PURCHASE_REFUSED_MESSAGE =
  "Purchases are not available on the web inside the RestPilot app. Manage subscriptions in iPhone Settings, your name, Subscriptions.";

export function isNativeAppUserAgent(userAgent: string | null | undefined): boolean {
  return typeof userAgent === "string" && userAgent.includes(NATIVE_APP_UA_TOKEN);
}
