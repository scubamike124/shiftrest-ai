import { Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Check, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { createCheckoutSession } from "@/lib/billing.functions";
import { getStripeEnvironment, loadStripeJs, type EmbeddedCheckout } from "@/lib/stripe";
import { RenewalDisclosure } from "@/components/legal/RenewalDisclosure";

// Website checkout (direct Stripe on Railway). Rendered only on the website
// when VITE_STRIPE_CHECKOUT_ENABLED and a publishable key are set; the native
// app keeps the App preview screen. Same plans, trial and server call as
// production main: monthly $7.99 or annual $49.99 with a 14-day free trial.
// Lifetime is no longer sold.
type Plan = "monthly" | "annual";
const PRICE_IDS: Record<Plan, string> = {
  monthly: "restpilot_monthly",
  annual: "restpilot_annual",
};
const PENDING_KEY = "restpilot_pending_checkout";

function initialPlan(): Plan {
  if (typeof window === "undefined") return "annual";
  return new URLSearchParams(window.location.search).get("plan") === "monthly"
    ? "monthly"
    : "annual";
}

function EmbeddedCheckoutMount({ clientSecret }: { clientSecret: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState<string | null>(null);
  useEffect(() => {
    let checkout: EmbeddedCheckout | null = null;
    let cancelled = false;
    loadStripeJs()
      .then((stripe) => stripe.createEmbeddedCheckoutPage({ clientSecret }))
      .then((c) => {
        if (cancelled) return c.destroy();
        checkout = c;
        if (ref.current) c.mount(ref.current);
      })
      .catch((e: unknown) =>
        setFailed(e instanceof Error ? e.message : "Checkout failed to load."),
      );
    return () => {
      cancelled = true;
      checkout?.destroy();
    };
  }, [clientSecret]);
  if (failed)
    return <p className="rounded-2xl border border-border bg-card p-4 text-sm">{failed}</p>;
  return <div ref={ref} aria-label="Secure checkout" className="min-h-40" />;
}

export function WebStripeCheckout() {
  const navigate = useNavigate();
  const [plan, setPlan] = useState<Plan>(initialPlan);
  const [loading, setLoading] = useState(false);
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const resumed = useRef(false);

  async function startCheckout(selected: Plan) {
    setLoading(true);
    try {
      const { data } = await supabase.auth.getSession();
      if (!data.session) {
        sessionStorage.setItem(PENDING_KEY, selected);
        toast.info("Sign in to continue to checkout.");
        navigate({ to: "/auth", search: { return: "/paywall" } as never });
        return;
      }
      const result = await createCheckoutSession({
        data: {
          priceId: PRICE_IDS[selected],
          environment: getStripeEnvironment(),
          returnUrl: `${window.location.origin}/profile?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
        },
      });
      if ("error" in result) throw new Error(result.error);
      if (!result.clientSecret) throw new Error("Checkout could not be started.");
      setClientSecret(result.clientSecret);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "We couldn't open checkout. Please try again.",
      );
    } finally {
      setLoading(false);
    }
  }

  // Resume after a sign-in detour. A stale "lifetime" intent is ignored.
  useEffect(() => {
    if (resumed.current) return;
    resumed.current = true;
    const pending = sessionStorage.getItem(PENDING_KEY);
    sessionStorage.removeItem(PENDING_KEY);
    if (pending !== "monthly" && pending !== "annual") return;
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) return;
      setPlan(pending);
      void startCheckout(pending);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (clientSecret) {
    return (
      <main className="mx-auto flex w-full max-w-xl flex-col px-5 pt-12 pb-6">
        <button
          onClick={() => setClientSecret(null)}
          className="mb-4 self-start text-xs font-medium text-primary underline"
        >
          ← Back to plans
        </button>
        <EmbeddedCheckoutMount clientSecret={clientSecret} />
      </main>
    );
  }

  const plans: { id: Plan; label: string; price: string; sub: string; badge?: string }[] = [
    { id: "monthly", label: "Monthly", price: "$7.99", sub: "per month · 14-day free trial" },
    {
      id: "annual",
      label: "Annual",
      price: "$49.99",
      sub: "per year · save 48% · 14-day free trial",
      badge: "Most popular",
    },
  ];

  return (
    <main className="mx-auto flex w-full max-w-xl flex-col px-5 pt-12 pb-6">
      <h1 className="text-3xl font-bold leading-tight">RestPilot Premium</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        The AI Sleep Coach and adaptive notifications built for shift work.
      </p>
      <div className="mt-6 flex flex-col gap-3" role="radiogroup" aria-label="Choose a plan">
        {plans.map((p) => (
          <button
            key={p.id}
            type="button"
            role="radio"
            aria-checked={plan === p.id}
            onClick={() => setPlan(p.id)}
            className={`flex items-center justify-between rounded-2xl border p-4 text-left ${plan === p.id ? "border-primary bg-primary/10" : "border-border bg-card"}`}
          >
            <span>
              <span className="block text-sm font-semibold">
                {p.label}
                {p.badge && (
                  <span className="ml-2 rounded-full bg-primary/15 px-2 py-0.5 text-[10px] text-primary">
                    {p.badge}
                  </span>
                )}
              </span>
              <span className="mt-0.5 block text-xs text-muted-foreground">{p.sub}</span>
            </span>
            <span className="flex items-center gap-2 text-lg font-bold">
              {p.price}
              {plan === p.id && <Check className="h-4 w-4 text-primary" aria-hidden="true" />}
            </span>
          </button>
        ))}
      </div>
      <div className="mt-4">
        <RenewalDisclosure />
      </div>
      <button
        onClick={() => startCheckout(plan)}
        disabled={loading}
        className="mt-5 h-14 w-full rounded-2xl bg-primary text-base font-semibold text-primary-foreground active:scale-[0.99] disabled:opacity-60"
      >
        {loading ? "Please wait…" : "Start 14-day free trial"}
      </button>
      <p className="mt-2 text-center text-[11px] text-muted-foreground">
        No charge today · Cancel anytime before your trial ends
      </p>
      <p className="mt-4 inline-flex items-center justify-center gap-1.5 text-[10px] text-muted-foreground">
        <ShieldCheck className="h-3 w-3" aria-hidden="true" /> Secure checkout powered by Stripe
      </p>
      <p className="mt-4 text-center text-[10px] text-muted-foreground">
        <Link to="/legal/terms" className="text-primary underline">
          Terms
        </Link>{" "}
        ·{" "}
        <Link to="/legal/privacy" className="text-primary underline">
          Privacy
        </Link>{" "}
        ·{" "}
        <Link to="/legal/subscription" className="text-primary underline">
          Subscription Terms
        </Link>
      </p>
    </main>
  );
}
