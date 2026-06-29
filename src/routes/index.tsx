import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  Moon,
  Sun,
  Coffee,
  Calendar,
  Watch,
  Shield,
  ArrowRight,
  Check,
  Quote,
  AlertTriangle,
  Car,
  Lightbulb,
  Heart,
  Send,
  Bell,
  TrendingDown,
  Sparkles,
  Mic,
  Waves,
  BellRing,
  MessageCircle,
  Repeat,
  Lock,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { CompanionAvatarFace } from "@/components/companion/Avatar";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "RestPilot AI — Meet the AI companion that helps you sleep better" },
      {
        name: "description",
        content:
          "Meet Aura — the AI sleep companion you can see, tap, and talk to. Calming sounds, smart alarm, wind-down guidance, and a personal assistant built for shift life.",
      },
      { property: "og:title", content: "Meet the AI companion that helps you unwind, sleep & wake up better" },
      {
        property: "og:description",
        content:
          "Tap your companion after work. Ask for calming sounds, start a wind-down routine, or let Aura wake you at the right time.",
      },
      { property: "og:url", content: "https://shift-rest-ai.lovable.app/" },
    ],
    links: [{ rel: "canonical", href: "https://shift-rest-ai.lovable.app/" }],
  }),
  component: Landing,
});

function Landing() {
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [showBelowFold, setShowBelowFold] = useState(false);
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSignedIn(!!data.session));
    // Defer below-fold work until the browser is idle so hero LCP stays fast.
    const w = window as Window & { requestIdleCallback?: (cb: () => void) => number };
    const schedule = w.requestIdleCallback ?? ((cb: () => void) => window.setTimeout(cb, 200));
    schedule(() => setShowBelowFold(true));
  }, []);
  const ctaHref = signedIn ? "/dashboard" : "/auth";

  return (
    <div
      className="overflow-hidden"
      style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 4.5rem)" }}
    >
      <Hero ctaHref={ctaHref} />
      <LogoTicker />
      {showBelowFold && (
        <>
          <CompanionShowcaseSection ctaHref={ctaHref} />
          <DayInLifeSection />
          <SmartAlarmSection />
          <DashboardSection />
          <Testimonials />
          <PricingPreview ctaHref={ctaHref} />
          <CtaBand ctaHref={ctaHref} />
        </>
      )}
    </div>
  );
}


/* ============================================================ HERO */

function Hero({ ctaHref }: { ctaHref: string }) {
  return (
    <section className="relative isolate">
      <div
        className="pointer-events-none absolute inset-0 -z-10"
        style={{ background: "var(--gradient-hero)" }}
      />
      <div className="pointer-events-none absolute -top-32 left-1/2 -z-10 h-[600px] w-[900px] -translate-x-1/2 rounded-full bg-indigo/30 blur-[160px]" />
      <div className="pointer-events-none absolute right-0 top-40 -z-10 h-[400px] w-[400px] rounded-full bg-indigo-glow/20 blur-[120px]" />

      <div className="mx-auto w-full max-w-7xl px-5 pt-20 pb-20 lg:px-10 lg:pt-28 lg:pb-24">
        <div className="grid items-center gap-12 lg:grid-cols-[1.05fr_1fr] lg:gap-16">
          <div>
            <span className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-secondary/40 px-3 py-1 text-xs font-medium text-indigo-glow backdrop-blur-sm">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-indigo-glow" />
              Aura · the AI companion you can see, tap & talk to
            </span>
            <h1
              className="mt-6 text-4xl leading-[1.05] tracking-tight sm:text-6xl lg:text-7xl"
              style={{ fontFamily: "var(--font-display)" }}
            >
              {/* Mobile: short, punchy */}
              <span className="sm:hidden">
                Meet the AI <span className="italic text-indigo-glow">companion</span> that helps you sleep better.
              </span>
              {/* Tablet + desktop: full editorial line */}
              <span className="hidden sm:inline">
                Meet the AI{" "}
                <span className="italic text-indigo-glow">companion</span> that
                helps you unwind, sleep, and wake up better.
              </span>
            </h1>
            <p className="mt-5 max-w-xl text-base leading-relaxed text-muted-foreground sm:mt-6 sm:text-lg">
              <span className="sm:hidden">
                Tap to talk. Sleep sounds, smart alarm, and wind-down guidance — one calm assistant for the hours that wreck everyone else.
              </span>
              <span className="hidden sm:inline">
                Tap your companion after work, ask for calming sounds, start a
                wind-down routine, or let her wake you at the right time —
                a personal assistant built for shift life.
              </span>
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
                to="/companion"
                search={{ intro: 1 }}
                className="inline-flex items-center gap-2 rounded-full border border-border bg-card/60 px-6 py-3.5 text-sm font-semibold text-foreground backdrop-blur-sm transition hover:bg-card"
              >
                <Mic className="h-4 w-4 text-indigo-glow" />
                Meet your Companion
              </Link>
            </div>

            {/* Capability chips — what Aura actually does */}
            <div className="mt-7 flex flex-wrap gap-2">
              <CapChip icon={Mic} label="Tap to talk" />
              <CapChip icon={Waves} label="Sleep sounds" />
              <CapChip icon={BellRing} label="Smart alarm" />
              <CapChip icon={Moon} label="Wind-down guidance" />
            </div>

            <p className="mt-5 text-xs text-muted-foreground">
              <Shield className="mr-1.5 inline h-3.5 w-3.5 text-indigo-glow" />
              Private by default · Fitbit & Oura sync · Personalized memory
            </p>
          </div>

          <div className="relative mx-auto w-full max-w-lg">
            <HeroStack ctaHref={ctaHref} />
          </div>
        </div>
      </div>
    </section>
  );
}

function CapChip({ icon: Icon, label }: { icon: typeof Shield; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-card/50 px-3 py-1.5 text-xs font-medium text-foreground backdrop-blur-sm">
      <Icon className="h-3.5 w-3.5 text-indigo-glow" />
      {label}
    </span>
  );
}


function HeroStack({ ctaHref }: { ctaHref: string }) {
  // Avatar always opens the live Companion experience. If the user isn't
  // signed in yet, the /auth route will round-trip them back to /companion
  // via ?return= so the tap never lands on a dead end.
  const avatarTarget = ctaHref === "/dashboard" ? "/companion" : "/auth";
  const avatarSearch =
    ctaHref === "/dashboard" ? { greet: 1 } : { return: "/companion?greet=1" };
  return (
    <div className="relative w-full lg:aspect-[5/6]">
      {/* Primary: Companion glass card */}
      <Link
        to={avatarTarget}
        search={avatarSearch as never}
        aria-label="Open your AI Companion"
        className="group relative flex aspect-[5/6] w-full flex-col items-center justify-between rounded-[36px] border border-white/10 bg-card/60 p-6 text-center shadow-[var(--shadow-card)] backdrop-blur-xl transition hover:border-primary/40 sm:p-8 lg:absolute lg:inset-0 lg:aspect-auto"
        style={{
          background:
            "radial-gradient(120% 80% at 50% 0%, oklch(0.32 0.14 280 / 0.55), transparent 60%), linear-gradient(180deg, oklch(0.16 0.04 270 / 0.85), oklch(0.10 0.03 270 / 0.85))",
        }}
      >
        {/* glow ring behind avatar */}
        <div className="pointer-events-none absolute left-1/2 top-[18%] -z-10 h-72 w-72 -translate-x-1/2 rounded-full bg-indigo/40 blur-3xl" />

        <div className="flex flex-col items-center pt-2">
          <p className="text-[10px] font-semibold uppercase tracking-[0.3em] text-indigo-glow">
            Live · Tap to talk to Aura
          </p>
          <p
            className="mt-2 text-3xl sm:text-4xl"
            style={{ fontFamily: "var(--font-display)" }}
          >
            Meet Aura.
          </p>
          <p className="mt-1.5 max-w-[18rem] text-xs italic text-muted-foreground">
            "Hey — rough shift? Let's wind down."
          </p>
        </div>

        <div className="relative">
          <CompanionAvatarFace state="idle" size="lg" aura label="Tap to talk" />
        </div>

        <div className="flex w-full flex-col items-center gap-3">
          <span className="inline-flex items-center gap-2 rounded-full border border-primary/40 bg-background/60 px-5 py-2.5 text-sm font-semibold text-foreground backdrop-blur-md transition group-hover:scale-[1.02]">
            <Mic className="h-4 w-4 text-indigo-glow" />
            Tap to talk
            <span className="pulse-dot ml-1 h-1.5 w-1.5 rounded-full bg-indigo-glow" />
          </span>
          <div className="flex flex-wrap items-center justify-center gap-1.5 text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
            <span className="rounded-full border border-border/60 bg-card/50 px-2.5 py-1">Sleep sounds</span>
            <span className="rounded-full border border-border/60 bg-card/50 px-2.5 py-1">Smart alarm</span>
            <span className="rounded-full border border-border/60 bg-card/50 px-2.5 py-1">Wind-down</span>
          </div>
        </div>
      </Link>

      {/* Tonight tile — stacked under hero on mobile, floats at lg+ (top-right, clear of mic CTA) */}
      <div className="mt-4 w-full rounded-2xl border border-primary/30 bg-background/90 p-3.5 shadow-[var(--shadow-glow)] backdrop-blur-xl float-y lg:absolute lg:-right-6 lg:-top-6 lg:mt-0 lg:w-[44%] lg:max-w-[220px]">
        <div className="flex items-center justify-between">
          <p className="text-[9px] font-semibold uppercase tracking-[0.25em] text-indigo-glow">
            Tonight · Tue
          </p>
          <span className="flex h-6 w-6 items-center justify-center rounded-full border border-primary/30 bg-secondary">
            <Moon className="h-3 w-3 text-indigo-glow" />
          </span>
        </div>
        <p
          className="mt-1 text-base leading-tight"
          style={{ fontFamily: "var(--font-display)" }}
        >
          Sleep window 8:40 AM
        </p>
        <div className="relative mx-auto mt-1 aspect-square w-full max-w-[140px]">
          <CircadianDial />
        </div>
      </div>
    </div>
  );
}

function CircadianDial() {
  const R = 110;
  const C = 2 * Math.PI * R;
  return (
    <>
      <svg viewBox="0 0 280 280" className="h-full w-full -rotate-90">
        <circle cx="140" cy="140" r={R} fill="none" stroke="var(--secondary)" strokeWidth="14" />
        <circle
          cx="140" cy="140" r={R} fill="none"
          stroke="var(--indigo)" strokeWidth="14" strokeLinecap="round"
          strokeDasharray={`${C * 0.42} ${C}`} strokeDashoffset={-C * 0.05}
        />
        <circle
          cx="140" cy="140" r={R} fill="none"
          stroke="var(--amber)" strokeWidth="10" strokeLinecap="round"
          opacity="0.85" strokeDasharray={`${C * 0.04} ${C}`} strokeDashoffset={-C * 0.47}
        />
        <circle
          cx="140" cy="140" r={R} fill="none"
          stroke="var(--indigo-glow)" strokeWidth="8" strokeLinecap="round"
          opacity="0.8" strokeDasharray={`${C * 0.32} ${C}`} strokeDashoffset={-C * 0.51}
        />
      </svg>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
        <p className="text-4xl" style={{ fontFamily: "var(--font-display)" }}>22</p>
        <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
          Debt · low
        </p>
      </div>
    </>
  );
}

/* ============================================================ LOGO TICKER */

function LogoTicker() {
  const roles = [
    "ICU Nurses", "Airline Pilots", "Firefighters", "ER Physicians",
    "Long-haul Drivers", "Police Officers", "Air Traffic Control",
    "Offshore Crews", "Paramedics", "NICU RNs",
  ];
  const items = [...roles, ...roles];
  return (
    <section className="relative isolate z-0 mt-6 border-y border-border/60 bg-background/40 py-8">
      <p className="text-center text-[10px] font-semibold uppercase tracking-[0.3em] text-muted-foreground">
        Built for people who work when others sleep
      </p>
      <div className="mt-5 overflow-hidden">
        <div className="ticker-track flex w-max gap-12 whitespace-nowrap text-sm text-muted-foreground/70">
          {items.map((r, i) => (
            <span key={i} className="inline-flex items-center gap-3">
              <span className="h-1 w-1 rounded-full bg-indigo-glow/60" />
              {r}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ============================================================ LIVE COACH */

function LiveCoachSection() {
  return (
    <section id="live-coach" className="relative py-24 lg:py-32">
      <div className="mx-auto w-full max-w-7xl px-5 lg:px-10">
        <div className="grid items-center gap-14 lg:grid-cols-[1fr_1.1fr]">
          <div>
            <Eyebrow>The AI coach</Eyebrow>
            <h2 className="mt-3 text-4xl leading-tight tracking-tight lg:text-5xl">
              It remembers <em className="text-indigo-glow not-italic">you</em>,
              not a generic sleeper.
            </h2>
            <p className="mt-5 max-w-lg text-base leading-relaxed text-muted-foreground">
              The coach reads your rotation, your last night of Fitbit data,
              your caffeine ceiling, and the recovery patterns it learned about
              you. Then it speaks like a human.
            </p>
            <ul className="mt-7 space-y-3 text-sm">
              {[
                "Personal AI memory — yours, exportable, wipeable",
                "Streams in real time, like a real assistant",
                "Knows your shift in 3 employers and reconciles them",
              ].map((t) => (
                <li key={t} className="flex items-start gap-3">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-indigo-glow" />
                  <span className="text-foreground/90">{t}</span>
                </li>
              ))}
            </ul>
          </div>
          <CoachMock />
        </div>
      </div>
    </section>
  );
}

function CoachMock() {
  return (
    <div className="relative">
      <div className="pointer-events-none absolute -inset-6 rounded-[44px] bg-indigo/15 blur-3xl" />
      <div className="relative overflow-hidden rounded-[28px] border border-border bg-card/80 shadow-[var(--shadow-card)] backdrop-blur-xl">
        <div className="flex items-center justify-between border-b border-border/60 px-5 py-3 text-xs">
          <span className="inline-flex items-center gap-2 font-semibold text-foreground/80">
            <span className="pulse-dot h-1.5 w-1.5 rounded-full bg-indigo-glow" />
            RestPilot AI · streaming
          </span>
          <span className="text-muted-foreground">gemini · personalized</span>
        </div>

        <div className="space-y-4 px-5 py-6">
          {/* user */}
          <div className="flex justify-end">
            <div className="max-w-[78%] rounded-2xl rounded-br-md bg-primary px-4 py-2.5 text-sm text-primary-foreground">
              I have a 12h night Thursday, then a 6 AM flight Friday. Help.
            </div>
          </div>

          {/* assistant */}
          <div className="max-w-[88%]">
            <div className="text-[10px] font-semibold uppercase tracking-widest text-indigo-glow">
              RestPilot
            </div>
            <p className="mt-1 text-sm leading-relaxed text-foreground/90">
              Brutal combo. Here's what I'd do based on your last 3 night rotations:
            </p>
            <ul className="mt-3 space-y-1.5 text-sm text-foreground/90">
              <li>· Anchor sleep <span className="text-indigo-glow font-semibold">9:00 AM–1:30 PM Fri</span> (4.5h, ends one cycle).</li>
              <li>· Last caffeine <span className="text-indigo-glow font-semibold">3:30 AM</span> — your half-life runs long.</li>
              <li>· Bright light on the jet bridge, not in the car.</li>
              <li>· Land · 90-min recovery nap before evening. <span className="caret" /></li>
            </ul>
            <div className="mt-4 flex gap-2 text-[11px]">
              <ChipBtn>Add to plan</ChipBtn>
              <ChipBtn>Set smart alarm</ChipBtn>
              <ChipBtn>Brief me by voice</ChipBtn>
            </div>
          </div>
        </div>

        <div className="border-t border-border/60 bg-background/40 p-3">
          <div className="flex items-center gap-2 rounded-full border border-border bg-card px-4 py-2.5 text-sm text-muted-foreground">
            Ask anything about your week…
            <Send className="ml-auto h-4 w-4 text-indigo-glow" />
          </div>
        </div>
      </div>
    </div>
  );
}

function ChipBtn({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full border border-primary/30 bg-secondary/60 px-3 py-1 text-indigo-glow">
      {children}
    </span>
  );
}

/* ============================================================ LONG CLOCK / 7-DAY TIMELINE */

function LongClockSection() {
  return (
    <section className="relative border-y border-border/60 bg-background/50 py-24 lg:py-32">
      <div className="pointer-events-none absolute inset-0 -z-10 opacity-60"
        style={{ background: "var(--gradient-hero)" }} />
      <div className="mx-auto w-full max-w-7xl px-5 lg:px-10">
        <div className="grid items-end gap-6 lg:grid-cols-[1.2fr_1fr]">
          <div>
            <Eyebrow>The long clock</Eyebrow>
            <h2 className="mt-3 text-4xl leading-tight tracking-tight lg:text-5xl">
              See the next seven days, hour by hour.
            </h2>
          </div>
          <p className="max-w-md text-base leading-relaxed text-muted-foreground">
            Every shift, sleep block, wind-down, light window and caffeine
            cutoff — laid out on one continuous timeline so debt never sneaks up.
          </p>
        </div>

        <div className="relative mt-12 overflow-hidden rounded-[28px] border border-border bg-card/60 p-5 backdrop-blur-xl lg:p-8">
          <TimelineMock />
        </div>
      </div>
    </section>
  );
}

function TimelineMock() {
  const days = ["Mon 13", "Tue 14", "Wed 15", "Thu 16", "Fri 17", "Sat 18", "Sun 19"];
  // each day: [shiftStart%, shiftEnd%, sleepStart%, sleepEnd%, label]
  const data = [
    { sh: [29, 75], sl: [4, 25], lbl: "12h day · Mercy" },
    { sh: [75, 100], sl: [38, 62], lbl: "night #1" },
    { sh: [0, 30], sl: [38, 75], lbl: "post-night anchor" },
    { sh: [75, 100], sl: [38, 62], lbl: "night #2" },
    { sh: [0, 30], sl: [38, 75], lbl: "night #3 ↘" },
    { sh: [], sl: [4, 38], lbl: "recovery", rest: true },
    { sh: [], sl: [4, 33], lbl: "off · sunlight day", rest: true },
  ];
  const hours = [0, 4, 8, 12, 16, 20, 24];
  return (
    <div>
      <div className="flex items-center gap-3 text-xs">
        <Legend color="var(--indigo)" label="Shift" />
        <Legend color="var(--indigo-glow)" label="Sleep" />
        <Legend color="var(--amber)" label="Wind down" />
        <span className="ml-auto inline-flex items-center gap-2 rounded-full border border-primary/30 bg-secondary/60 px-3 py-1 text-[11px] text-indigo-glow">
          <TrendingDown className="h-3 w-3" /> Debt trending down
        </span>
      </div>

      {/* hour axis */}
      <div className="relative mt-6 ml-[88px] grid grid-cols-6 text-[10px] text-muted-foreground/70">
        {hours.slice(0, 6).map((h) => (
          <span key={h}>{String(h).padStart(2, "0")}:00</span>
        ))}
      </div>

      <div className="mt-2 space-y-2">
        {days.map((d, i) => {
          const row = data[i];
          return (
            <div key={d} className="grid grid-cols-[80px_1fr_auto] items-center gap-3">
              <span className="text-xs text-muted-foreground">{d}</span>
              <div className="relative h-9 overflow-hidden rounded-lg border border-border/70 bg-background/40">
                {/* gridlines */}
                <div className="absolute inset-0 grid grid-cols-6">
                  {Array.from({ length: 6 }).map((_, k) => (
                    <div key={k} className="border-l border-border/30 first:border-0" />
                  ))}
                </div>
                {/* sleep */}
                {row.sl.length === 2 && (
                  <div
                    className="absolute top-1.5 h-6 rounded-md"
                    style={{
                      left: `${row.sl[0]}%`,
                      width: `${row.sl[1] - row.sl[0]}%`,
                      background: "linear-gradient(90deg, var(--indigo-glow), oklch(0.72 0.16 275 / 0.4))",
                    }}
                  />
                )}
                {/* shift */}
                {row.sh.length === 2 && (
                  <div
                    className="absolute top-1.5 h-6 overflow-hidden rounded-md"
                    style={{
                      left: `${row.sh[0]}%`,
                      width: `${row.sh[1] - row.sh[0]}%`,
                      background: "linear-gradient(90deg, var(--indigo), oklch(0.42 0.18 280))",
                    }}
                  >
                    <span className="sweep-overlay" />
                  </div>
                )}
                {/* wind-down dot */}
                {row.sh.length === 2 && (
                  <div
                    className="absolute top-2 h-5 w-[3%] rounded-sm bg-amber/80"
                    style={{ left: `${Math.max(0, row.sh[0] - 4)}%` }}
                  />
                )}
              </div>
              <span className={`text-[11px] ${row.rest ? "text-indigo-glow" : "text-muted-foreground"}`}>
                {row.lbl}
              </span>
            </div>
          );
        })}
      </div>

      <div className="mt-6 grid gap-3 sm:grid-cols-3">
        <Stat label="Sleep debt by Sunday" value="−14 pts" tone="good" />
        <Stat label="Light minutes scheduled" value="6h 20m" />
        <Stat label="Caffeine cutoffs" value="5 · personalized" />
      </div>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "good" }) {
  return (
    <div className="rounded-xl border border-border/60 bg-background/40 px-4 py-3">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">{label}</p>
      <p className={`mt-1 text-xl font-semibold ${tone === "good" ? "text-indigo-glow" : ""}`}>
        {value}
      </p>
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-muted-foreground">
      <span className="h-2 w-2 rounded-sm" style={{ background: color }} />
      {label}
    </span>
  );
}

/* ============================================================ SMART ALARM */

function SmartAlarmSection() {
  return (
    <section className="py-24 lg:py-32">
      <div className="mx-auto w-full max-w-7xl px-5 lg:px-10">
        <div className="grid items-center gap-14 lg:grid-cols-[1fr_1.1fr]">
          <SmartAlarmMock />
          <div>
            <Eyebrow>Smart alarm</Eyebrow>
            <h2 className="mt-3 text-4xl leading-tight tracking-tight lg:text-5xl">
              Wake at the lightest point of your cycle — not by accident.
            </h2>
            <p className="mt-5 max-w-lg text-base leading-relaxed text-muted-foreground">
              RestPilot watches your cycles and triggers the alarm inside a
              window you choose. If you fall asleep late or your wearable
              reports poor REM, it shifts automatically.
            </p>
            <div className="mt-7 grid grid-cols-2 gap-3">
              <Mini icon={Bell} title="Window-based" body="Fires in a 30-min sweet spot, not a hard time." />
              <Mini icon={Watch} title="Wearable aware" body="Adapts to last night's sleep stages." />
              <Mini icon={Sun} title="Light-synced" body="Pairs wake with bright-light prompt." />
              <Mini icon={Sparkles} title="Auto-rescue" body="Misses a shift? It re-plans the day." />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function Mini({ icon: Icon, title, body }: { icon: typeof Bell; title: string; body: string }) {
  return (
    <div className="rounded-2xl border border-border/60 bg-card/50 p-4">
      <div className="flex items-center gap-2 text-indigo-glow">
        <Icon className="h-4 w-4" />
        <span className="text-sm font-semibold text-foreground">{title}</span>
      </div>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{body}</p>
    </div>
  );
}

function SmartAlarmMock() {
  return (
    <div className="relative mx-auto w-full max-w-md">
      <div className="pointer-events-none absolute -inset-6 rounded-[44px] bg-indigo-glow/15 blur-3xl" />
      <div className="relative overflow-hidden rounded-[32px] border border-border bg-card/80 p-6 shadow-[var(--shadow-card)] backdrop-blur-xl">
        <div className="flex items-center justify-between text-xs">
          <span className="font-semibold uppercase tracking-widest text-indigo-glow">Smart alarm</span>
          <span className="text-muted-foreground">Friday wake</span>
        </div>
        <p className="mt-3 text-5xl tracking-tight" style={{ fontFamily: "var(--font-display)" }}>
          5:42 <span className="text-2xl text-muted-foreground">AM</span>
        </p>
        <p className="text-xs text-muted-foreground">Target window 5:30–6:00 · early-cycle exit detected</p>

        {/* waveform */}
        <div className="mt-5 flex h-24 items-end gap-1.5">
          {Array.from({ length: 36 }).map((_, i) => {
            const h = 22 + Math.round(60 * Math.abs(Math.sin(i * 0.5)));
            const isWake = i === 24;
            return (
              <div
                key={i}
                className="wave-bar flex-1 rounded-sm"
                style={{
                  height: `${h}%`,
                  background: isWake
                    ? "var(--amber)"
                    : `oklch(0.72 0.16 275 / ${0.25 + (i % 5) * 0.12})`,
                  animationDelay: `${(i % 8) * 0.15}s`,
                  boxShadow: isWake ? "0 0 18px var(--amber)" : undefined,
                }}
              />
            );
          })}
        </div>

        <div className="mt-5 grid grid-cols-3 gap-2 text-center text-[10px]">
          <CycleChip label="Cycle 1" sub="deep" />
          <CycleChip label="Cycle 4" sub="REM" />
          <CycleChip label="Wake" sub="light" active />
        </div>

        <div className="mt-5 rounded-2xl border border-primary/30 p-3" style={{ background: "var(--gradient-cta)" }}>
          <p className="text-[10px] font-semibold uppercase tracking-widest text-primary-foreground/80">
            On wake
          </p>
          <p className="mt-1 text-sm text-primary-foreground">
            10,000 lux light · espresso OK · brief plays in 2 min
          </p>
        </div>
      </div>
    </div>
  );
}

function CycleChip({ label, sub, active }: { label: string; sub: string; active?: boolean }) {
  return (
    <div className={`rounded-xl border px-2 py-2 ${active ? "border-amber/60 bg-amber/10" : "border-border bg-background/40"}`}>
      <p className="font-semibold text-foreground">{label}</p>
      <p className="text-muted-foreground">{sub}</p>
    </div>
  );
}

/* ============================================================ DASHBOARD + RECOMMENDATIONS */

function DashboardSection() {
  return (
    <section className="border-y border-border/60 bg-background/40 py-24 lg:py-32">
      <div className="mx-auto w-full max-w-7xl px-5 lg:px-10">
        <div className="text-center">
          <Eyebrow>Your dashboard</Eyebrow>
          <h2 className="mx-auto mt-3 max-w-2xl text-4xl leading-tight tracking-tight lg:text-5xl">
            Personalized recommendations, refreshed every hour.
          </h2>
        </div>

        <div className="relative mt-14">
          <div className="pointer-events-none absolute -inset-x-10 -inset-y-6 rounded-[44px] bg-indigo/15 blur-3xl" />
          <div className="relative grid gap-4 rounded-[28px] border border-border bg-card/70 p-5 shadow-[var(--shadow-card)] backdrop-blur-xl lg:grid-cols-12 lg:p-7">
            {/* hero stat */}
            <div className="lg:col-span-4 rounded-2xl border border-primary/30 p-5" style={{ background: "var(--gradient-cta)" }}>
              <p className="text-[10px] font-semibold uppercase tracking-widest text-primary-foreground/80">Circadian debt</p>
              <p className="mt-1 text-6xl font-semibold text-primary-foreground" style={{ fontFamily: "var(--font-display)" }}>22</p>
              <p className="mt-1 text-xs text-primary-foreground/80">/100 · stable · −3 vs yesterday</p>
              <div className="mt-5 h-1.5 rounded-full bg-background/30">
                <div className="h-full w-[22%] rounded-full bg-primary-foreground" />
              </div>
            </div>

            {/* next sleep */}
            <div className="lg:col-span-4 rounded-2xl border border-border bg-background/40 p-5">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-indigo-glow">Next sleep</p>
              <p className="mt-1 text-3xl font-semibold">8:40 AM → 4:20 PM</p>
              <p className="text-xs text-muted-foreground">7h 40m · ends 1 cycle before commute</p>
              <div className="mt-4 flex gap-2 text-[11px]">
                <ChipBtn>Blackout on</ChipBtn>
                <ChipBtn>Wind-down 7:40 AM</ChipBtn>
              </div>
            </div>

            {/* last night */}
            <div className="lg:col-span-4 rounded-2xl border border-border bg-background/40 p-5">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-indigo-glow">Last night · Oura</p>
              <p className="mt-1 text-3xl font-semibold">6h 04m</p>
              <p className="text-xs text-muted-foreground">REM low · HRV 38 · readiness 71</p>
              <div className="mt-4 flex h-2 gap-0.5">
                <div className="h-full w-[20%] rounded-l-sm bg-indigo" />
                <div className="h-full w-[35%] bg-indigo-glow" />
                <div className="h-full w-[25%] bg-amber/70" />
                <div className="h-full w-[20%] rounded-r-sm bg-secondary" />
              </div>
            </div>

            {/* recommendations list */}
            <div className="lg:col-span-7 rounded-2xl border border-border bg-background/40 p-5">
              <div className="flex items-center justify-between">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-indigo-glow">Today's recommendations</p>
                <span className="text-[10px] text-muted-foreground">Updated 2 min ago</span>
              </div>
              <ul className="mt-3 divide-y divide-border/60">
                {[
                  { i: Sun, t: "Bright light 7:00–9:00 PM", s: "Anchors tonight's shift start." },
                  { i: Coffee, t: "Last caffeine 1:00 AM", s: "Your half-life ≈ 6.2h based on history." },
                  { i: Moon, t: "Blackout window 7:15 AM", s: "Plan ends one full cycle before alarm." },
                  { i: Heart, t: "10-min HRV breathing", s: "Readiness was 71 — protect cycle 3." },
                ].map((r, i) => (
                  <li key={i} className="flex items-start gap-3 py-3">
                    <span className="mt-0.5 flex h-7 w-7 items-center justify-center rounded-lg border border-primary/30 bg-secondary/60">
                      <r.i className="h-3.5 w-3.5 text-indigo-glow" />
                    </span>
                    <div>
                      <p className="text-sm font-medium">{r.t}</p>
                      <p className="text-xs text-muted-foreground">{r.s}</p>
                    </div>
                    <Check className="ml-auto mt-1 h-4 w-4 text-indigo-glow/60" />
                  </li>
                ))}
              </ul>
            </div>

            {/* week strip */}
            <div className="lg:col-span-5 rounded-2xl border border-border bg-background/40 p-5">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-indigo-glow">This week</p>
              <div className="mt-3 grid grid-cols-7 gap-1.5">
                {["M","T","W","T","F","S","S"].map((d, i) => {
                  const heights = [40, 70, 55, 80, 60, 25, 30];
                  const active = i === 1;
                  return (
                    <div key={i} className="flex flex-col items-center gap-1.5">
                      <div className="flex h-20 w-full items-end overflow-hidden rounded-md bg-secondary/40">
                        <div
                          className="w-full"
                          style={{
                            height: `${heights[i]}%`,
                            background: active
                              ? "linear-gradient(180deg, var(--indigo-glow), var(--indigo))"
                              : "linear-gradient(180deg, var(--indigo)/.6, var(--secondary))",
                          }}
                        />
                      </div>
                      <span className={`text-[10px] ${active ? "text-indigo-glow font-semibold" : "text-muted-foreground"}`}>{d}</span>
                    </div>
                  );
                })}
              </div>
              <p className="mt-3 text-xs text-muted-foreground">
                Predicted sleep hours · model confidence 0.84
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ============================================================ CALENDAR CONFLICT */

function CalendarConflictSection() {
  return (
    <section className="py-24 lg:py-32">
      <div className="mx-auto w-full max-w-7xl px-5 lg:px-10">
        <div className="grid items-center gap-14 lg:grid-cols-[1.05fr_1fr]">
          <CalendarMock />
          <div>
            <Eyebrow>Calendar awareness</Eyebrow>
            <h2 className="mt-3 text-4xl leading-tight tracking-tight lg:text-5xl">
              Catches the conflict before your week does.
            </h2>
            <p className="mt-5 max-w-lg text-base leading-relaxed text-muted-foreground">
              Drop in shifts from up to three employers, plus personal events
              and commute. RestPilot flags overlap, sleep starvation, and
              recovery-killing combos — and offers a fix.
            </p>
            <ul className="mt-7 space-y-3 text-sm">
              <li className="flex items-start gap-3">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber" />
                <span><b>Conflict on Thu 16:</b> night shift ends 7:00 AM, dentist 8:30 AM. Reschedule or skip-nap?</span>
              </li>
              <li className="flex items-start gap-3">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-indigo-glow" />
                <span><b>Auto-fix:</b> moved dentist to Sat 11 AM and added a 90-min anchor sleep.</span>
              </li>
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}

function CalendarMock() {
  // 5x7 grid month
  const startBlank = 2;
  const total = 31;
  const cells = Array.from({ length: 35 }, (_, i) => {
    const day = i - startBlank + 1;
    return day >= 1 && day <= total ? day : null;
  });
  const shifts: Record<number, "day" | "night" | "off" | "conflict"> = {
    13: "day", 14: "night", 15: "night", 16: "conflict",
    17: "night", 20: "day", 21: "day", 24: "night", 25: "night",
    27: "off", 28: "off",
  };

  return (
    <div className="relative">
      <div className="pointer-events-none absolute -inset-6 rounded-[44px] bg-indigo/15 blur-3xl" />
      <div className="relative overflow-hidden rounded-[28px] border border-border bg-card/80 p-6 shadow-[var(--shadow-card)] backdrop-blur-xl">
        <div className="flex items-center justify-between text-xs">
          <span className="font-semibold uppercase tracking-widest text-indigo-glow">October 2025</span>
          <span className="rounded-full border border-border bg-secondary/60 px-2 py-0.5 text-muted-foreground">3 employers</span>
        </div>

        <div className="mt-4 grid grid-cols-7 gap-1.5 text-[10px] text-muted-foreground">
          {["M","T","W","T","F","S","S"].map((d) => <span key={d} className="text-center">{d}</span>)}
        </div>

        <div className="mt-1 grid grid-cols-7 gap-1.5">
          {cells.map((d, i) => {
            const kind = d ? shifts[d] : undefined;
            const styles =
              kind === "day"      ? "bg-indigo/30 text-foreground border-indigo/50" :
              kind === "night"    ? "bg-indigo-glow/20 text-foreground border-indigo-glow/40" :
              kind === "off"      ? "bg-mint/15 text-foreground border-mint/30" :
              kind === "conflict" ? "bg-amber/25 text-foreground border-amber/60 ring-2 ring-amber/60" :
              "bg-background/40 text-muted-foreground border-border/50";
            return (
              <div
                key={i}
                className={`relative flex aspect-square items-start justify-end rounded-md border p-1.5 text-[11px] ${
                  d ? styles : "border-transparent bg-transparent"
                }`}
              >
                {d}
                {kind === "conflict" && (
                  <span className="absolute left-1 top-1 inline-flex h-4 w-4 items-center justify-center rounded-full bg-amber">
                    <AlertTriangle className="h-2.5 w-2.5 text-amber-foreground" />
                  </span>
                )}
                {kind && kind !== "conflict" && (
                  <span className="absolute bottom-1 left-1 h-1 w-1 rounded-full bg-foreground/60" />
                )}
              </div>
            );
          })}
        </div>

        <div className="mt-4 rounded-xl border border-amber/50 bg-amber/10 p-3 text-xs">
          <p className="font-semibold text-amber">Conflict · Thu Oct 16</p>
          <p className="mt-0.5 text-foreground/80">Night ends 7:00 AM · dentist 8:30 AM · sleep deficit 4.5h</p>
          <div className="mt-2 flex gap-2 text-[10px]">
            <ChipBtn>Move appointment</ChipBtn>
            <ChipBtn>Add anchor nap</ChipBtn>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ============================================================ COMMUTE */

function CommuteSection() {
  return (
    <section className="border-y border-border/60 bg-background/50 py-24 lg:py-32">
      <div className="mx-auto w-full max-w-7xl px-5 lg:px-10">
        <div className="grid items-center gap-14 lg:grid-cols-[1fr_1.05fr]">
          <div>
            <Eyebrow>Commute intelligence</Eyebrow>
            <h2 className="mt-3 text-4xl leading-tight tracking-tight lg:text-5xl">
              Leave at the safest time, not the latest.
            </h2>
            <p className="mt-5 max-w-lg text-base leading-relaxed text-muted-foreground">
              The drive home after a night shift is the most dangerous part of
              your day. RestPilot predicts your alertness curve and tells you
              when to leave, when to caffeinate, and when to pull over.
            </p>
            <ul className="mt-7 space-y-3 text-sm">
              <li className="flex items-start gap-3"><Car className="mt-0.5 h-4 w-4 text-indigo-glow" /><span>Drowsiness windows mapped to your shift end</span></li>
              <li className="flex items-start gap-3"><Coffee className="mt-0.5 h-4 w-4 text-indigo-glow" /><span>Espresso-nap recommendation if alertness ≤ 40%</span></li>
              <li className="flex items-start gap-3"><Bell className="mt-0.5 h-4 w-4 text-indigo-glow" /><span>Leave-now notification at the optimal window</span></li>
            </ul>
          </div>
          <CommuteMock />
        </div>
      </div>
    </section>
  );
}

function CommuteMock() {
  return (
    <div className="relative mx-auto w-full max-w-lg">
      <div className="relative overflow-hidden rounded-[28px] border border-border bg-card/80 p-6 shadow-[var(--shadow-card)] backdrop-blur-xl">
        <div className="flex items-center justify-between text-xs">
          <span className="font-semibold uppercase tracking-widest text-indigo-glow">Drive home</span>
          <span className="text-muted-foreground">Fri · post-night #3</span>
        </div>

        {/* alertness curve */}
        <div className="relative mt-5 h-32 w-full">
          <svg viewBox="0 0 320 120" className="h-full w-full">
            <defs>
              <linearGradient id="al" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor="oklch(0.72 0.16 275)" stopOpacity="0.6" />
                <stop offset="100%" stopColor="oklch(0.72 0.16 275)" stopOpacity="0" />
              </linearGradient>
            </defs>
            <path
              d="M0 30 Q 40 10, 80 30 T 160 70 T 240 90 T 320 60 L 320 120 L 0 120 Z"
              fill="url(#al)"
            />
            <path
              d="M0 30 Q 40 10, 80 30 T 160 70 T 240 90 T 320 60"
              fill="none" stroke="var(--indigo-glow)" strokeWidth="2.5"
            />
            {/* danger band */}
            <rect x="160" y="0" width="80" height="120" fill="var(--amber)" opacity="0.08" />
            <circle cx="200" cy="80" r="6" fill="var(--amber)" />
          </svg>
          <span className="absolute left-[58%] top-3 rounded-md border border-amber/60 bg-amber/15 px-2 py-0.5 text-[10px] text-amber">
            danger zone 6:40–7:20 AM
          </span>
        </div>

        <div className="mt-4 grid grid-cols-3 gap-2 text-center text-[10px]">
          <CommuteChip label="Leave" value="6:25 AM" tone="good" />
          <CommuteChip label="Espresso nap" value="20 min" />
          <CommuteChip label="ETA home" value="7:10 AM" />
        </div>

        <div className="mt-5 rounded-xl border border-primary/30 p-3" style={{ background: "var(--gradient-cta)" }}>
          <p className="text-xs text-primary-foreground">
            <b>Leave now:</b> alertness drops 22% in 35 min. Drive ends before the danger band.
          </p>
        </div>
      </div>
    </div>
  );
}

function CommuteChip({ label, value, tone }: { label: string; value: string; tone?: "good" }) {
  return (
    <div className={`rounded-xl border px-2 py-2 ${tone === "good" ? "border-indigo-glow/50 bg-indigo-glow/10" : "border-border bg-background/40"}`}>
      <p className="text-muted-foreground">{label}</p>
      <p className="mt-0.5 font-semibold text-foreground">{value}</p>
    </div>
  );
}

/* ============================================================ BEFORE / AFTER */

function BeforeAfterSection() {
  return (
    <section className="py-24 lg:py-32">
      <div className="mx-auto w-full max-w-7xl px-5 lg:px-10">
        <div className="text-center">
          <Eyebrow>Before · After</Eyebrow>
          <h2 className="mx-auto mt-3 max-w-2xl text-4xl leading-tight tracking-tight lg:text-5xl">
            One rotation. Two completely different weeks.
          </h2>
        </div>

        <div className="mt-14 grid gap-5 lg:grid-cols-2">
          <SidePanel
            tone="bad"
            label="Without RestPilot"
            stat="4h 50m"
            statLabel="avg sleep"
            rows={[
              "Caffeine at 3 AM, can't fall asleep at 9",
              "Bright phone light kills cycle 2",
              "Random nap pushes Friday into deficit",
              "Drives home in danger zone 3 days in a row",
            ]}
          />
          <SidePanel
            tone="good"
            label="With RestPilot"
            stat="7h 12m"
            statLabel="avg sleep"
            rows={[
              "Last caffeine 1 AM, asleep within 14 min",
              "Blackout + amber lights from wind-down",
              "Anchor naps placed by debt model",
              "Leaves at optimal alertness window each day",
            ]}
          />
        </div>
      </div>
    </section>
  );
}

function SidePanel({
  tone, label, stat, statLabel, rows,
}: {
  tone: "good" | "bad"; label: string; stat: string; statLabel: string; rows: string[];
}) {
  const good = tone === "good";
  return (
    <div
      className={`relative overflow-hidden rounded-[28px] border p-7 ${
        good ? "border-primary/40 bg-card/80" : "border-border/60 bg-card/40"
      }`}
      style={good ? { boxShadow: "var(--shadow-glow)" } : undefined}
    >
      <p className={`text-[10px] font-semibold uppercase tracking-[0.25em] ${good ? "text-indigo-glow" : "text-muted-foreground"}`}>
        {label}
      </p>
      <p className="mt-3 flex items-baseline gap-2">
        <span className="text-6xl" style={{ fontFamily: "var(--font-display)" }}>{stat}</span>
        <span className="text-sm text-muted-foreground">{statLabel}</span>
      </p>
      <ul className="mt-5 space-y-2.5 text-sm">
        {rows.map((r) => (
          <li key={r} className="flex items-start gap-3">
            {good
              ? <Check className="mt-0.5 h-4 w-4 shrink-0 text-indigo-glow" />
              : <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-destructive/70" />}
            <span className={good ? "text-foreground/90" : "text-muted-foreground"}>{r}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ============================================================ RECOVERY PLAYBOOK */

function RecoveryPlaybookSection() {
  const steps = [
    { h: "−24h", t: "Pre-load", b: "Push bedtime 90 min earlier. Light from 6–8 PM. Hydration target hit." },
    { h: "Shift end", t: "Cool-down", b: "Amber glasses on the drive. No screen blue light at home." },
    { h: "+0h", t: "Anchor sleep", b: "4.5h block ending at cycle. Blackout + 65°F room." },
    { h: "+8h", t: "Top-up", b: "90-min nap before commute back. Sunlight on rise." },
    { h: "+24h", t: "Reset", b: "First full night reclaimed. Debt model back below 20." },
  ];
  return (
    <section className="border-y border-border/60 bg-background/40 py-24 lg:py-32">
      <div className="mx-auto w-full max-w-7xl px-5 lg:px-10">
        <div className="text-center">
          <Eyebrow>Recovery playbooks</Eyebrow>
          <h2 className="mx-auto mt-3 max-w-2xl text-4xl leading-tight tracking-tight lg:text-5xl">
            Step-by-step recovery, not vague advice.
          </h2>
        </div>

        <div className="relative mt-14">
          <div className="pointer-events-none absolute left-0 right-0 top-1/2 hidden h-px -translate-y-1/2 bg-gradient-to-r from-transparent via-primary/40 to-transparent lg:block" />
          <div className="relative grid gap-4 lg:grid-cols-5">
            {steps.map((s, i) => (
              <div
                key={i}
                className="relative rounded-2xl border border-border/60 bg-card/70 p-5 backdrop-blur"
              >
                <p className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-secondary/60 px-2.5 py-0.5 text-[10px] font-semibold text-indigo-glow">
                  <Lightbulb className="h-3 w-3" /> {s.h}
                </p>
                <h3 className="mt-3 text-xl" style={{ fontFamily: "var(--font-display)" }}>{s.t}</h3>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{s.b}</p>
                <span className="absolute right-4 top-4 text-[10px] text-muted-foreground/60">0{i + 1}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

/* ============================================================ TESTIMONIALS */

function Testimonials() {
  const quotes = [
    {
      q: "The first sleep tool that doesn't pretend my schedule is normal. The long clock is genuinely new.",
      a: "Maya · ICU RN, Boston",
    },
    {
      q: "Smart alarm in the cockpit hotel actually works. I land sharper than I have in years.",
      a: "Devin · Captain, regional airline",
    },
    {
      q: "The commute alerts after a 24-hour shift made me realize how close I'd been driving to the edge.",
      a: "Priya · Firefighter / paramedic",
    },
  ];
  return (
    <section className="py-24 lg:py-32">
      <div className="mx-auto w-full max-w-7xl px-5 lg:px-10">
        <div className="text-center">
          <Eyebrow>What people say</Eyebrow>
          <h2 className="mx-auto mt-3 max-w-2xl text-4xl leading-tight tracking-tight lg:text-5xl">
            Built with night people, not for them.
          </h2>
        </div>
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

/* ============================================================ PRICING */

function PricingPreview({ ctaHref }: { ctaHref: string }) {
  const tiers = [
    { name: "Monthly",  price: "$7.99",  cadence: "/ month",
      perks: ["7-day free trial", "All AI features", "Wearable sync"], featured: false },
    { name: "Annual",   price: "$49.99", cadence: "/ year",
      perks: ["Save 48% vs monthly", "Priority AI capacity", "Everything in Monthly"], featured: true },
    { name: "Lifetime", price: "$99",    cadence: "one-time",
      perks: ["Pay once, use forever", "All future updates", "Founders' badge"], featured: false },
  ];
  return (
    <section className="py-24 lg:py-32" id="pricing">
      <div className="mx-auto w-full max-w-7xl px-5 lg:px-10">
        <div className="text-center">
          <Eyebrow>Pricing</Eyebrow>
          <h2 className="mx-auto mt-3 max-w-2xl text-4xl leading-tight tracking-tight lg:text-5xl">
            Simple plans. No clinical pricing games.
          </h2>
        </div>
        <div className="mt-14 grid gap-5 lg:grid-cols-3">
          {tiers.map((t) => (
            <div
              key={t.name}
              className={`relative overflow-hidden rounded-3xl border p-8 transition ${
                t.featured ? "border-primary/50 bg-card shadow-[var(--shadow-glow)]" : "border-border/60 bg-card/50"
              }`}
            >
              {t.featured && (
                <span className="absolute right-6 top-6 rounded-full border border-primary/40 bg-primary/20 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-widest text-indigo-glow">
                  Best value
                </span>
              )}
              <p className="text-sm font-semibold text-muted-foreground">{t.name}</p>
              <p className="mt-3 flex items-baseline gap-1">
                <span className="text-5xl" style={{ fontFamily: "var(--font-display)" }}>{t.price}</span>
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
                  t.featured ? "bg-foreground text-background hover:opacity-90" : "border border-border bg-secondary/60 text-foreground hover:bg-secondary"
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

/* ============================================================ CTA */

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

/* ============================================================ DAY IN THE LIFE */

const dayMoments = [
  {
    time: "6:00 AM",
    icon: Bell,
    headline: "Alarm moved 20 min later",
    body: "Your Oura HRV dropped overnight. RestPilot delayed the alarm to end your last REM cycle naturally instead of cutting it short.",
    tag: "Smart alarm · recovery-aware",
  },
  {
    time: "8:15 AM",
    icon: Coffee,
    headline: "Hold caffeine 90 minutes",
    body: "Cortisol is still doing its job. RestPilot recommends water and 10 minutes of east-facing sunlight first — your real energy comes from light, not the cup.",
    tag: "Caffeine timing · personalized",
  },
  {
    time: "2:30 PM",
    icon: Sun,
    headline: "Today's light plan flipped",
    body: "Calendar shows a night shift Thursday. RestPilot shifted today's bright-light window to 6–8 PM and queued a blackout starting at 7 AM tomorrow.",
    tag: "Calendar aware · light shift",
  },
  {
    time: "5:45 PM",
    icon: Car,
    headline: "Leave at 5:42, not 6:10",
    body: "Traffic spiked and your alertness curve dips at 6:30. Leave now and you'll arrive rested with a 12-minute buffer before report-in.",
    tag: "Commute · alertness model",
  },
  {
    time: "9:00 PM",
    icon: Moon,
    headline: "Wind-down moved up 30 min",
    body: "Tomorrow flips you onto a night rotation. RestPilot pulled wind-down to 9:00 PM, dimmed amber prompts, and queued a 4.5h anchor sleep.",
    tag: "Rotation-aware coach",
  },
  {
    time: "Next morning",
    icon: Heart,
    headline: "Recovery up 14 points",
    body: "You woke in light sleep, hit your caffeine window, and shipped the rotation flip without a deficit. Long Clock predicts a green week.",
    tag: "Outcome",
    final: true,
  },
];

function DayInLifeSection() {
  return (
    <section className="relative py-24 lg:py-32">
      <div className="pointer-events-none absolute inset-0 -z-10 opacity-70"
        style={{ background: "var(--gradient-hero)" }} />
      <div className="mx-auto w-full max-w-7xl px-5 lg:px-10">
        <div className="text-center">
          <Eyebrow>A day with RestPilot</Eyebrow>
          <h2 className="mx-auto mt-3 max-w-3xl text-4xl leading-tight tracking-tight lg:text-5xl">
            Six small decisions. One genuinely better day.
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-base leading-relaxed text-muted-foreground">
            This is Tuesday for an ICU nurse on a 2/2/3 rotation. Every moment
            is a real decision the AI makes on her behalf.
          </p>
        </div>

        <div className="relative mx-auto mt-14 max-w-3xl">
          {/* vertical spine */}
          <div className="pointer-events-none absolute left-[22px] top-2 bottom-2 w-px bg-gradient-to-b from-transparent via-primary/40 to-transparent lg:left-1/2 lg:-translate-x-px" />

          <ol className="space-y-5">
            {dayMoments.map((m, i) => {
              const Icon = m.icon;
              const right = i % 2 === 1;
              return (
                <li key={i} className="relative lg:grid lg:grid-cols-2 lg:gap-10">
                  {/* node */}
                  <span className="absolute left-[14px] top-5 z-10 flex h-5 w-5 items-center justify-center rounded-full border border-primary/50 bg-background lg:left-1/2 lg:-translate-x-1/2">
                    <span className="pulse-dot h-2 w-2 rounded-full bg-indigo-glow" />
                  </span>

                  <div className={`pl-12 lg:pl-0 ${right ? "lg:col-start-2 lg:pl-10" : "lg:pr-10 lg:text-right"}`}>
                    <div
                      className={`relative overflow-hidden rounded-2xl border p-5 backdrop-blur-xl ${
                        m.final
                          ? "border-primary/50 bg-card shadow-[var(--shadow-glow)]"
                          : "border-border/60 bg-card/70"
                      }`}
                    >
                      <div className={`flex items-center gap-3 ${right ? "" : "lg:flex-row-reverse"}`}>
                        <span className="flex h-9 w-9 items-center justify-center rounded-xl border border-primary/30 bg-secondary/60">
                          <Icon className="h-4 w-4 text-indigo-glow" />
                        </span>
                        <div className={right ? "" : "lg:text-right"}>
                          <p className="text-[10px] font-semibold uppercase tracking-[0.25em] text-indigo-glow">
                            {m.time}
                          </p>
                          <p className="text-lg font-semibold leading-tight text-foreground">
                            {m.headline}
                          </p>
                        </div>
                      </div>
                      <p className="mt-3 text-sm leading-relaxed text-foreground/85">
                        {m.body}
                      </p>
                      <span className={`mt-3 inline-flex items-center gap-1.5 rounded-full border border-border bg-background/60 px-2.5 py-0.5 text-[10px] text-muted-foreground ${right ? "" : "lg:float-right"}`}>
                        <Sparkles className="h-3 w-3 text-indigo-glow" />
                        {m.tag}
                      </span>
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
        </div>

        <div className="mx-auto mt-14 grid max-w-4xl gap-3 sm:grid-cols-3">
          <Stat label="Sleep recovered" value="+2h 22m" tone="good" />
          <Stat label="Readiness score" value="71 → 85" tone="good" />
          <Stat label="Decisions automated" value="14 today" />
        </div>
      </div>
    </section>
  );
}

/* ============================================================ shared */

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[11px] font-semibold uppercase tracking-[0.25em] text-indigo-glow">
      {children}
    </p>
  );
}

/* ============================================================ MEET AURA */

function CompanionShowcaseSection({ ctaHref }: { ctaHref: string }) {
  const skills: { icon: typeof Moon; title: string; body: string }[] = [
    { icon: Heart, title: "Wind-down after shift", body: "Decompress with paced breathing and a calm voice that knows your night." },
    { icon: Waves, title: "Sleep sounds & mixes", body: "Rain, jet, ocean — start by voice, save your perfect mix." },
    { icon: BellRing, title: "Smart alarm", body: "Wakes you in your lightest cycle inside the window you choose." },
    { icon: MessageCircle, title: "Nightly guidance", body: "Checks in before bed and again at wake — never preachy." },
    { icon: Repeat, title: "Routines & reminders", body: "‘Goodnight’ runs your full wind-down. One word, one tap." },
    { icon: Lock, title: "Private memory", body: "Yours alone. View it, export it, wipe it — anytime." },
  ];
  return (
    <section id="meet-aura" className="relative py-24 lg:py-32">
      <div
        className="pointer-events-none absolute inset-0 -z-10 opacity-70"
        style={{ background: "var(--gradient-hero)" }}
      />
      <div className="pointer-events-none absolute left-1/2 top-1/3 -z-10 h-[500px] w-[700px] -translate-x-1/2 rounded-full bg-indigo/25 blur-[140px]" />

      <div className="mx-auto w-full max-w-7xl px-5 lg:px-10">
        <div className="mx-auto max-w-2xl text-center">
          <Eyebrow>The companion</Eyebrow>
          <h2 className="mt-3 text-4xl leading-tight tracking-tight lg:text-5xl">
            A real AI sleep assistant. <em className="not-italic text-indigo-glow">Always one tap away.</em>
          </h2>
          <p className="mt-5 text-base leading-relaxed text-muted-foreground">
            Aura lives in the corner of every screen. Tap to talk — by voice or text — for sleep, sounds, alarms, recovery, and nightly check-ins built around your real shifts.
          </p>
        </div>

        <div className="mt-14 grid items-stretch gap-5 lg:grid-cols-[1.05fr_1.4fr]">
          {/* Avatar showcase — desktop only to avoid duplicating the hero on mobile */}
          <div
            className="relative hidden flex-col items-center justify-center overflow-hidden rounded-[32px] border border-white/10 p-8 text-center shadow-[var(--shadow-card)] backdrop-blur-xl lg:flex lg:p-12"
            style={{
              background:
                "radial-gradient(120% 90% at 50% 10%, oklch(0.34 0.16 280 / 0.55), transparent 65%), linear-gradient(180deg, oklch(0.16 0.04 270 / 0.85), oklch(0.10 0.03 270 / 0.85))",
            }}
          >
            <div className="pointer-events-none absolute left-1/2 top-1/3 -z-10 h-72 w-72 -translate-x-1/2 rounded-full bg-indigo-glow/30 blur-3xl" />
            <p className="text-[10px] font-semibold uppercase tracking-[0.3em] text-indigo-glow">
              Tap the avatar — anywhere in the app
            </p>
            <div className="my-8">
              <CompanionAvatarFace state="idle" size="lg" aura />
            </div>
            <p
              className="text-2xl leading-tight"
              style={{ fontFamily: "var(--font-display)" }}
            >
              "Goodnight. Want me to start your wind-down?"
            </p>
            <p className="mt-3 max-w-xs text-sm text-muted-foreground">
              Voice or text. Streaming, premium, and tuned to how you actually sleep.
            </p>
            <Link
              to="/companion"
              search={{ intro: 1 }}
              className="mt-6 inline-flex items-center gap-2 rounded-full border border-primary/40 bg-background/60 px-5 py-2.5 text-sm font-semibold text-foreground backdrop-blur-md transition hover:bg-background/80"
            >
              <Mic className="h-4 w-4 text-indigo-glow" />
              Meet your Companion
            </Link>
          </div>

          {/* Capability bento */}
          <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3">
            {skills.map((s) => (
              <div
                key={s.title}
                className="group relative overflow-hidden rounded-[22px] border border-white/10 bg-card/60 p-5 backdrop-blur-xl transition hover:border-primary/40"
              >
                <span className="pointer-events-none absolute -right-6 -top-6 h-24 w-24 rounded-full bg-indigo/15 blur-2xl transition group-hover:bg-indigo/25" />
                <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-primary/30 bg-secondary/60">
                  <s.icon className="h-4 w-4 text-indigo-glow" />
                </span>
                <p className="mt-3 text-sm font-semibold text-foreground">{s.title}</p>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{s.body}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}


