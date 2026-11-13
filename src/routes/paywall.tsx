import { createFileRoute } from "@tanstack/react-router";
import { AppPreviewAccess } from "@/components/AppPreviewAccess";

export const Route = createFileRoute("/paywall")({
  validateSearch: (search: Record<string, unknown>): { plan?: "monthly" | "annual" | "lifetime" } => ({
    plan: search.plan === "monthly" || search.plan === "annual" || search.plan === "lifetime" ? search.plan : undefined,
  }),
  head: () => ({ meta: [{ title: "RestPilot — App preview" }] }),
  component: AppPreviewAccess,
});
