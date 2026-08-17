import { createFileRoute, Link } from "@tanstack/react-router";
import {
  Calendar,
  Moon,
  Sparkles,
  Volume2,
  Shield,
  CreditCard,
  Server,
  Globe,
  FileText,
  Lock,
  TrendingDown,
  CheckCircle2,
  ArrowRight,
  Mail,
} from "lucide-react";

export const Route = createFileRoute("/for-sale")({
  head: () => ({
    meta: [
      { title: "RestPilot AI — For Sale" },
      {
        name: "description",
        content:
          "RestPilot AI is a production AI sleep and shift-recovery coach for shift workers, available for acquisition.",
      },
      { property: "og:title", content: "RestPilot AI — For Sale" },
      {
        property: "og:description",
        content:
          "Production AI sleep and shift-recovery coach for shift workers. Domain, source, and Supabase project included.",
      },
      { property: "og:url", content: "https://restpilotai.com/for-sale" },
      { name: "twitter:title", content: "RestPilot AI — For Sale" },
      {
        name: "twitter:description",
        content:
          "Production AI sleep and shift-recovery coach for shift workers. Domain, source, and Supabase project included.",
      },
    ],
    links: [{ rel: "canonical", href: "https://restpilotai.com/for-sale" }],
  }),
  component: ForSale,
});

const highlights = [
  {
    icon: Calendar,
    title: "Shift schedule dashboard",
    body: "Multi-week rotations, multi-employer support, and a clear visual plan for every day.",
  },
  {
    icon: Moon,
    title: "Wind-down + sleep window optimizer",
    body: "Adaptive light, caffeine, and blackout timing tuned to the user's real sunrise and shifts.",
  },
  {
    icon: Sparkles,
    title: "AI Sleep Coach with durable memory",
    body: "Conversational coach that learns preferences; memory is opt-in, editable, and wipeable.",
  },
  {
    icon: Volume2,
    title: "TTS briefings",
    body: "Streaming voice briefings summarize the day and recovery plan on demand.",
  },
  {
    icon: Shield,
    title: "Full auth lifecycle",
    body: "Signup, email confirmation, login, password recovery, and account deletion are all wired.",
  },
  {
    icon: CreditCard,
    title: "Buyer-ready Stripe handoff",
    body: "Billing architecture is in place; buyer connects their own Stripe account and keeps 100% of revenue.",
  },
];

const included = [
  "Domain: restpilotai.com",
  "Full source code",
  "Supabase project transfer docs",
  "Transfer support (owner-approved terms)",
];

const notIncluded = [
  "Seller Stripe account / keys",
  "Seller API secrets (buyer replaces with their own)",
];

const stack = [
  { icon: Server, label: "TanStack Start + React 19" },
  { icon: Globe, label: "Lovable hosting" },
  { icon: Shield, label: "Supabase (auth + database)" },
  { icon: Sparkles, label: "AI gateway + OpenAI" },
  { icon: Volume2, label: "TTS (ElevenLabs)" },
  { icon: CreditCard, label: "Stripe (buyer-owned account)" },
];

function ForSale() {
  return (
    <div>
      <section className="relative isolate py-20 lg:py-28">
        <div
          className="pointer-events-none absolute inset-0 -z-10"
          style={{ background: "var(--gradient-hero)" }}
        />
        <div className="mx-auto w-full max-w-7xl px-5 text-center lg:px-10">
          <p className="text-[11px] font-semibold uppercase tracking-[0.25em] text-indigo-glow">
            Acquisition listing
          </p>
          <h1
            className="mt-3 text-5xl leading-tight tracking-tight lg:text-6xl"
            style={{ fontFamily: "var(--font-display)" }}
          >
            RestPilot AI <span className="italic text-indigo-glow">For Sale</span>
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-base text-muted-foreground">
            Production AI sleep &amp; shift-recovery coach for shift workers. A complete,
            sale-certified product ready for a new owner.
          </p>

          <div className="mx-auto mt-10 inline-block rounded-[2rem] border border-primary/30 bg-card/60 p-8 text-center shadow-[var(--shadow-glow)] backdrop-blur-sm">
            <p className="text-sm font-medium text-muted-foreground">Asking price</p>
            <p
              className="mt-2 text-6xl tracking-tight lg:text-7xl"
              style={{ fontFamily: "var(--font-display)" }}
            >
              $25,000 USD
            </p>
            <p className="mt-3 text-xs text-muted-foreground">Offers require owner approval</p>
          </div>

          <div className="mt-10 flex flex-col items-center justify-center gap-4 sm:flex-row">
            <a
              href="https://restpilotai.com"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 rounded-full border border-border bg-secondary/60 px-6 py-3 text-sm font-semibold transition hover:bg-secondary"
            >
              Live demo
              <ArrowRight className="h-4 w-4" />
            </a>
            <a
              href="mailto:scubamike124@gmail.com?subject=RestPilot%20AI%20acquisition%20inquiry"
              className="inline-flex items-center gap-2 rounded-full bg-foreground px-6 py-3 text-sm font-semibold text-background transition hover:opacity-90"
            >
              <Mail className="h-4 w-4" />
              Email owner
            </a>
          </div>
        </div>
      </section>

      <section className="px-5 py-16 lg:px-10 lg:py-20">
        <div className="mx-auto w-full max-w-7xl">
          <div className="mb-10 max-w-2xl">
            <p className="text-[11px] font-semibold uppercase tracking-[0.25em] text-indigo-glow">
              What's built
            </p>
            <h2
              className="mt-2 text-3xl tracking-tight lg:text-4xl"
              style={{ fontFamily: "var(--font-display)" }}
            >
              Features included in the sale
            </h2>
          </div>
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {highlights.map((it) => {
              const Icon = it.icon;
              return (
                <div
                  key={it.title}
                  className="rounded-3xl border border-border/60 bg-card/50 p-7 transition hover:border-primary/40 hover:bg-card"
                >
                  <span className="flex h-11 w-11 items-center justify-center rounded-2xl border border-primary/30 bg-secondary/60">
                    <Icon className="h-5 w-5 text-indigo-glow" />
                  </span>
                  <h3 className="mt-5 text-xl" style={{ fontFamily: "var(--font-display)" }}>
                    {it.title}
                  </h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{it.body}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      <section className="px-5 py-16 lg:px-10 lg:py-20">
        <div className="mx-auto grid w-full max-w-7xl gap-8 lg:grid-cols-2">
          <div className="rounded-3xl border border-border/60 bg-card/50 p-8">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-2xl border border-primary/30 bg-secondary/60">
                <CheckCircle2 className="h-5 w-5 text-indigo-glow" />
              </span>
              <h2
                className="text-2xl tracking-tight"
                style={{ fontFamily: "var(--font-display)" }}
              >
                Included
              </h2>
            </div>
            <ul className="mt-6 space-y-3">
              {included.map((item) => (
                <li key={item} className="flex items-start gap-3 text-sm text-foreground/90">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-indigo-glow" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="rounded-3xl border border-border/60 bg-card/50 p-8">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-2xl border border-primary/30 bg-secondary/60">
                <Lock className="h-5 w-5 text-indigo-glow" />
              </span>
              <h2
                className="text-2xl tracking-tight"
                style={{ fontFamily: "var(--font-display)" }}
              >
                Not included
              </h2>
            </div>
            <ul className="mt-6 space-y-3">
              {notIncluded.map((item) => (
                <li key={item} className="flex items-start gap-3 text-sm text-foreground/90">
                  <Lock className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <section className="px-5 py-16 lg:px-10 lg:py-20">
        <div className="mx-auto w-full max-w-7xl">
          <div className="mb-10 max-w-2xl">
            <p className="text-[11px] font-semibold uppercase tracking-[0.25em] text-indigo-glow">
              Stack
            </p>
            <h2
              className="mt-2 text-3xl tracking-tight lg:text-4xl"
              style={{ fontFamily: "var(--font-display)" }}
            >
              Technology &amp; integrations
            </h2>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {stack.map((it) => {
              const Icon = it.icon;
              return (
                <div
                  key={it.label}
                  className="flex items-center gap-4 rounded-2xl border border-border/60 bg-card/40 px-5 py-4"
                >
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-primary/30 bg-secondary/60">
                    <Icon className="h-4 w-4 text-indigo-glow" />
                  </span>
                  <span className="text-sm font-medium text-foreground/90">{it.label}</span>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      <section className="px-5 py-16 lg:px-10 lg:py-20">
        <div className="mx-auto w-full max-w-7xl">
          <div className="grid gap-8 lg:grid-cols-3">
            <div className="rounded-3xl border border-border/60 bg-card/50 p-8 lg:col-span-2">
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-2xl border border-primary/30 bg-secondary/60">
                  <FileText className="h-5 w-5 text-indigo-glow" />
                </span>
                <h2
                  className="text-2xl tracking-tight"
                  style={{ fontFamily: "var(--font-display)" }}
                >
                  Sale terms
                </h2>
              </div>
              <div className="mt-6 space-y-4 text-sm leading-relaxed text-muted-foreground">
                <p>
                  This is a private sale listing. The asking price is{" "}
                  <strong className="text-foreground">$25,000 USD</strong>. Serious acquisition
                  inquiries should be sent to{" "}
                  <a
                    href="mailto:scubamike124@gmail.com?subject=RestPilot%20AI%20acquisition%20inquiry"
                    className="text-indigo-glow underline"
                  >
                    scubamike124@gmail.com
                  </a>{" "}
                  with the subject line{" "}
                  <em className="text-foreground">RestPilot AI acquisition inquiry</em>.
                </p>
                <p>
                  All offers require owner approval. No binding sale, transfer, or asset movement
                  will occur without explicit owner approval and a signed agreement.
                </p>
              </div>
            </div>

            <div className="rounded-3xl border border-border/60 bg-card/50 p-8">
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-2xl border border-primary/30 bg-secondary/60">
                  <TrendingDown className="h-5 w-5 text-indigo-glow" />
                </span>
                <h2
                  className="text-2xl tracking-tight"
                  style={{ fontFamily: "var(--font-display)" }}
                >
                  Revenue
                </h2>
              </div>
              <p className="mt-6 text-sm leading-relaxed text-muted-foreground">
                Verified MRR is currently{" "}
                <strong className="text-foreground">$0</strong>. This is a pre-revenue product
                sale; buyer assumes all growth, marketing, and monetization risk.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="px-5 pb-24 lg:px-10 lg:pb-32">
        <div
          className="relative mx-auto w-full max-w-7xl overflow-hidden rounded-[40px] border border-primary/30 p-12 lg:p-20"
          style={{ background: "var(--gradient-hero)" }}
        >
          <div className="pointer-events-none absolute -right-20 -top-20 h-72 w-72 rounded-full bg-indigo/40 blur-3xl breathe" />
          <div className="relative max-w-2xl">
            <p className="text-[11px] font-semibold uppercase tracking-[0.25em] text-indigo-glow">
              Status: production sale-certified
            </p>
            <h2
              className="mt-3 text-4xl leading-tight tracking-tight lg:text-5xl"
              style={{ fontFamily: "var(--font-display)" }}
            >
              Ready for a new owner.
            </h2>
            <p className="mt-5 text-lg text-muted-foreground">
              Review the live demo, then reach out to discuss terms, due diligence, and transfer.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <a
                href="mailto:scubamike124@gmail.com?subject=RestPilot%20AI%20acquisition%20inquiry"
                className="inline-flex items-center justify-center gap-2 rounded-full bg-foreground px-7 py-4 text-sm font-semibold text-background transition hover:opacity-90"
              >
                <Mail className="h-4 w-4" />
                scubamike124@gmail.com
              </a>
              <Link
                to="/"
                className="inline-flex items-center justify-center gap-2 rounded-full border border-border bg-secondary/60 px-7 py-4 text-sm font-semibold transition hover:bg-secondary"
              >
                Back to home
                <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
