import { createFileRoute } from "@tanstack/react-router";
import { handleRevenueCatWebhook } from "@/lib/entitlements/store-sync.server";
import { storeSyncDeps } from "@/lib/entitlements/store-db.server";

// RevenueCat → RestPilot App Store entitlement webhook.
// Returns 404 unless IAP_ENABLED=true; requires the RevenueCat HMAC signature
// (REVENUECAT_WEBHOOK_SECRET) and, when configured, the Authorization header
// value (REVENUECAT_WEBHOOK_AUTHORIZATION). See
// docs/restpilot-upgrade-2026-11/APPLE-IAP-SETUP.md for the owner setup. Returns
// 503 while the store_entitlements migration is not applied.
export const Route = createFileRoute("/api/public/iap/revenuecat")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const deps = await storeSyncDeps();
        return handleRevenueCatWebhook(request, {
          ...deps,
          nowSeconds: () => Math.floor(Date.now() / 1000),
          log: (message) => console.error(message),
        });
      },
    },
  },
});
