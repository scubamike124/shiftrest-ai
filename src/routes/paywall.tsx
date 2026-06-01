import { createFileRoute, Link } from "@tanstack/react-router";
import { Check, Sparkles } from "lucide-react";
import { DISCLAIMER } from "@/lib/shifts";

export const Route = createFileRoute("/paywall")({
  head: () => ({
    meta: [
      { title: "ShiftRest Premium — Unlock the AI Sleep Coach" },
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

function Paywall() {
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
          ShiftRest Premium gives you the AI Sleep Coach and adaptive notifications built
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
          sub="per month"
          perks={["Unlimited AI Coach", "Wind-down alerts", "Smart Light Plan"]}
        />
        <PlanCard
          label="Annual"
          price="$49.99"
          sub="per year · save 48% ($4.16/mo)"
          highlighted
          badge="Most popular"
          perks={["Everything in Monthly", "Voice briefings", "Shift-swap copilot"]}
        />
        <PlanCard
          label="Lifetime"
          price="$99"
          sub="one-time · founding member"
          elite
          badge="Launch deal"
          perks={[
            "Everything in Annual, forever",
            "Smarter AI coach with deeper answers",
            "Multi-week rotation forecasts",
            "Partner co-planning & shared quiet hours",
          ]}
        />
      </div>

      <button className="mt-5 h-14 w-full rounded-2xl bg-primary text-base font-semibold text-primary-foreground shadow-[var(--shadow-glow)] active:scale-[0.99]">
        Start 7-day free trial
      </button>

      <div className="mt-3 rounded-2xl border border-border bg-card/60 p-3 text-[10px] leading-relaxed text-muted-foreground">
        <p>
          Payment is charged to your Apple ID at confirmation of purchase.
          Subscriptions <strong>auto-renew</strong> at the same price unless
          cancelled at least 24 hours before the current period ends. Manage
          or cancel anytime in Settings → Apple ID → Subscriptions. Any unused
          portion of a free trial is forfeited when you purchase a subscription.
          Lifetime is a one-time purchase and does not renew.
        </p>
        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
          <Link to="/terms" className="text-primary underline">
            Terms of Service
          </Link>
          <Link to="/privacy" className="text-primary underline">
            Privacy Policy
          </Link>
          <button className="text-primary underline">Restore purchases</button>
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
}: {
  label: string;
  price: string;
  sub: string;
  highlighted?: boolean;
  elite?: boolean;
  badge?: string;
  perks?: string[];
}) {
  const tone = elite
    ? "border-amber/50 bg-amber/5"
    : highlighted
      ? "border-primary bg-primary/10"
      : "border-border bg-card";
  const badgeTone = elite
    ? "bg-amber/20 text-amber"
    : "bg-primary/20 text-primary";
  return (
    <div className={`relative rounded-2xl border p-4 ${tone}`}>
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
    </div>
  );
}
