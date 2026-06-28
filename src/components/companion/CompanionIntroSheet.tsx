// Slice 11 — First-launch Companion introduction sheet.
// Triggers once per device when the user lands on /dashboard. Non-blocking,
// dismissible, and never re-shown once acknowledged.

import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Sparkles, ShieldCheck, Mic2 } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { HowMemoryWorks } from "@/components/memory/HowMemoryWorks";
import { hasSeenCompanionIntro, markCompanionIntroSeen } from "@/lib/companion/intro-flag";
import { track } from "@/lib/companion/analytics";
import { cn } from "@/lib/utils";

const STEPS = [
  {
    icon: Sparkles,
    title: "Meet your Companion",
    body:
      "A calm assistant for sleep, sounds, alarms, and daily briefs. Tap the orb on your dashboard anytime to chat.",
  },
  {
    icon: ShieldCheck,
    title: "Memory is optional",
    body:
      "Your Companion never remembers anything unless you turn memory on. You can review, edit, delete, or export it whenever you like.",
  },
  {
    icon: Mic2,
    title: "Voice & actions stay in your control",
    body:
      "Voice replies are off by default. Any action — like changing alarms or sounds — asks before it runs when confirmation is enabled.",
  },
] as const;

export function CompanionIntroSheet() {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);

  // Open once per device after mount (after onboarding has cleared the route).
  useEffect(() => {
    if (hasSeenCompanionIntro()) return;
    const id = window.setTimeout(() => setOpen(true), 600);
    return () => window.clearTimeout(id);
  }, []);

  useEffect(() => {
    if (!open) return;
    track({ event: "intro_viewed", step });
    if (step === 1) track({ event: "memory_explainer_viewed", surface: "intro-sheet" });
  }, [open, step]);

  const finish = (skipped: boolean) => {
    markCompanionIntroSeen();
    track({ event: "intro_completed", skipped });
    setOpen(false);
  };

  const handleOpenChange = (next: boolean) => {
    if (!next && open) {
      // Treat any close (X / overlay / ESC) as skip.
      finish(true);
    } else {
      setOpen(next);
    }
  };

  const isLast = step === STEPS.length - 1;
  const StepIcon = STEPS[step].icon;

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent
        side="bottom"
        className="mx-auto max-w-lg rounded-t-3xl border-border bg-card sm:rounded-3xl"
      >
        <SheetHeader className="text-left">
          <div className="mb-3 grid h-12 w-12 place-items-center rounded-2xl bg-primary/15">
            <StepIcon className="h-6 w-6 text-primary" aria-hidden />
          </div>
          <SheetTitle className="text-xl">{STEPS[step].title}</SheetTitle>
          <SheetDescription className="text-sm leading-relaxed text-muted-foreground">
            {STEPS[step].body}
          </SheetDescription>
        </SheetHeader>

        {step === 1 && (
          <div className="mt-2">
            <HowMemoryWorks />
            <p className="mt-3 text-xs text-muted-foreground">
              You can manage memory anytime at{" "}
              <Link to="/memory" className="underline" onClick={() => track({ event: "memory_explainer_viewed", surface: "memory-page" })}>
                My Memory
              </Link>
              .
            </p>
          </div>
        )}

        {step === 2 && (
          <p className="mt-3 text-xs text-muted-foreground">
            Adjust voice, quiet hours, and confirmation in{" "}
            <Link
              to="/settings/companion"
              className="underline"
              onClick={() => track({ event: "companion_settings_opened", from: "intro" })}
            >
              Companion settings
            </Link>
            .
          </p>
        )}

        {/* Step dots */}
        <div className="mt-6 flex items-center justify-center gap-1.5" aria-hidden>
          {STEPS.map((_, i) => (
            <span
              key={i}
              className={cn(
                "h-1.5 w-1.5 rounded-full transition-colors",
                i === step ? "bg-primary" : "bg-muted",
              )}
            />
          ))}
        </div>

        <div className="mt-5 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => finish(true)}
            className="min-h-11 rounded-full px-4 text-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            Skip
          </button>
          <div className="flex items-center gap-2">
            {step > 0 && (
              <button
                type="button"
                onClick={() => setStep((s) => Math.max(0, s - 1))}
                className="min-h-11 rounded-full px-4 text-sm text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                Back
              </button>
            )}
            <button
              type="button"
              autoFocus
              onClick={() => (isLast ? finish(false) : setStep((s) => s + 1))}
              className="min-h-11 rounded-full bg-primary px-5 text-sm font-medium text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              {isLast ? "Got it" : "Next"}
            </button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
