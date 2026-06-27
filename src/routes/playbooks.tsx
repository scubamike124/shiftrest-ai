import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ChevronLeft, Check } from "lucide-react";
import { useState } from "react";
import { PLAYBOOKS } from "@/lib/playbooks";
import { replaceAllShifts } from "@/lib/shifts";
import { AuthRequiredError } from "@/lib/prefs";
import { toast } from "sonner";


export const Route = createFileRoute("/playbooks")({
  head: () => ({
    meta: [
      { title: "Recovery Playbooks — RestPilot AI" },
      {
        name: "description",
        content:
          "Named recovery protocols for the most common shift-work rotations: 4-on-3-off, Pitman, swing, 24/48.",
      },
    ],
  }),
  component: Playbooks,
});

function Playbooks() {
  const [openId, setOpenId] = useState<string | null>(null);
  const navigate = useNavigate();
  const open = PLAYBOOKS.find((p) => p.id === openId);

  async function apply(id: string) {
    const p = PLAYBOOKS.find((x) => x.id === id);
    if (!p) return;
    const shifts = p.generate();
    if (shifts.length === 0) {
      toast.info("This is a guidance-only playbook — no shifts to apply.");
      return;
    }
    try {
      await replaceAllShifts(shifts);
      toast.success(`Applied "${p.name}" to this week`);
      navigate({ to: "/" });
    } catch {
      toast.error("Could not save playbook. Are you signed in?");
    }
  }

  if (open) {
    return (
      <main className="flex flex-col gap-5 px-5 pt-12">
        <button
          onClick={() => setOpenId(null)}
          className="flex items-center gap-1 text-sm text-muted-foreground"
        >
          <ChevronLeft className="h-4 w-4" /> All playbooks
        </button>
        <header>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">
            {open.tagline}
          </p>
          <h1 className="mt-2 text-3xl font-bold leading-tight">{open.name}</h1>
          <p className="mt-3 text-sm text-muted-foreground">{open.description}</p>
        </header>
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold">What to do</h2>
          {open.tips.map((t) => (
            <div
              key={t}
              className="flex gap-3 rounded-2xl border border-border bg-card p-3 text-sm"
            >
              <Check className="mt-0.5 h-4 w-4 shrink-0 text-mint" />
              <span>{t}</span>
            </div>
          ))}
        </section>
        <button
          onClick={() => apply(open.id)}
          className="h-14 w-full rounded-2xl bg-primary text-base font-semibold text-primary-foreground shadow-[var(--shadow-glow)] active:scale-[0.99]"
        >
          Apply to this week
        </button>
      </main>
    );
  }

  return (
    <main className="flex flex-col gap-5 px-5 pt-12">
      <Link to="/plan" className="flex items-center gap-1 text-sm text-muted-foreground">
        <ChevronLeft className="h-4 w-4" /> Back to Plan
      </Link>
      <header>
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">
          Playbooks
        </p>
        <h1 className="mt-2 text-3xl font-bold">Pick your rotation.</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Pre-built recovery protocols. Tap one to read it or apply it to your week.
        </p>
      </header>
      <div className="flex flex-col gap-3">
        {PLAYBOOKS.map((p) => (
          <button
            key={p.id}
            onClick={() => setOpenId(p.id)}
            className="rounded-2xl border border-border bg-card p-4 text-left transition active:scale-[0.99]"
          >
            <p className="text-xs uppercase tracking-widest text-muted-foreground">
              {p.tagline}
            </p>
            <p className="mt-1 text-base font-semibold">{p.name}</p>
            <p className="mt-1 text-xs text-muted-foreground line-clamp-2">
              {p.description}
            </p>
          </button>
        ))}
      </div>
    </main>
  );
}
