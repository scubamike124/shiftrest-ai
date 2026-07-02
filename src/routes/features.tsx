import { createFileRoute, Link } from "@tanstack/react-router";
import {
  Sparkles,
  Sun,
  Moon,
  Calendar,
  Watch,
  MessageCircle,
  Shield,
  Bell,
  Activity,
  ArrowRight,
} from "lucide-react";

export const Route = createFileRoute("/features")({
  head: () => ({
    meta: [
      { title: "Features — RestPilot AI" },
      {
        name: "description",
        content:
          "Every feature inside RestPilot — AI coach with memory, Long Clock, wearable sync, multi-employer rotations, recovery playbooks.",
      },
      { property: "og:title", content: "Features — RestPilot AI" },
      { property: "og:description", content: "Every feature inside RestPilot — AI coach with memory, Long Clock, wearable sync, multi-employer rotations, recovery playbooks." },
      { property: "og:url", content: "https://shift-rest-ai.lovable.app/features" },
      { name: "twitter:title", content: "Features — RestPilot AI" },
      { name: "twitter:description", content: "Every feature inside RestPilot — AI coach with memory, Long Clock, wearable sync, multi-employer rotations, recovery playbooks." },
    ],
    links: [{ rel: "canonical", href: "https://shift-rest-ai.lovable.app/features" }],
  }),
  component: Features,
});

const groups = [
  {
    eyebrow: "Intelligence",
    title: "The AI layer",
    items: [
      {
        icon: Sparkles,
        title: "Coach with private memory",
        body: "A conversational coach that learns your rotation, caffeine ceiling, and what actually helps you sleep. Memory is opt-in, editable, exportable, and wipeable.",
      },
      {
        icon: MessageCircle,
        title: "Daily AI brief",
        body: "Every time you open the app, you get a tailored brief: what to do today, what to avoid, what's coming tomorrow.",
      },
      {
        icon: Activity,
        title: "Long Clock",
        body: "A 7-day adaptive plan that sees recovery debt before it costs you a shift.",
      },
    ],
  },
  {
    eyebrow: "Scheduling",
    title: "Real-world shifts",
    items: [
      {
        icon: Calendar,
        title: "Multi-week rotations",
        body: "2/2/3, 4-on/4-off, dupont, or your own. Modeled as first-class citizens — not bolted on.",
      },
      {
        icon: Sun,
        title: "Multi-employer aware",
        body: "Two jobs? Three? RestPilot keeps them straight and warns when they collide.",
      },
    ],
  },
  {
    eyebrow: "Environment",
    title: "Light, sleep, recovery",
    items: [
      {
        icon: Sun,
        title: "Light & caffeine timing",
        body: "Hour-by-hour windows for bright light, blackout, last caffeine — calibrated to your real sunrise.",
      },
      {
        icon: Moon,
        title: "Recovery playbooks",
        body: "Step-by-step protocols for jet lag, rotation flips, post-night recovery, and pre-stretch prep.",
      },
      {
        icon: Watch,
        title: "Wearable sync",
        body: "Fitbit and Oura today. The plan adapts to what actually happened last night, not what you guessed.",
      },
    ],
  },
  {
    eyebrow: "Trust",
    title: "Privacy as default",
    items: [
      {
        icon: Shield,
        title: "Memory is opt-in",
        body: "Off by default. You can view, edit, export, and wipe everything the AI has learned about you.",
      },
      {
        icon: Shield,
        title: "Your data, your control",
        body: "Delete your account and every shift, preference, and memory goes with it. No retention games.",
      },
    ],
  },
];

function Features() {
  return (
    <div>
      <section className="relative isolate py-20 lg:py-28">
        <div
          className="pointer-events-none absolute inset-0 -z-10"
          style={{ background: "var(--gradient-hero)" }}
        />
        <div className="mx-auto w-full max-w-7xl px-5 text-center lg:px-10">
          <p className="text-[11px] font-semibold uppercase tracking-[0.25em] text-indigo-glow">
            Features
          </p>
          <h1
            className="mt-3 text-5xl leading-tight tracking-tight lg:text-6xl"
            style={{ fontFamily: "var(--font-display)" }}
          >
            Everything inside <span className="italic text-indigo-glow">RestPilot</span>.
          </h1>
          <p className="mx-auto mt-5 max-w-xl text-base text-muted-foreground">
            A premium AI platform for people whose work doesn't follow the sun.
          </p>
        </div>
      </section>

      {groups.map((g) => (
        <section key={g.title} className="px-5 py-16 lg:px-10 lg:py-20">
          <div className="mx-auto w-full max-w-7xl">
            <div className="mb-10 max-w-2xl">
              <p className="text-[11px] font-semibold uppercase tracking-[0.25em] text-indigo-glow">
                {g.eyebrow}
              </p>
              <h2
                className="mt-2 text-3xl tracking-tight lg:text-4xl"
                style={{ fontFamily: "var(--font-display)" }}
              >
                {g.title}
              </h2>
            </div>
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {g.items.map((it) => {
                const Icon = it.icon;
                return (
                  <div
                    key={it.title}
                    className="rounded-3xl border border-border/60 bg-card/50 p-7 transition hover:border-primary/40 hover:bg-card"
                  >
                    <span className="flex h-11 w-11 items-center justify-center rounded-2xl border border-primary/30 bg-secondary/60">
                      <Icon className="h-5 w-5 text-indigo-glow" />
                    </span>
                    <h3
                      className="mt-5 text-xl"
                      style={{ fontFamily: "var(--font-display)" }}
                    >
                      {it.title}
                    </h3>
                    <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                      {it.body}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>
        </section>
      ))}

      <section className="px-5 pb-24 lg:px-10 lg:pb-32">
        <div
          className="relative mx-auto w-full max-w-7xl overflow-hidden rounded-[40px] border border-primary/30 p-12 lg:p-20"
          style={{ background: "var(--gradient-hero)" }}
        >
          <div className="pointer-events-none absolute -right-20 -top-20 h-72 w-72 rounded-full bg-indigo/40 blur-3xl breathe" />
          <div className="relative max-w-2xl">
            <h2
              className="text-4xl leading-tight tracking-tight lg:text-5xl"
              style={{ fontFamily: "var(--font-display)" }}
            >
              See it in your own week.
            </h2>
            <p className="mt-5 text-lg text-muted-foreground">
              7 days free. No card games. Cancel anytime from your account.
            </p>
            <Link
              to="/auth"
              className="group mt-8 inline-flex items-center gap-2 rounded-full bg-foreground px-7 py-4 text-sm font-semibold text-background transition hover:opacity-90"
            >
              Start free trial
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
