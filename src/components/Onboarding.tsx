import { useEffect, useState } from "react";
import { Moon, Sparkles, ShieldCheck, ChevronRight } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { DISCLAIMER } from "@/lib/shifts";
import { DEFAULT_PREFS, fetchPrefs, markOnboarded } from "@/lib/prefs";

const SLIDES = [
  {
    icon: Moon,
    title: "Sleep like the sun never moved.",
    body: "Log your shifts and RestPilot plots automatic wind-down and 8-hour sleep windows tailored to your rotation.",
  },
  {
    icon: Sparkles,
    title: "Your AI Sleep Coach.",
    body: "Ask anything about light, caffeine, blackout setups, or recovery — get concrete tactics built for shift workers.",
  },
  {
    icon: ShieldCheck,
    title: "A quick note.",
    body: DISCLAIMER,
  },
];

export function Onboarding() {
  const queryClient = useQueryClient();
  const { data: prefs, isSuccess } = useQuery({
    queryKey: ["prefs"],
    queryFn: fetchPrefs,
    initialData: DEFAULT_PREFS,
  });
  const [step, setStep] = useState(0);
  const [dismissed, setDismissed] = useState(false);

  // Avoid SSR/hydration mismatch — only render after first client effect.
  const [ready, setReady] = useState(false);
  useEffect(() => {
    setReady(true);
  }, []);

  const open = ready && isSuccess && !prefs.onboarded && !dismissed;
  if (!open) return null;

  const slide = SLIDES[step];
  const Icon = slide.icon;
  const isLast = step === SLIDES.length - 1;

  async function finish() {
    setDismissed(true);
    await markOnboarded();
    queryClient.invalidateQueries({ queryKey: ["prefs"] });
  }

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-background/95 backdrop-blur-2xl">
      <div className="flex flex-1 flex-col items-center justify-center px-8 text-center">
        <span className="flex h-20 w-20 items-center justify-center rounded-full bg-primary/15 text-primary shadow-[var(--shadow-glow)]">
          <Icon className="h-9 w-9" />
        </span>
        <h2 className="mt-8 text-2xl font-bold leading-tight">{slide.title}</h2>
        <p
          className={`mt-4 max-w-sm ${
            isLast ? "text-[11px] leading-relaxed text-muted-foreground/80" : "text-sm text-muted-foreground"
          }`}
        >
          {slide.body}
        </p>
      </div>

      <div className="flex flex-col gap-4 px-6 pb-[calc(env(safe-area-inset-bottom)+1.5rem)]">
        <div className="flex justify-center gap-2">
          {SLIDES.map((_, i) => (
            <span
              key={i}
              className={`h-1.5 rounded-full transition-all ${
                i === step ? "w-6 bg-primary" : "w-1.5 bg-muted"
              }`}
            />
          ))}
        </div>
        <button
          onClick={() => (isLast ? finish() : setStep(step + 1))}
          className="flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-primary text-base font-semibold text-primary-foreground shadow-[var(--shadow-glow)] active:scale-[0.99]"
        >
          {isLast ? "I understand — Get started" : "Next"}
          {!isLast && <ChevronRight className="h-5 w-5" />}
        </button>
        {!isLast && (
          <button
            onClick={finish}
            className="text-xs font-medium text-muted-foreground"
          >
            Skip intro
          </button>
        )}
      </div>
    </div>
  );
}
