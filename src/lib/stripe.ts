// Web checkout is disabled for the native-app migration.
// Store purchases require a separate verified native entitlement integration.
type StripeEnv = "sandbox" | "live";
export function getStripeEnvironment(): StripeEnv {
  throw new Error("Web payments are disabled for the app build.");
}
export function isPaymentsConfigured(): boolean { return false; }
