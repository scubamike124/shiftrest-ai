import { useState } from "react";
import { ChevronDown, ShieldCheck } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { cn } from "@/lib/utils";

export function HowMemoryWorks() {
  const [open, setOpen] = useState(false);
  return (
    <section className="mt-4 overflow-hidden rounded-2xl border border-border bg-card">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
        aria-expanded={open}
      >
        <span className="flex items-center gap-2 text-sm font-semibold">
          <ShieldCheck className="h-4 w-4 text-primary" />
          How AI Memory Works
        </span>
        <ChevronDown
          className={cn("h-4 w-4 text-muted-foreground transition-transform", open && "rotate-180")}
        />
      </button>
      {open && (
        <div className="space-y-3 border-t border-border/60 px-4 py-4 text-sm leading-relaxed text-muted-foreground">
          <p>
            <span className="font-medium text-foreground">Memory is optional.</span> It is OFF by
            default. Nothing is remembered until you turn it on.
          </p>
          <p>
            <span className="font-medium text-foreground">The AI only learns with permission.</span>{" "}
            When it notices a pattern (like a regular bedtime or a sound you keep choosing) it asks
            first. Nothing is saved until you say yes.
          </p>
          <p>
            <span className="font-medium text-foreground">You stay in control.</span> Pause learning
            anytime, edit or delete individual memories, wipe everything, or export your memories as
            JSON.
          </p>
          <p>
            <span className="font-medium text-foreground">Privacy-first.</span> Memories live only
            in your account and are never shared with other users. Read the{" "}
            <Link to="/legal/privacy" className="underline">
              privacy policy
            </Link>{" "}
            for details.
          </p>
        </div>
      )}
    </section>
  );
}
