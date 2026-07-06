import { createFileRoute, Link } from "@tanstack/react-router";
import {
  Sun,
  Moon,
  Coffee,
  Brain,
  Clock,
  Activity,
  ExternalLink,
} from "lucide-react";
import type { ComponentType, ReactNode } from "react";

export const Route = createFileRoute("/science")({
  head: () => ({
    meta: [
      {
        title:
          "The Science behind RestPilot AI — circadian & shift-work research",
      },
      {
        name: "description",
        content:
          "RestPilot AI's recommendations are grounded in established circadian rhythm and shift-work fatigue research from NIOSH, the AASM, and peer-reviewed sleep science — not generated advice.",
      },
      {
        property: "og:title",
        content:
          "The Science behind RestPilot AI — circadian & shift-work research",
      },
      {
        property: "og:description",
        content:
          "How RestPilot AI translates decades of circadian rhythm and shift-work research into concrete recommendations for the way you actually work.",
      },
      { property: "og:url", content: "/science" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [{ rel: "canonical", href: "/science" }],
  }),
  component: SciencePage,
});

type Pillar = {
  id: string;
  icon: ComponentType<{ className?: string }>;
  title: string;
  claim: string;
  detail: ReactNode;
  citations: { label: string; href: string }[];
};

const PILLARS: Pillar[] = [
  {
    id: "circadian",
    icon: Clock,
    title: "The circadian clock — the reason shift work is hard",
    claim:
      "Every human body runs on a ~24-hour clock coordinated by the suprachiasmatic nucleus. It sets when we feel alert, when core temperature drops, and when we can fall asleep — regardless of when we clock in.",
    detail: (
      <>
        Shift work fights this internal timing. Our recommendations start
        from the same principle every serious sleep clinician uses:{" "}
        <em>work with your circadian phase, not against it.</em>
      </>
    ),
    citations: [
      {
        label: "NIH / NIGMS — Circadian Rhythms primer",
        href: "https://www.nigms.nih.gov/education/fact-sheets/Pages/circadian-rhythms.aspx",
      },
      {
        label: "Duffy & Czeisler (Harvard Med) — Effect of Light on Human Circadian Physiology",
        href: "https://pubmed.ncbi.nlm.nih.gov/19646380/",
      },
    ],
  },
  {
    id: "shift-work",
    icon: Activity,
    title: "Shift Work Sleep Disorder is real and well-documented",
    claim:
      "SWSD is a recognized clinical condition in the AASM's International Classification of Sleep Disorders. Chronic circadian misalignment increases fatigue, error rates, and long-term health risk.",
    detail: (
      <>
        The plans RestPilot builds — sleep anchors, wake windows, off-day
        drift limits — target the same misalignment shift-work sleep
        specialists address in clinic. We can't diagnose, and we don't
        replace a specialist. But the framework we use is the same one.
      </>
    ),
    citations: [
      {
        label: "CDC / NIOSH — Training for Nurses on Shift Work and Long Work Hours",
        href: "https://www.cdc.gov/niosh/work-hour-training-for-nurses/",
      },
      {
        label: "AASM — Shift Work Disorder overview",
        href: "https://sleepeducation.org/sleep-disorders/shift-work-disorder/",
      },
    ],
  },
  {
    id: "light",
    icon: Sun,
    title: "Light is the strongest signal to the clock",
    claim:
      "Bright light in the biological morning advances your rhythm; light in the biological night suppresses melatonin and pushes it later. A few well-timed minutes matter more than hours of light at the wrong time.",
    detail: (
      <>
        RestPilot's light-timing recommendations aren't guesses — they're
        derived from decades of laboratory dose-response work on how
        intensity, wavelength, and timing shift the human clock.
      </>
    ),
    citations: [
      {
        label: "Zeitzer et al. — Sensitivity of the human circadian pacemaker to nocturnal light",
        href: "https://pubmed.ncbi.nlm.nih.gov/10896860/",
      },
      {
        label: "Rüger & Scheer — Effects of circadian disruption on the cardiometabolic system",
        href: "https://pubmed.ncbi.nlm.nih.gov/19352617/",
      },
    ],
  },
  {
    id: "caffeine",
    icon: Coffee,
    title: "Caffeine helps — but only when timed right",
    claim:
      "Caffeine is one of the best-validated alertness aids in operational settings. Timed too late, though, it corrodes the sleep you need to recover.",
    detail: (
      <>
        Our caffeine cutoffs and pre-shift dosing come from military and
        aviation fatigue-countermeasure research, not marketing copy.
      </>
    ),
    citations: [
      {
        label: "Reyner & Horne — Suppression of sleepiness in drivers: combination of caffeine with a short nap",
        href: "https://pubmed.ncbi.nlm.nih.gov/9401427/",
      },
      {
        label: "Wesensten et al. — Caffeine for the sustainment of alertness during sleep loss",
        href: "https://pubmed.ncbi.nlm.nih.gov/16218678/",
      },
    ],
  },
  {
    id: "sleep-debt",
    icon: Brain,
    title: "Sleep debt is cumulative, and you don't notice it",
    claim:
      "Chronic partial sleep restriction degrades cognitive performance as much as total sleep deprivation — but subjective sleepiness plateaus, so people underestimate their own impairment.",
    detail: (
      <>
        This is why we surface sleep-debt trends and recovery windows,
        instead of asking "how do you feel?" Feeling isn't the signal.
      </>
    ),
    citations: [
      {
        label: "Van Dongen et al. 2003 — The cumulative cost of additional wakefulness (Sleep)",
        href: "https://pubmed.ncbi.nlm.nih.gov/12683469/",
      },
    ],
  },
  {
    id: "wake-window",
    icon: Moon,
    title: "Where you wake up in your sleep cycle matters",
    claim:
      "Human sleep cycles run roughly 90 minutes. Waking near the end of a cycle feels dramatically better than being pulled out of deep sleep — even for the same total duration.",
    detail: (
      <>
        Smart Alarm and our wake-time nudges use this: we bias your wake
        moment toward the end of a cycle within a window you control.
      </>
    ),
    citations: [
      {
        label: "Dement & Kleitman — Cyclic variations in EEG during sleep (foundational)",
        href: "https://pubmed.ncbi.nlm.nih.gov/13683651/",
      },
    ],
  },
];

function SciencePage() {
  return (
    <main className="mx-auto w-full max-w-5xl px-5 pb-24 pt-16 lg:px-10">
      <header className="border-b border-border/60 pb-10">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-indigo-glow">
          The Science
        </p>
        <h1
          className="mt-3 text-4xl font-bold tracking-tight md:text-5xl"
          style={{ fontFamily: "var(--font-display)" }}
        >
          Grounded in circadian and shift-work research.
        </h1>
        <p className="mt-5 max-w-2xl text-lg leading-relaxed text-muted-foreground">
          RestPilot's recommendations aren't generated advice. Every plan we
          build — sleep anchors, wake windows, light timing, caffeine
          cutoffs, off-day recovery — is grounded in decades of peer-reviewed
          sleep science and the fatigue-management guidance used by NIOSH,
          the AASM, and operational safety bodies.
        </p>
      </header>

      <section className="mt-12 grid gap-6 md:grid-cols-2">
        {PILLARS.map((p) => (
          <article
            key={p.id}
            id={p.id}
            className="rounded-2xl border border-border/60 bg-card/50 p-6"
          >
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-primary/30 bg-primary/10 text-indigo-glow">
                <p.icon className="h-5 w-5" />
              </span>
              <h2 className="text-lg font-semibold leading-tight">{p.title}</h2>
            </div>
            <p className="mt-4 text-sm leading-relaxed text-foreground/90">
              {p.claim}
            </p>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
              {p.detail}
            </p>
            <ul className="mt-5 space-y-1.5">
              {p.citations.map((c) => (
                <li key={c.href} className="text-[13px]">
                  <a
                    href={c.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-indigo-glow underline-offset-2 hover:underline"
                  >
                    <ExternalLink className="h-3 w-3" />
                    {c.label}
                  </a>
                </li>
              ))}
            </ul>
          </article>
        ))}
      </section>

      <section className="mt-16 rounded-3xl border border-border/60 bg-card/40 p-8">
        <h2 className="text-2xl font-semibold tracking-tight">
          How we turn research into your daily plan
        </h2>
        <ol className="mt-6 grid gap-4 md:grid-cols-3">
          <li className="rounded-2xl border border-border/50 bg-background/40 p-5">
            <p className="text-xs font-semibold uppercase tracking-widest text-indigo-glow">
              Step 1
            </p>
            <p className="mt-2 text-sm text-foreground/90">
              We read your rotation, your sleep and wake times, and any
              wearable signals you connect (Oura, Fitbit, Apple Health).
            </p>
          </li>
          <li className="rounded-2xl border border-border/50 bg-background/40 p-5">
            <p className="text-xs font-semibold uppercase tracking-widest text-indigo-glow">
              Step 2
            </p>
            <p className="mt-2 text-sm text-foreground/90">
              We model your likely circadian phase using the same principles
              used in occupational sleep-medicine practice.
            </p>
          </li>
          <li className="rounded-2xl border border-border/50 bg-background/40 p-5">
            <p className="text-xs font-semibold uppercase tracking-widest text-indigo-glow">
              Step 3
            </p>
            <p className="mt-2 text-sm text-foreground/90">
              We turn that into plain-English recommendations chosen from
              interventions with real research behind them — not generated
              on the fly.
            </p>
          </li>
        </ol>
      </section>

      <section className="mt-12 rounded-3xl border border-border/60 bg-background/30 p-8">
        <h2 className="text-2xl font-semibold tracking-tight">
          What RestPilot is not
        </h2>
        <ul className="mt-4 space-y-3 text-sm leading-relaxed text-muted-foreground">
          <li>
            <strong className="text-foreground">Not a medical device.</strong>{" "}
            We don't diagnose sleep disorders or substitute for a clinician.
            If you have persistent insomnia, snoring with pauses, or
            excessive daytime sleepiness, please see a sleep specialist.
          </li>
          <li>
            <strong className="text-foreground">Not a fatigue-risk management system.</strong>{" "}
            Employer-grade FRMS platforms carry legal certifications
            RestPilot doesn't have. Follow your workplace's safety rules.
          </li>
          <li>
            <strong className="text-foreground">Not one-size-fits-all.</strong>{" "}
            Individual chronotype, health conditions, medications, and life
            context all affect what actually works for you. Trust your own
            experience.
          </li>
        </ul>
        <p className="mt-5 text-sm text-muted-foreground">
          See our{" "}
          <Link to="/legal/disclaimers" className="text-indigo-glow underline">
            disclaimers
          </Link>
          {" and "}
          <Link to="/safety" className="text-indigo-glow underline">
            Safety Center
          </Link>{" "}
          for the full picture.
        </p>
      </section>

      <section className="mt-12">
        <h2 className="text-2xl font-semibold tracking-tight">
          Further reading
        </h2>
        <ul className="mt-4 grid gap-2 text-sm">
          {[
            {
              label: "CDC NIOSH — Work Schedules: Shift Work and Long Work Hours",
              href: "https://www.cdc.gov/niosh/work-hour-training-for-nurses/",
            },
            {
              label: "AASM Sleep Education — Shift Work Disorder",
              href: "https://sleepeducation.org/sleep-disorders/shift-work-disorder/",
            },
            {
              label: "National Sleep Foundation — Shift Work",
              href: "https://www.thensf.org/shift-work-and-sleep/",
            },
            {
              label: "NIH / NIGMS — Circadian Rhythms",
              href: "https://www.nigms.nih.gov/education/fact-sheets/Pages/circadian-rhythms.aspx",
            },
          ].map((r) => (
            <li key={r.href}>
              <a
                href={r.href}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-indigo-glow underline-offset-2 hover:underline"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                {r.label}
              </a>
            </li>
          ))}
        </ul>
      </section>

      <div className="mt-16 flex flex-wrap gap-3">
        <Link
          to="/features"
          className="inline-flex items-center gap-2 rounded-full border border-border bg-card/60 px-5 py-2.5 text-sm font-medium hover:bg-card"
        >
          See the features
        </Link>
        <Link
          to="/auth"
          className="inline-flex items-center gap-2 rounded-full bg-foreground px-5 py-2.5 text-sm font-semibold text-background hover:opacity-90"
        >
          Start free — 14 days
        </Link>
      </div>
    </main>
  );
}
