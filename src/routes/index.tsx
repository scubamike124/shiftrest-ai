import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  Sparkles,
  Moon,
  Sun,
  Activity,
  Calendar,
  MessageCircle,
  Watch,
  Shield,
  ArrowRight,
  Check,
  Quote,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "RestPilot AI — The AI Rest Platform for Shift Workers" },
      {
        name: "description",
        content:
          "RestPilot is the premium AI platform that plans sleep, light, and recovery around your shifts. Built for nurses, pilots, first responders, and anyone whose schedule never stops.",
      },
      { property: "og:title", content: "RestPilot AI — The AI Rest Platform for Shift Workers" },
      {
        property: "og:description",
        content:
          "Premium AI rest planning, smart alarms, and recovery playbooks built around your real schedule.",
      },
      { property: "og:url", content: "https://shift-rest-ai.lovable.app/" },
    ],
    links: [{ rel: "canonical", href: "https://shift-rest-ai.lovable.app/" }],
  }),
  component: Landing,
});

function Landing() {
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSignedIn(!!data.session));
  }, []);
  const ctaHref = signedIn ? "/dashboard" : "/auth";

  return (
    <div className="overflow-hidden">
      <Hero ctaHref={ctaHref} />
      <LogoStrip />
      <Features />
      <ProductShowcase />
      <HowItWorks />
      <Testimonials />
      <PricingPreview ctaHref={ctaHref} />
      <CtaBand ctaHref={ctaHref} />
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function Hero({ ctaHref }: { ctaHref: string }) {
  return (
    <section className="relative isolate">
      {/* Aurora background */}
      <div
        className="pointer-events-none absolute inset-0 -z-10"
        style={{ background: "var(--gradient-hero)" }}
      />
      <div className="pointer-events-none absolute -top-32 left-1/2 -z-10 h-[600px] w-[900px] -translate-x-1/2 rounded-full bg-indigo/30 blur-[160px]" />
      <div className="pointer-events-none absolute right-0 top-40 -z-10 h-[400px] w-[400px] rounded-full bg-indigo-glow/20 blur-[120px]" />

      <div className="mx-auto w-full max-w-7xl px-5 pt-20 pb-24 lg:px-10 lg:pt-32 lg:pb-32">
        <div className="grid items-center gap-12 lg:grid-cols-[1.15fr_1fr] lg:gap-16">
          <div>
            <span className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-secondary/40 px-3 py-1 text-xs font-medium text-indigo-glow backdrop-blur-sm">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-indigo-glow" />
              New · Smart Alarm + AI Coach v2
            </span>
            <h1
              className="mt-6 text-5xl leading-[1.02] tracking-tight sm:text-6xl lg:text-7xl"
              style={{ fontFamily: "var(--font-display)" }}
            >
              Rest, engineered for the{" "}
              <span className="italic text-indigo-glow">schedule that never stops</span>.
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-relaxed text-muted-foreground">
              RestPilot is the premium AI platform that plans your sleep, light,
              caffeine, and recovery around real shifts. Built for nurses,
              pilots, first responders, and anyone who works when the rest of
              the world sleeps.
            </p>

            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link
                to={ctaHref}
                className="group inline-flex items-center gap-2 rounded-full bg-foreground px-6 py-3.5 text-sm font-semibold text-background transition hover:opacity-90"
              >
                Start free — 7 days
                <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
              </Link>
              <Link
                to="/features"
                className="inline-flex items-center gap-2 rounded-full border border-border bg-card/60 px-6 py-3.5 text-sm font-semibold text-foreground backdrop-blur-sm transition hover:bg-card"
              >
                See features
              </Link>
            </div>

            <div className="mt-10 flex flex-wrap items-center gap-x-8 gap-y-3 text-xs text-muted-foreground">
              <Trust icon={Shield} label="Private by default" />
              <Trust icon={Watch} label="Fitbit · Oura sync" />
              <Trust icon={Activity} label="Multi-employer aware" />
            </div>
          </div>

          {/* Hero visual: circadian dial */}
          <div className="relative mx-auto w-full max-w-lg">
            <CircadianHero />
          </div>
        </div>
      </div>
    </section>
  );
}

function Trust({ icon: Icon, label }: { icon: typeof Shield; label: string }) {
  return (
    <span className="inline-flex items-center gap-2">
      <Icon className="h-4 w-4 text-indigo-glow" />
      {label}
    </span>
  );
}

function CircadianHero() {
  const R = 130;
  const C = 2 * Math.PI * R;
  return (
    <div className="relative aspect-square w-full">
      <div className="absolute inset-0 rounded-[40px] border border-primary/20 bg-card/40 p-8 shadow-[var(--shadow-card)] backdrop-blur-xl">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.25em] text-indigo-glow">
              Tonight
            </p>
            <p
              className="mt-1 text-3xl"
              style={{ fontFamily: "var(--font-display)" }}
            >
              Sleep window
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              7h 40m predicted · low debt
            </p>
          </div>
          <span className="flex h-10 w-10 items-center justify-center rounded-full border border-primary/30 bg-secondary">
            <Moon className="h-4 w-4 text-indigo-glow" />
          </span>
        </div>

        <div className="relative mx-auto mt-6 aspect-square w-full max-w-[300px]">
          <svg viewBox="0 0 320 320" className="h-full w-full -rotate-90">
            <circle cx="160" cy="160" r={R} fill="none" stroke="var(--secondary)" strokeWidth="14" />
            <circle
              cx="160"
              cy="160"
              r={R}
              fill="none"
              stroke="var(--indigo)"
              strokeWidth="14"
              strokeLinecap="round"
              strokeDasharray={`${C * 0.42} ${C}`}
              strokeDashoffset={-C * 0.05}
            />
            <circle
              cx="160"
              cy="160"
              r={R}
              fill="none"
              stroke="var(--amber)"
              strokeWidth="10"
              strokeLinecap="round"
              opacity="0.85"
              strokeDasharray={`${C * 0.04} ${C}`}
              strokeDashoffset={-C * 0.47}
            />
            <circle
              cx="160"
              cy="160"
              r={R}
              fill="none"
              stroke="var(--indigo-glow)"
              strokeWidth="8"
              strokeLinecap="round"
              opacity="0.8"
              strokeDasharray={`${C * 0.32} ${C}`}
              strokeDashoffset={-C * 0.51}
            />
          </svg>
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
            <p
              className="text-5xl"
              style={{ fontFamily: "var(--font-display)" }}
            >
              22
            </p>
            <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
              Debt · low
            </p>
          </div>
        </div>

        <div className="mt-6 grid grid-cols-3 gap-2 text-xs">
          <Legend color="var(--indigo)" label="Shift" />
          <Legend color="var(--amber)" label="Wind down" />
          <Legend color="var(--indigo-glow)" label="Sleep" />
        </div>
      </div>
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="h-2 w-2 rounded-full" style={{ background: color }} />
      <span className="text-muted-foreground">{label}</span>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function LogoStrip() {
  const roles = ["ICU Nurses", "Pilots", "Firefighters", "ER Physicians", "Long-haul Drivers", "Police"];
  return (
    <section className="border-y border-border/60 bg-background/40 py-10">
      <div className="mx-auto w-full max-w-7xl px-5 lg:px-10">
        <p className="text-center text-xs font-semibold uppercase tracking-[0.25em] text-muted-foreground">
          Trusted by people who work when others sleep
        </p>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-x-10 gap-y-4 text-sm text-muted-foreground/80">
          {roles.map((r) => (
            <span key={r} className="opacity-70">
              {r}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */

const features = [
  {
    icon: Sparkles,
    title: "AI Coach with memory",
    body: "A conversational coach that learns your rotation, your caffeine ceiling, and what actually helps you fall asleep — privately, on your terms.",
  },
  {
    icon: Sun,
    title: "Light & caffeine timing",
    body: "Hour-by-hour guidance for when to chase light, dim it, and stop caffeine — calibrated to your real sunrise and shift.",
  },
  {
    icon: Moon,
    title: "Smart Alarm",
    body: "Wake at the lightest point of your sleep cycle. Adapts when you go down late or sleep through a shift swap.",
  },
  {
    icon: Calendar,
    title: "Multi-week rotations",
    body: "Real rotating schedules — 2/2/3, 4-on/4-off, dupont — modeled as first-class citizens. Multi-employer aware.",
  },
  {
    icon: Watch,
    title: "Wearable sync",
    body: "Fitbit and Oura today. Pulls last night's sleep so the plan adapts to what actually happened, not what you guessed.",
  },
  {
    icon: MessageCircle,
    title: "Recovery playbooks",
    body: "Step-by-step protocols for jet lag, rotation flips, post-night recovery, and the day before a long stretch.",
  },
];

function Features() {
  return (
    <section className="py-24 lg:py-32">
      <div className="mx-auto w-full max-w-7xl px-5 lg:px-10">
        <SectionHeader
          eyebrow="The platform"
          title="An AI that understands what your schedule does to your body."
          body="Most sleep apps assume you wake up with the sun. RestPilot is built for the people who don't."
        />
        <div className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {features.map((f) => {
            const Icon = f.icon;
            return (
              <div
                key={f.title}
                className="group relative overflow-hidden rounded-3xl border border-border/60 bg-card/50 p-7 transition hover:border-primary/40 hover:bg-card"
              >
                <div className="pointer-events-none absolute -right-12 -top-12 h-32 w-32 rounded-full bg-indigo/10 blur-3xl transition group-hover:bg-indigo/20" />
                <span className="relative flex h-11 w-11 items-center justify-center rounded-2xl border border-primary/30 bg-secondary/60">
                  <Icon className="h-5 w-5 text-indigo-glow" />
                </span>
                <h3
                  className="relative mt-5 text-2xl"
                  style={{ fontFamily: "var(--font-display)" }}
                >
                  {f.title}
                </h3>
                <p className="relative mt-2 text-sm leading-relaxed text-muted-foreground">
                  {f.body}
                </p>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */

function ProductShowcase() {
  return (
    <section className="py-24 lg:py-32">
      <div className="mx-auto w-full max-w-7xl px-5 lg:px-10">
        <div className="grid items-center gap-16 lg:grid-cols-2">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.25em] text-indigo-glow">
              The Dashboard
            </p>
            <h2
              className="mt-3 text-4xl leading-tight tracking-tight lg:text-5xl"
              style={{ fontFamily: "var(--font-display)" }}
            >
              Your week, modeled like a flight plan.
            </h2>
            <p className="mt-5 max-w-lg text-base leading-relaxed text-muted-foreground">
              Every shift, every wind-down, every sleep window — laid out on one
              canvas. The Long Clock predicts the next 7 days so you can see
              recovery debt before it costs you.
            </p>
            <ul className="mt-8 space-y-3">
              {[
                "Circadian debt score, updated live",
                "Multi-employer + rotating week support",
                "Light, caffeine, and blackout windows per shift",
                "Voice briefings before every night shift",
              ].map((b) => (
                <li key={b} className="flex items-start gap-3 text-sm">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-indigo-glow" />
                  <span className="text-foreground/90">{b}</span>
                </li>
              ))}
            </ul>
          </div>

          <MockDashboard />
        </div>
      </div>
    </section>
  );
}

function MockDashboard() {
  return (
    <div className="relative">
      <div className="pointer-events-none absolute -inset-4 rounded-[40px] bg-indigo/20 blur-3xl" />
      <div className="relative overflow-hidden rounded-[28px] border border-border bg-card/80 p-6 shadow-[var(--shadow-card)] backdrop-blur-xl">
        <div className="flex items-center justify-between text-xs">
          <span className="font-semibold uppercase tracking-widest text-indigo-glow">
            Tue · Oct 14
          </span>
          <span className="rounded-full border border-border bg-secondary/60 px-2 py-0.5 text-muted-foreground">
            Week B
          </span>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3">
          <div className="rounded-2xl border border-border bg-background/40 p-4">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-indigo-glow">
              Circadian debt
            </p>
            <p
              className="mt-1 text-4xl"
              style={{ fontFamily: "var(--font-display)" }}
            >
              22
            </p>
            <p className="mt-1 text-[10px] text-muted-foreground">/100 · stable</p>
          </div>
          <div className="rounded-2xl border border-border bg-background/40 p-4">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-indigo-glow">
              Next sleep
            </p>
            <p className="mt-1 text-xl font-semibold">8:40 AM</p>
            <p className="mt-1 text-[10px] text-muted-foreground">7h 40m window</p>
          </div>
        </div>

        <div className="mt-3 rounded-2xl border border-primary/30 p-4" style={{ background: "var(--gradient-cta)" }}>
          <p className="text-[10px] font-semibold uppercase tracking-widest text-primary-foreground/80">
            AI brief
          </p>
          <p className="mt-1 text-sm font-medium text-primary-foreground">
            Last caffeine by 1:00 AM. Bright light from 7–9 PM tonight, blackout
            after your shift ends at 7 AM.
          </p>
        </div>

        <div className="mt-3 grid grid-cols-7 gap-1.5">
          {["M", "T", "W", "T", "F", "S", "S"].map((d, i) => (
            <div
              key={i}
              className={`flex aspect-square flex-col items-center justify-center rounded-xl text-[10px] ${
                i === 1
                  ? "border border-primary/40 text-foreground"
                  : "border border-border bg-background/30 text-muted-foreground"
              }`}
              style={
                i === 1
                  ? { background: "linear-gradient(180deg,var(--indigo),var(--secondary))" }
                  : undefined
              }
            >
              <span className="font-semibold">{d}</span>
              <span className="opacity-70">{14 + i - 1}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function HowItWorks() {
  const steps = [
    {
      n: "01",
      title: "Map your shifts",
      body: "Add your rotation in under a minute — single week, 2/2/3, dupont, or your own.",
    },
    {
      n: "02",
      title: "Connect what you have",
      body: "Optional Fitbit or Oura sync. Your location for accurate sunrise. Everything is opt-in.",
    },
    {
      n: "03",
      title: "Let the AI plan",
      body: "Wake times, sleep windows, light, caffeine, and recovery — calibrated to you, every day.",
    },
  ];
  return (
    <section className="border-y border-border/60 bg-background/40 py-24 lg:py-32">
      <div className="mx-auto w-full max-w-7xl px-5 lg:px-10">
        <SectionHeader
          eyebrow="How it works"
          title="Three steps to a rested week."
        />
        <div className="mt-14 grid gap-6 lg:grid-cols-3">
          {steps.map((s) => (
            <div
              key={s.n}
              className="relative overflow-hidden rounded-3xl border border-border/60 bg-card/50 p-8"
            >
              <p
                className="text-6xl text-indigo-glow/30"
                style={{ fontFamily: "var(--font-display)" }}
              >
                {s.n}
              </p>
              <h3
                className="mt-4 text-2xl"
                style={{ fontFamily: "var(--font-display)" }}
              >
                {s.title}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                {s.body}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */

function Testimonials() {
  const quotes = [
    {
      q: "Finally something built for the way nurses actually live. The light plan changed my switch days entirely.",
      a: "Maya · ICU RN, Boston",
    },
    {
      q: "The Long Clock is the feature I didn't know I needed. I can see the whole week, not just tonight.",
      a: "Devin · Captain, regional airline",
    },
    {
      q: "It's the first sleep app that didn't tell me to 'just go to bed earlier.' It understands.",
      a: "Priya · Firefighter / paramedic",
    },
  ];
  return (
    <section className="py-24 lg:py-32">
      <div className="mx-auto w-full max-w-7xl px-5 lg:px-10">
        <SectionHeader eyebrow="What people say" title="Built with night people, not for them." />
        <div className="mt-14 grid gap-5 lg:grid-cols-3">
          {quotes.map((t, i) => (
            <figure
              key={i}
              className="flex h-full flex-col justify-between rounded-3xl border border-border/60 bg-card/50 p-7"
            >
              <Quote className="h-6 w-6 text-indigo-glow/70" />
              <blockquote
                className="mt-4 text-lg leading-relaxed"
                style={{ fontFamily: "var(--font-display)" }}
              >
                "{t.q}"
              </blockquote>
              <figcaption className="mt-6 text-xs uppercase tracking-widest text-muted-foreground">
                {t.a}
              </figcaption>
            </figure>
          ))}
        </div>
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */

function PricingPreview({ ctaHref }: { ctaHref: string }) {
  const tiers = [
    {
      name: "Monthly",
      price: "$7.99",
      cadence: "/ month",
      perks: ["7-day free trial", "All AI features", "Wearable sync"],
      featured: false,
    },
    {
      name: "Annual",
      price: "$49.99",
      cadence: "/ year",
      perks: ["Save 48% vs monthly", "Priority AI capacity", "Everything in Monthly"],
      featured: true,
    },
    {
      name: "Lifetime",
      price: "$99",
      cadence: "one-time",
      perks: ["Pay once, use forever", "All future updates", "Founders' badge"],
      featured: false,
    },
  ];
  return (
    <section className="py-24 lg:py-32" id="pricing">
      <div className="mx-auto w-full max-w-7xl px-5 lg:px-10">
        <SectionHeader eyebrow="Pricing" title="Simple plans. No clinical pricing games." />
        <div className="mt-14 grid gap-5 lg:grid-cols-3">
          {tiers.map((t) => (
            <div
              key={t.name}
              className={`relative overflow-hidden rounded-3xl border p-8 transition ${
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
                <span
                  className="text-5xl"
                  style={{ fontFamily: "var(--font-display)" }}
                >
                  {t.price}
                </span>
                <span className="text-sm text-muted-foreground">{t.cadence}</span>
              </p>
              <ul className="mt-6 space-y-2.5">
                {t.perks.map((p) => (
                  <li key={p} className="flex items-start gap-2 text-sm">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-indigo-glow" />
                    <span>{p}</span>
                  </li>
                ))}
              </ul>
              <Link
                to={ctaHref}
                className={`mt-8 flex h-12 items-center justify-center rounded-full text-sm font-semibold transition ${
                  t.featured
                    ? "bg-foreground text-background hover:opacity-90"
                    : "border border-border bg-secondary/60 text-foreground hover:bg-secondary"
                }`}
              >
                Get started
              </Link>
            </div>
          ))}
        </div>
        <p className="mt-8 text-center text-xs text-muted-foreground">
          Cancel anytime. Billed through Stripe.{" "}
          <Link to="/pricing" className="text-indigo-glow underline-offset-2 hover:underline">
            See full comparison
          </Link>
        </p>
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */

function CtaBand({ ctaHref }: { ctaHref: string }) {
  return (
    <section className="px-5 pb-24 lg:px-10 lg:pb-32">
      <div
        className="relative mx-auto w-full max-w-7xl overflow-hidden rounded-[40px] border border-primary/30 p-12 lg:p-20"
        style={{ background: "var(--gradient-hero)" }}
      >
        <div className="pointer-events-none absolute -right-20 -top-20 h-72 w-72 rounded-full bg-indigo/40 blur-3xl breathe" />
        <div className="pointer-events-none absolute -left-32 bottom-0 h-72 w-72 rounded-full bg-indigo-glow/30 blur-3xl" />
        <div className="relative max-w-2xl">
          <h2
            className="text-4xl leading-tight tracking-tight lg:text-6xl"
            style={{ fontFamily: "var(--font-display)" }}
          >
            Your next great week of sleep starts tonight.
          </h2>
          <p className="mt-5 text-lg text-muted-foreground">
            Free for 7 days. No card games. Cancel from your account anytime.
          </p>
          <Link
            to={ctaHref}
            className="group mt-8 inline-flex items-center gap-2 rounded-full bg-foreground px-7 py-4 text-sm font-semibold text-background transition hover:opacity-90"
          >
            Start free trial
            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
          </Link>
        </div>
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */

function SectionHeader({
  eyebrow,
  title,
  body,
}: {
  eyebrow: string;
  title: string;
  body?: string;
}) {
  return (
    <div className="mx-auto max-w-3xl text-center">
      <p className="text-[11px] font-semibold uppercase tracking-[0.25em] text-indigo-glow">
        {eyebrow}
      </p>
      <h2
        className="mt-3 text-4xl leading-tight tracking-tight lg:text-5xl"
        style={{ fontFamily: "var(--font-display)" }}
      >
        {title}
      </h2>
      {body && <p className="mt-4 text-base leading-relaxed text-muted-foreground">{body}</p>}
    </div>
  );
}
