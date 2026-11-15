import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { getSubscriptionState } from "@/lib/subscription";
import { NATIVE_PURCHASE_UNAVAILABLE } from "@/lib/native-app";

// Shown inside the app instead of any purchase screen. Neutral by design
// (App Store Guideline 3.1.1): no prices, no purchase button, no link or
// wording that points to buying on the website. Existing subscribers see
// their plan status.
export function NativeSubscriptionNotice() {
  const { data: sub } = useQuery({
    queryKey: ["subscription-state"],
    queryFn: getSubscriptionState,
  });
  const plan = sub?.isPremium
    ? sub.tier === "lifetime"
      ? "Lifetime access"
      : `Premium · ${sub.tier === "annual" ? "Annual" : "Monthly"}${sub.status === "trialing" ? " (free trial)" : ""}`
    : null;
  return (
    <main className="flex flex-col gap-4 px-5 pt-12 pb-6">
      <h1 className="text-2xl font-bold">{NATIVE_PURCHASE_UNAVAILABLE}</h1>
      {plan ? (
        <section className="rounded-2xl border border-primary/30 bg-primary/10 p-4">
          <p className="text-sm font-semibold">Your plan: {plan}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {sub?.tier === "lifetime"
              ? "Thank you for being a Founding Member."
              : sub?.expiresAt
                ? `${sub.cancelAtPeriodEnd ? "Ends" : "Renews"} on ${sub.expiresAt.toLocaleDateString()}`
                : "Active"}
          </p>
        </section>
      ) : (
        <p className="text-sm text-muted-foreground">
          You can keep using RestPilot&apos;s free features here.
        </p>
      )}
      <Link
        to="/dashboard"
        className="mt-2 text-sm font-medium text-primary underline-offset-4 hover:underline"
      >
        Back to RestPilot
      </Link>
    </main>
  );
}
