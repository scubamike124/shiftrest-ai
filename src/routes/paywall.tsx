import { createFileRoute } from "@tanstack/react-router";
import { AppAwarePaywall } from "@/components/subscription/AppAwarePaywall";

export const Route = createFileRoute("/paywall")({
  // Lifetime was discontinued for new customers; a stale lifetime plan link is ignored.
  validateSearch: (search: Record<string, unknown>): { plan?: "monthly" | "annual" } => ({
    plan: search.plan === "monthly" || search.plan === "annual" ? search.plan : undefined,
  }),
  head: () => ({ meta: [{ title: "RestPilot — App preview" }] }),
  component: AppAwarePaywall,
});
