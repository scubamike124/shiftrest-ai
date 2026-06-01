import { createFileRoute, Link } from "@tanstack/react-router";
import { Check, Sparkles, Users } from "lucide-react";
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
          price="$49"
          sub="per year · save 49%"
          highlighted
          badge="Most popular"
          perks={["Everything in Monthly", "Voice briefings", "Shift-swap copilot"]}
        />
        <PlanCard
          label="Elite"
          price="$119"
          sub="per year · concierge tier"
          elite
          badge="Best value"
          perks={[
            "Everything in Annual",
            "Priority Gemini-3 Pro coach",
            "Multi-week rotation forecasts",
            "Wearable sync (when available)",
            "Partner co-planning & priority support",
          ]}
        />
      </div>

      <button className="mt-5 h-14 w-full rounded-2xl bg-primary text-base font-semibold text-primary-foreground shadow-[var(--shadow-glow)] active:scale-[0.99]">
        Start 7-day free trial
      </button>
      <p className="mt-2 text-center text-[10px] text-muted-foreground/70">
        Billed through the App Store. Cancel anytime in your subscriptions.
      </p>
      <Link
        to="/"
        className="mt-3 text-center text-xs font-medium text-muted-foreground underline-offset-4 hover:underline"
      >
        Maybe later
      </Link>

      <section className="mt-8 rounded-3xl border border-mint/30 bg-mint/5 p-5">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-mint/15 px-3 py-1 text-[10px] font-semibold uppercase tracking-widest text-mint">
          <Users className="h-3 w-3" /> Crew & Teams
        </span>
        <h2 className="mt-3 text-xl font-bold leading-tight">
          Sleep health for the whole shift.
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Per-seat plans for hospitals, fire/EMS, airlines, and security teams. Roster
          imports, fatigue dashboards, and aggregated (anonymous) wellness reporting.
        </p>
        <a
          href="mailto:teams@shiftrest.ai?subject=Crew%20plan%20inquiry"
          className="mt-4 flex h-12 items-center justify-center rounded-2xl border border-mint/40 bg-card text-sm font-semibold text-mint"
        >
          Talk to our team
        </a>
      </section>

      <p className="mt-6 text-[10px] leading-relaxed text-muted-foreground/70">{DISCLAIMER}</p>
    </main>
  );
}

function PlanCard({
  label,
  price,
  sub,
  highlighted,
}: {
  label: string;
  price: string;
  sub: string;
  highlighted?: boolean;
}) {
  return (
    <div
      className={`rounded-2xl border p-4 ${
        highlighted ? "border-primary bg-primary/10" : "border-border bg-card"
      }`}
    >
      <p className="text-xs uppercase tracking-widest text-muted-foreground">{label}</p>
      <p className="mt-2 text-2xl font-bold">{price}</p>
      <p className="text-[11px] text-muted-foreground">{sub}</p>
    </div>
  );
}
