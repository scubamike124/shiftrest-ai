import { Link } from "@tanstack/react-router";
import { CalendarDays, Moon, ShieldCheck } from "lucide-react";

export function AppPreviewAccess() {
  return (
    <section aria-label="App preview access" className="relative mx-auto w-full max-w-5xl px-5 py-16 sm:py-24">
      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">RestPilot · App preview</p>
      <h1 className="mt-4 text-4xl leading-tight sm:text-6xl" style={{ fontFamily: "var(--font-display)" }}>
        Better rest starts with your routine.
      </h1>
      <p className="mt-6 max-w-2xl text-lg text-muted-foreground">
        Purchases are unavailable during the White Glove test. No payment details are needed.
      </p>
      <div className="mt-10 grid gap-4 sm:grid-cols-3">
        {[
          { icon: CalendarDays, title: "Your shift routine", text: "Plan sleep and recovery around the hours you work." },
          { icon: Moon, title: "A calmer wind-down", text: "Explore the app's sleep sounds and planning tools." },
          { icon: ShieldCheck, title: "Private test access", text: "AI and voice features require an enabled test account and connected services." },
        ].map(({icon: Icon, title, text}) => (
          <section key={title} className="rounded-2xl border border-border bg-card p-6">
            <Icon className="h-6 w-6 text-primary" aria-hidden="true" />
            <h2 className="mt-4 font-semibold">{title}</h2>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{text}</p>
          </section>
        ))}
      </div>
      <p className="mt-8 max-w-2xl text-sm text-muted-foreground">
        Some features remain unavailable while the preview is being connected and verified.
        App purchase options will be announced separately when available.
      </p>
      <div className="mt-8 flex flex-wrap gap-3">
        <Link to="/auth" className="inline-flex min-h-12 items-center justify-center rounded-full bg-primary px-6 py-3 font-semibold text-primary-foreground">Sign in to preview</Link>
        <Link to="/" className="inline-flex min-h-12 items-center justify-center rounded-full border border-border px-6 py-3 font-semibold">Back to RestPilot</Link>
      </div>
    </section>
  );
}
