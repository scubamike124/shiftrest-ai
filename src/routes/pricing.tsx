import { createFileRoute, Link } from "@tanstack/react-router";
import { Check } from "lucide-react";

export const Route = createFileRoute("/pricing")({
  head: () => ({
    meta: [
      { title: "Pricing — RestPilot AI" },
      {
        name: "description",
        content:
          "Simple monthly, annual, and lifetime plans for the AI rest platform built for shift workers.",
      },
      { property: "og:title", content: "Pricing — RestPilot AI" },
      {
        property: "og:description",
        content:
          "Simple monthly, annual, and lifetime plans for the AI rest platform built for shift workers.",
      },
      { property: "og:url", content: "https://restpilotai.com/pricing" },
      { name: "twitter:title", content: "Pricing — RestPilot AI" },
      {
        name: "twitter:description",
        content:
          "Simple monthly, annual, and lifetime plans for the AI rest platform built for shift workers.",
      },
    ],
    links: [{ rel: "canonical", href: "https://restpilotai.com/pricing" }],
  }),
  component: Pricing,
});

const tiers = [
  {
    name: "Monthly",
    price: "$7.99",
    cadence: "/ month",
    trial: "14-day free trial",
    perks: [
      "AI coach with memory",
      "Long Clock (7-day plan)",
      "Wearable sync (Fitbit · Oura)",
      "Recovery playbooks",
      "Multi-employer rotations",
    ],
    featured: false,
  },
  {
    name: "Annual",
    price: "$49.99",
    cadence: "/ year",
    trial: "Save 48% vs monthly",
    perks: [
      "Everything in Monthly",
      "Priority AI capacity",
      "Early access to new models",
      "Best for committed planners",
    ],
    featured: true,
  },
  {
    name: "Lifetime",
    price: "$99",
    cadence: "one-time",
    trial: "Pay once, use forever",
    perks: ["Everything in Annual", "All future updates", "Founders' badge", "No renewals, ever"],
    featured: false,
  },
];

const matrix = [
  { label: "AI Coach with memory", values: [true, true, true] },

  { label: "Long Clock (7-day plan)", values: [true, true, true] },
  { label: "Wearable sync", values: [true, true, true] },
  { label: "Multi-employer rotations", values: [true, true, true] },
  { label: "Recovery playbooks", values: [true, true, true] },
  { label: "Priority AI capacity", values: [false, true, true] },
  { label: "Early access to new models", values: [false, true, true] },
  { label: "All future updates included", values: ["—", "—", true] },
];

function Pricing() {
  return (
    <div>
      <section className="relative isolate py-20 lg:py-28">
        <div
          className="pointer-events-none absolute inset-0 -z-10"
          style={{ background: "var(--gradient-hero)" }}
        />
        <div className="mx-auto w-full max-w-7xl px-5 text-center lg:px-10">
          <p className="text-[11px] font-semibold uppercase tracking-[0.25em] text-indigo-glow">
            Pricing
          </p>
          <h1
            className="mt-3 text-5xl leading-tight tracking-tight lg:text-6xl"
            style={{ fontFamily: "var(--font-display)" }}
          >
            One platform. <span className="italic text-indigo-glow">Three ways to start.</span>
          </h1>
          <p className="mx-auto mt-5 max-w-xl text-base text-muted-foreground">
            Cancel anytime. Billed securely through Stripe. Every plan includes the full RestPilot
            AI feature set.
          </p>
        </div>
      </section>

      <section className="px-5 pb-20 lg:px-10">
        <div className="mx-auto grid w-full max-w-7xl gap-5 lg:grid-cols-3">
          {tiers.map((t) => (
            <div
              key={t.name}
              className={`relative flex flex-col overflow-hidden rounded-3xl border p-8 ${
                t.featured
                  ? "border-primary/50 bg-card shadow-[var(--shadow-glow)]"
                  : "border-border/60 bg-card/50"
              }`}
            >
              {t.featured && (
                <span className="absolute right-6 top-6 rounded-full border border-primary/40 bg-primary/20 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-widest text-indigo-glow">
                  Best value
                </span>
              )}
              <p className="text-sm font-semibold text-muted-foreground">{t.name}</p>
              <p className="mt-3 flex items-baseline gap-1">
                <span className="text-5xl" style={{ fontFamily: "var(--font-display)" }}>
                  {t.price}
                </span>
                <span className="text-sm text-muted-foreground">{t.cadence}</span>
              </p>
              <p className="mt-1 text-xs text-indigo-glow">{t.trial}</p>
              <ul className="mt-6 flex-1 space-y-2.5">
                {t.perks.map((p) => (
                  <li key={p} className="flex items-start gap-2 text-sm">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-indigo-glow" />
                    <span>{p}</span>
                  </li>
                ))}
              </ul>
              <Link
                to="/paywall"
                className={`mt-8 flex h-12 items-center justify-center rounded-full text-sm font-semibold transition ${
                  t.featured
                    ? "bg-foreground text-background hover:opacity-90"
                    : "border border-border bg-secondary/60 text-foreground hover:bg-secondary"
                }`}
              >
                Choose {t.name}
              </Link>
            </div>
          ))}
        </div>
      </section>

      <section className="px-5 pb-24 lg:px-10 lg:pb-32">
        <div className="mx-auto w-full max-w-5xl overflow-hidden rounded-3xl border border-border/60 bg-card/40">
          <div className="grid grid-cols-[2fr_1fr_1fr_1fr] border-b border-border/60 px-6 py-4 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            <span>Feature</span>
            <span className="text-center">Monthly</span>
            <span className="text-center">Annual</span>
            <span className="text-center">Lifetime</span>
          </div>
          {matrix.map((row) => (
            <div
              key={row.label}
              className="grid grid-cols-[2fr_1fr_1fr_1fr] items-center border-b border-border/40 px-6 py-4 text-sm last:border-b-0"
            >
              <span className="text-foreground/90">{row.label}</span>
              {row.values.map((v, i) => (
                <span key={i} className="flex justify-center">
                  {v === true ? (
                    <Check className="h-4 w-4 text-indigo-glow" />
                  ) : v === false ? (
                    <span className="text-muted-foreground/50">—</span>
                  ) : (
                    <span className="text-muted-foreground">{v}</span>
                  )}
                </span>
              ))}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
