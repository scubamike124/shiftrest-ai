import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Check, Sparkles, ShieldCheck } from "lucide-react";
import { EmbeddedCheckoutProvider, EmbeddedCheckout } from "@stripe/react-stripe-js";
import { DISCLAIMER } from "@/lib/shifts";
import { restorePurchases, type SubscriptionTier } from "@/lib/subscription";
import { supabase } from "@/integrations/supabase/client";
import { getStripe, getStripeEnvironment, isPaymentsConfigured } from "@/lib/stripe";
import { createCheckoutSession } from "@/lib/billing.functions";
import { toast } from "sonner";

export const Route = createFileRoute("/paywall")({
  head: () => ({
    meta: [
      { title: "RestPilot Premium — Unlock the AI Sleep Coach" },
      {
        name: "description",
        content:
          "Unlock unlimited AI Sleep Coach conversations, voice briefings, advanced wind-down notifications, and personalized recovery plans.",
      },
    ],
  }),
  component: Paywall,
});

const PERKS = [
  { title: "Unlimited AI Sleep Coach", desc: "Conversational, expert guidance whenever a shift throws you off." },
  { title: "Voice briefings & shift-swap copilot", desc: "60-second audio plans and AI swap analysis on demand." },
  { title: "Smart wind-down alerts", desc: "Gentle nudges before your sleep window — across rotating schedules." },
  { title: "Recovery plans for any rotation", desc: "Auto-built schedules for 2-on-2-off, 4-on-3-off, Pitman, DuPont, and irregular swings." },
  { title: "Light & caffeine timing", desc: "Per-shift recommendations that adapt to sunrise and your wake time." },
];

const PRICE_IDS: Record<SubscriptionTier, string> = {
  free: "",
  monthly: "restpilot_monthly",
  annual: "restpilot_annual",
  lifetime: "restpilot_lifetime",
};

function Paywall() {
  const navigate = useNavigate();
  const [selectedTier, setSelectedTier] = useState<Exclude<SubscriptionTier, "free">>("annual");
  const [loading, setLoading] = useState(false);
  const [clientSecret, setClientSecret] = useState<string | null>(null);

  async function handleCheckout() {
    if (!isPaymentsConfigured()) {
      toast.error("Payments aren't configured for this build yet.");
      return;
    }
    setLoading(true);
    try {
      const { data } = await supabase.auth.getSession();
      if (!data.session) {
        toast.info("Sign in to continue to checkout.");
        navigate({ to: "/auth" });
        return;
      }
      const result = await createCheckoutSession({
        data: {
          priceId: PRICE_IDS[selectedTier],
          environment: getStripeEnvironment(),
          returnUrl: `${window.location.origin}/profile?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
        },
      });
      if ("error" in result) throw new Error(result.error);
      if (!result.clientSecret) throw new Error("Checkout could not be started.");
      setClientSecret(result.clientSecret);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "We couldn't open checkout. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  async function handleRestore() {
    setLoading(true);
    try {
      const state = await restorePurchases();
      toast.success(
        state.isPremium
          ? `Premium restored (${state.tier}).`
          : "No active subscription found on this account.",
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "We couldn't restore your purchases.");
    } finally {
      setLoading(false);
    }
  }

  if (clientSecret) {
    return (
      <main className="flex flex-col px-5 pt-12 pb-6">
        <button
          onClick={() => setClientSecret(null)}
          className="mb-4 self-start text-xs font-medium text-primary underline"
        >
          ← Back to plans
        </button>
        <EmbeddedCheckoutProvider stripe={getStripe()} options={{ fetchClientSecret: async () => clientSecret }}>
          <EmbeddedCheckout />
        </EmbeddedCheckoutProvider>
      </main>
    );
  }

  const isLifetime = selectedTier === "lifetime";
  const ctaLabel = loading
    ? "Please wait…"
    : isLifetime
      ? "Become a Founding Member"
      : "Start 7-day free trial";

  return (
    <main className="flex flex-col px-5 pt-12 pb-6">
      <div className="rounded-3xl border border-primary/30 bg-[image:var(--gradient-hero)] p-6 shadow-[var(--shadow-glow)]">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/15 px-3 py-1 text-[10px] font-semibold uppercase tracking-widest text-primary">
          <Sparkles className="h-3 w-3" /> Premium
        </span>
        <h1 className="mt-4 text-3xl font-bold leading-tight">
          Sleep like the sun never moved.
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          RestPilot Premium gives you the AI Sleep Coach and adaptive notifications built
          for the chaos of shift work.
        </p>
      </div>

      <ul className="mt-6 flex flex-col gap-3">
        {PERKS.map((p) => (
          <li
            key={p.title}
            className="flex items-start gap-3 rounded-2xl border border-border bg-card p-4"
          >
            <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary">
              <Check className="h-4 w-4" />
            </span>
            <div>
              <p className="text-sm font-semibold">{p.title}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">{p.desc}</p>
            </div>
          </li>
        ))}
      </ul>

      <div className="mt-6 flex flex-col gap-3">
        <PlanCard
          label="Monthly"
          price="$7.99"
          sub="per month · 7-day free trial"
          selected={selectedTier === "monthly"}
          onSelect={() => setSelectedTier("monthly")}
          perks={["Unlimited AI Coach", "Wind-down alerts", "Smart Light Plan"]}
        />
        <PlanCard
          label="Annual"
          price="$49.99"
          sub="per year · save 48% · 7-day free trial"
          highlighted
          badge="Most popular"
          selected={selectedTier === "annual"}
          onSelect={() => setSelectedTier("annual")}
          perks={["Everything in Monthly", "Voice briefings", "Shift-swap copilot"]}
        />
        <PlanCard
          label="Lifetime"
          price="$99"
          sub="One-time payment · Lifetime of the service"
          elite
          badge="Founding Member — Limited Time"
          selected={selectedTier === "lifetime"}
          onSelect={() => setSelectedTier("lifetime")}
          perks={[
            "Everything in Annual, for the lifetime of the service",
            "Smarter AI coach with deeper answers",
            "Multi-week rotation forecasts",
            "Partner co-planning & shared quiet hours",
          ]}
        />
      </div>

      <button
        onClick={handleCheckout}
        disabled={loading}
        className="mt-5 h-14 w-full rounded-2xl bg-primary text-base font-semibold text-primary-foreground shadow-[var(--shadow-glow)] active:scale-[0.99] disabled:opacity-60"
      >
        {ctaLabel}
      </button>

      {!isLifetime && (
        <p className="mt-2 text-center text-[11px] text-muted-foreground">
          No charge today · Cancel anytime before your trial ends
        </p>
      )}

      <div className="mt-4 flex flex-col items-center gap-1.5 text-[10px] text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <ShieldCheck className="h-3 w-3" /> Secure checkout powered by Stripe
        </span>
        <span className="tracking-wide">Visa · Mastercard · American Express · Apple Pay · Google Pay</span>
      </div>

      <div className="mt-4 rounded-2xl border border-border bg-card/60 p-3 text-[10px] leading-relaxed text-muted-foreground">
        <p>
          Subscriptions renew automatically at the listed price unless
          canceled before the renewal date. You can manage or cancel your
          plan anytime from your account settings. Lifetime is a one-time
          purchase that grants access for the lifetime of the RestPilot AI
          service (not the lifetime of the purchaser). See the{" "}
          <Link to="/terms" className="text-primary underline">Terms</Link>{" "}
          for full details.
        </p>
        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
          <Link to="/terms" className="text-primary underline">
            Terms of Service
          </Link>
          <Link to="/privacy" className="text-primary underline">
            Privacy Policy
          </Link>
          <button
            type="button"
            onClick={handleRestore}
            disabled={loading}
            className="text-primary underline disabled:opacity-60"
          >
            Restore purchases
          </button>
        </div>
      </div>

      <Link
        to="/"
        className="mt-3 text-center text-xs font-medium text-muted-foreground underline-offset-4 hover:underline"
      >
        Maybe later
      </Link>

      <p className="mt-6 text-[10px] leading-relaxed text-muted-foreground/70">{DISCLAIMER}</p>
    </main>
  );
}

function PlanCard({
  label,
  price,
  sub,
  highlighted,
  elite,
  badge,
  perks,
  selected,
  onSelect,
}: {
  label: string;
  price: string;
  sub: string;
  highlighted?: boolean;
  elite?: boolean;
  badge?: string;
  perks?: string[];
  selected?: boolean;
  onSelect?: () => void;
}) {
  const tone = elite
    ? "border-amber/50 bg-amber/5"
    : highlighted
      ? "border-primary bg-primary/10"
      : "border-border bg-card";
  const ring = selected ? "ring-2 ring-primary ring-offset-2 ring-offset-background" : "";
  const badgeTone = elite ? "bg-amber/20 text-amber" : "bg-primary/20 text-primary";
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`relative w-full rounded-2xl border p-4 text-left transition ${tone} ${ring}`}
    >
      {badge && (
        <span
          className={`absolute -top-2 right-4 rounded-full px-2 py-0.5 text-[9px] font-semibold uppercase tracking-widest ${badgeTone}`}
        >
          {badge}
        </span>
      )}
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-xs uppercase tracking-widest text-muted-foreground">{label}</p>
        <div className="text-right">
          <p className="text-2xl font-bold leading-none">{price}</p>
          <p className="mt-1 text-[10px] text-muted-foreground">{sub}</p>
        </div>
      </div>
      {perks && perks.length > 0 && (
        <ul className="mt-3 flex flex-col gap-1.5">
          {perks.map((p) => (
            <li key={p} className="flex items-start gap-2 text-[11px] text-muted-foreground">
              <Check className={`mt-0.5 h-3 w-3 shrink-0 ${elite ? "text-amber" : "text-primary"}`} />
              <span>{p}</span>
            </li>
          ))}
        </ul>
      )}
    </button>
  );
}
