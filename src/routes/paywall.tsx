import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/paywall")({
  validateSearch: (search: Record<string, unknown>): { plan?: "monthly" | "annual" | "lifetime" } => ({
    plan: search.plan === "monthly" || search.plan === "annual" || search.plan === "lifetime" ? search.plan : undefined,
  }),
  head: () => ({ meta: [{ title: "RestPilot — App preview" }] }),
  component: AppPreview,
});

function AppPreview() {
  return (
    <main className="mx-auto max-w-lg space-y-6 px-6 py-16">
      <h1 className="text-3xl font-semibold">RestPilot app preview</h1>
      <p className="text-muted-foreground">Purchases are unavailable during the White Glove test. No payment details are needed.</p>
      <p className="text-sm text-muted-foreground">Some premium features may remain unavailable until app access is configured.</p>
      <Link to="/" className="inline-flex rounded-xl bg-primary px-6 py-3 font-semibold text-primary-foreground">Back to RestPilot</Link>
    </main>
  );
}
