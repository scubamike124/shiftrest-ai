import { createFileRoute, Link } from "@tanstack/react-router";
import {
  AlertTriangle,
  Brain,
  Car,
  Heart,
  LifeBuoy,
  MessageCircle,
  Phone,
  ShieldAlert,
  Watch,
} from "lucide-react";
import type { ReactNode } from "react";

export const Route = createFileRoute("/safety")({
  head: () => ({
    meta: [
      { title: "Safety Center — RestPilot AI" },
      {
        name: "description",
        content:
          "Plain-language guide to RestPilot AI's limits: AI, health, driving, emergencies, devices, and your responsibilities.",
      },
      { property: "og:title", content: "Safety Center — RestPilot AI" },
      {
        property: "og:description",
        content:
          "How to use RestPilot AI safely — AI limits, device limits, driving safety, and emergency guidance.",
      },
      { property: "og:url", content: "/safety" },
    ],
    links: [{ rel: "canonical", href: "/safety" }],
  }),
  component: SafetyCenter,
});

const SECTIONS = [
  { id: "ai", label: "AI limitations", icon: Brain },
  { id: "health", label: "Health limitations", icon: Heart },
  { id: "driving", label: "Driving & safety", icon: Car },
  { id: "companion", label: "Companion AI", icon: MessageCircle },
  { id: "emergency", label: "Emergencies", icon: Phone },
  { id: "devices", label: "Device limits", icon: Watch },
  { id: "responsibilities", label: "Your responsibilities", icon: ShieldAlert },
  { id: "safe-use", label: "Safe-use tips", icon: LifeBuoy },
] as const;

function SafetyCenter() {
  return (
    <main className="mx-auto w-full max-w-5xl px-5 pb-24 pt-12 lg:px-10">
      <header className="border-b border-border/60 pb-8">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">
          Safety Center
        </p>
        <h1 className="mt-2 text-4xl font-bold tracking-tight md:text-5xl">
          Use RestPilot AI safely.
        </h1>
        <p className="mt-4 max-w-2xl text-base leading-relaxed text-muted-foreground">
          RestPilot AI is a wellness and planning tool — not a clinician, not a
          medical device, and not an emergency service. This page explains, in
          plain language, what the product can and can't do so you can use it
          well. For the formal legal text, see our{" "}
          <Link to="/legal/disclaimers" className="text-primary underline">
            AI &amp; Health Disclaimers
          </Link>
          .
        </p>

        <div className="mt-6 flex items-start gap-3 rounded-2xl border border-rose-500/30 bg-rose-500/5 p-4 text-sm text-rose-100">
          <AlertTriangle className="mt-0.5 h-4 w-4 flex-none" />
          <div>
            <p className="font-semibold">In an emergency, don't use RestPilot.</p>
            <p className="mt-1 text-xs text-rose-100/80">
              Call your local emergency number (US: 911). For mental-health
              crises in the US, dial or text 988. Outside the US, use your
              local emergency or crisis line.
            </p>
          </div>
        </div>
      </header>

      <nav
        aria-label="Safety Center sections"
        className="mt-8 grid gap-2 sm:grid-cols-2 lg:grid-cols-4"
      >
        {SECTIONS.map((s) => (
          <a
            key={s.id}
            href={`#${s.id}`}
            className="flex items-center gap-2 rounded-xl border border-border/60 bg-card/40 px-3 py-2.5 text-sm text-muted-foreground transition hover:border-primary/40 hover:text-foreground"
          >
            <s.icon className="h-4 w-4 text-primary" />
            {s.label}
          </a>
        ))}
      </nav>

      <div className="mt-12 space-y-12">
        <Block id="ai" icon={Brain} title="AI limitations">
          <p>
            Smart Alarm, Right Now, Tomorrow Preview, Daily Review, the Long
            Clock, Pattern Alerts, voice briefings, and the AI Decision Center
            all use third-party AI models. AI output can be inaccurate,
            incomplete, or out of date.
          </p>
          <ul>
            <li>Treat every recommendation as a starting point, not a command.</li>
            <li>
              If a suggestion doesn't match how you feel, trust yourself and
              tell us with the feedback buttons so we learn.
            </li>
            <li>
              Don't rely on AI output for medical, legal, financial, or
              safety-critical decisions.
            </li>
          </ul>
        </Block>

        <Block id="health" icon={Heart} title="Health limitations">
          <p>
            RestPilot AI is a wellness tool. It is not a medical device and is
            not a substitute for professional medical, psychological,
            nutritional, or sleep-medicine advice, diagnosis, or treatment.
          </p>
          <ul>
            <li>Talk to a clinician about ongoing sleep, fatigue, or mood concerns.</li>
            <li>Don't change prescribed treatments based on RestPilot.</li>
            <li>
              Pregnancy, chronic illness, sleep disorders, and shift-work
              disorder need clinical guidance we can't provide.
            </li>
          </ul>
        </Block>

        <Block id="driving" icon={Car} title="Driving & safety-sensitive work">
          <p>
            Do not interact with RestPilot AI while driving or operating
            machinery. You are responsible for deciding whether you are fit to
            drive, work, or perform safety-sensitive duties (aviation,
            healthcare, public safety, transportation, industrial roles).
          </p>
          <ul>
            <li>Pull over before reading Smart Alarm, Right Now, or Companion.</li>
            <li>
              Follow your employer's fatigue and fitness-for-duty policies and
              any applicable regulations.
            </li>
            <li>
              RestPilot does not certify fitness for duty under any rule
              (e.g. DOT, FAA, FRA, EU drivers' hours).
            </li>
          </ul>
        </Block>

        <Block id="companion" icon={MessageCircle} title="Companion AI">
          <p>
            Companion and any voice or chat features are software. They are
            not a therapist, doctor, coach, sponsor, or crisis line. They do
            not know your full history and can be wrong.
          </p>
          <ul>
            <li>Don't use Companion as a substitute for professional support.</li>
            <li>Never use Companion during a mental-health crisis — see Emergencies.</li>
            <li>
              Companion does not contact emergency services on your behalf.
            </li>
          </ul>
        </Block>

        <Block id="emergency" icon={Phone} title="Emergencies">
          <p>
            RestPilot AI is not designed for emergencies and cannot detect or
            respond to them.
          </p>
          <ul>
            <li>
              <strong>Medical or life-threatening emergency:</strong> call your
              local emergency number (US: 911).
            </li>
            <li>
              <strong>Mental-health crisis (US):</strong> dial or text{" "}
              <strong>988</strong> for the Suicide &amp; Crisis Lifeline.
            </li>
            <li>
              <strong>Outside the US:</strong> use your country's emergency or
              crisis service.
            </li>
          </ul>
        </Block>

        <Block id="devices" icon={Watch} title="Device & sensor limits">
          <p>
            Connected wearables and health platforms enrich your plan but are
            not perfect data sources.
          </p>
          <ul>
            <li>Devices may fail, disconnect, or report inaccurate readings.</li>
            <li>
              Third-party integrations (e.g. Fitbit, Oura) may change pricing,
              break, or be removed by their provider at any time.
            </li>
            <li>
              Sync delays and internet outages mean the dashboard may be behind
              reality.
            </li>
            <li>
              Cross-check critical metrics in the source device or app before
              acting on them.
            </li>
          </ul>
        </Block>

        <Block id="responsibilities" icon={ShieldAlert} title="Your responsibilities">
          <ul>
            <li>Use a strong, unique password and protect your devices.</li>
            <li>
              Tell us at{" "}
              <a
                href="mailto:security@restpilot.ai"
                className="text-primary underline"
              >
                security@restpilot.ai
              </a>{" "}
              if you suspect unauthorized access.
            </li>
            <li>
              Review AI recommendations before acting on them and use your own
              judgment.
            </li>
            <li>
              Follow your employer's policies and the laws that apply to your
              work.
            </li>
          </ul>
        </Block>

        <Block id="safe-use" icon={LifeBuoy} title="Safe-use recommendations">
          <ul>
            <li>Set up RestPilot when you're rested — not after a 16-hour shift.</li>
            <li>
              Start with one or two features (Smart Alarm + Long Clock) before
              layering on Companion and Pattern Alerts.
            </li>
            <li>
              If a recommendation feels wrong, ignore it and tap "Not helpful"
              so the system learns.
            </li>
            <li>
              Review your <Link to="/memory" className="text-primary underline">AI Memory</Link>{" "}
              periodically and remove anything that's no longer true.
            </li>
            <li>
              Read our{" "}
              <Link to="/legal/disclaimers" className="text-primary underline">
                AI &amp; Health Disclaimers
              </Link>{" "}
              and{" "}
              <Link to="/legal/privacy" className="text-primary underline">
                Privacy Policy
              </Link>{" "}
              once during onboarding.
            </li>
          </ul>
        </Block>
      </div>

      <footer className="mt-16 border-t border-border/60 pt-6 text-xs text-muted-foreground">
        Questions or safety feedback? Email{" "}
        <a href="mailto:safety@restpilot.ai" className="text-primary underline">
          safety@restpilot.ai
        </a>
        .
      </footer>
    </main>
  );
}

function Block({
  id,
  icon: Icon,
  title,
  children,
}: {
  id: string;
  icon: typeof Brain;
  title: string;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      className="scroll-mt-24 rounded-3xl border border-border/60 bg-card/40 p-6 lg:p-8"
    >
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-primary/30 bg-primary/10">
          <Icon className="h-5 w-5 text-primary" />
        </span>
        <h2 className="text-xl font-semibold tracking-tight text-foreground">
          {title}
        </h2>
      </div>
      <div className="prose prose-invert mt-4 max-w-none text-sm leading-relaxed text-muted-foreground prose-strong:text-foreground prose-a:text-primary">
        {children}
      </div>
    </section>
  );
}
