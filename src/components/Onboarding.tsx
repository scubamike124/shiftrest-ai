import { useEffect, useState } from "react";
import { Moon, Sparkles, ShieldCheck, ChevronRight, ChevronLeft } from "lucide-react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Checkbox } from "@/components/ui/checkbox";
import { DEFAULT_PREFS, fetchPrefs, markOnboarded, savePrefs } from "@/lib/prefs";
import { recordAcceptanceFn } from "@/lib/legal/consent.functions";
import { toast } from "sonner";
import { DebugHUD } from "@/components/companion/DebugHUD";
import { useSession } from "@/hooks/use-session";

const INTRO_SLIDES = [
  {
    icon: Moon,
    title: "Sleep like the sun never moved.",
    body: "Log your shifts and RestPilot plots wind-down windows and sleep targets shaped by your rotation. Suggestions only — you're always in control.",
  },
  {
    icon: Sparkles,
    title: "Your AI sleep companion.",
    body: "Ask about light, caffeine, blackout setups, or recovery. RestPilot offers tactics built for shift workers — it does not give medical advice.",
  },
];

const ACK_ITEMS = [
  { key: "ai", label: "AI suggestions may be inaccurate, incomplete, or outdated. I will review before acting." },
  { key: "medical", label: "RestPilot AI is not medical advice and does not diagnose or treat any condition." },
  { key: "emergency", label: "RestPilot is not an emergency service. I will call 911 or local emergency services in an emergency." },
  { key: "companion", label: "Companion mode is optional and I can disable it anytime." },
  { key: "safe", label: "I am responsible for safe use, including for driving and other safety-sensitive tasks." },
  { key: "review", label: "I will review AI-generated content before relying on it." },
] as const;

const ONBOARDING_DOCS = ["terms", "privacy", "disclaimers", "safety", "electronic-consent"];

// The step survives a reload (per tab) so a half-finished walk resumes where it
// was left instead of replaying the intro slides.
const STEP_KEY = "restpilot.onboarding.step.v1";
function readStep(): number {
  try {
    const n = Number(sessionStorage.getItem(STEP_KEY));
    return Number.isInteger(n) && n >= 0 && n <= INTRO_SLIDES.length + 1 ? n : 0;
  } catch {
    return 0;
  }
}
function writeStep(n: number) {
  try {
    sessionStorage.setItem(STEP_KEY, String(n));
  } catch {
    /* storage unavailable: resume is a convenience only */
  }
}

export function Onboarding() {
  const queryClient = useQueryClient();
  const { ready: sessionReady, hasSession, hasAccessToken } = useSession();
  const { data: prefs, isSuccess, isFetched } = useQuery({
    queryKey: ["prefs"],
    queryFn: fetchPrefs,
    initialData: DEFAULT_PREFS,
    enabled: sessionReady && hasSession && hasAccessToken,
  });
  const [step, setStepState] = useState(0);
  const setStep = (n: number) => {
    setStepState(n);
    writeStep(n);
  };
  const [dismissed, setDismissed] = useState(false);
  const [acks, setAcks] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  useEffect(() => {
    if (prefs?.preferredName) setNameDraft(prefs.preferredName);
  }, [prefs?.preferredName]);

  const [ready, setReady] = useState(false);
  useEffect(() => {
    setStepState(readStep());
    setReady(true);
  }, []);

  const authOk = sessionReady && hasSession && hasAccessToken;
  // `initialData` makes isSuccess true before any real fetch, which flashed the
  // consent step at already-onboarded users on a slow connection. Wait for a
  // real response (isFetched) before deciding.
  const open = ready && authOk && isSuccess && isFetched && !prefs.onboarded && !dismissed;
  if (!open) return null;

  const NAME_STEP_INDEX = INTRO_SLIDES.length; // after intro slides
  const CONSENT_STEP_INDEX = INTRO_SLIDES.length + 1;
  const totalSteps = INTRO_SLIDES.length + 2; // intro + name + consent
  const isNameStep = step === NAME_STEP_INDEX;
  const isConsentStep = step === CONSENT_STEP_INDEX;
  const trimmedName = nameDraft.trim();
  const nameOk = trimmedName.length > 0;
  const allAcked = ACK_ITEMS.every((i) => acks[i.key]);

  async function finish() {
    if (!allAcked || busy) return;
    if (!sessionReady || !hasSession || !hasAccessToken) {
      toast.info("Please sign in before continuing.");
      return;
    }
    setBusy(true);
    try {
      await recordAcceptanceFn({
        data: {
          documents: ONBOARDING_DOCS,
          source: "onboarding",
          flags: { onboarding_ack: new Date().toISOString() },
        },
      });
      await markOnboarded();
      await queryClient.invalidateQueries({ queryKey: ["prefs"] });
      setDismissed(true);
      writeStep(0);
    } catch (err) {
      console.error("onboarding finish failed", err);
      const msg = err instanceof Error && err.message ? err.message : "Couldn't save. Please try again.";
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  }

  async function advance() {
    if (busy) return;
    if (isNameStep) {
      if (!nameOk) return;
      setBusy(true);
      try {
        await savePrefs({ preferredName: trimmedName });
        await queryClient.invalidateQueries({ queryKey: ["prefs"] });
        setStep(step + 1);
      } catch (err) {
        console.error("save preferred name failed", err);
        toast.error("Couldn't save your name. Please try again.");
      } finally {
        setBusy(false);
      }
      return;
    }
    if (isConsentStep) {
      await finish();
      return;
    }
    setStep(step + 1);
  }

  return (
    <DialogPrimitive.Root open>
    <DialogPrimitive.Portal>
    <DialogPrimitive.Content
      aria-describedby={undefined}
      onEscapeKeyDown={(e) => e.preventDefault()}
      onPointerDownOutside={(e) => e.preventDefault()}
      onInteractOutside={(e) => e.preventDefault()}
      className="fixed inset-0 z-[60] flex flex-col bg-background/95 backdrop-blur-2xl"
    >
      <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
        {!isNameStep && !isConsentStep ? (
          (() => {
            const slide = INTRO_SLIDES[step];
            const Icon = slide.icon;
            return (
              <>
                <span className="flex h-20 w-20 items-center justify-center rounded-full bg-primary/15 text-primary shadow-[var(--shadow-glow)]">
                  <Icon className="h-9 w-9" />
                </span>
                <DialogPrimitive.Title className="mt-8 text-2xl font-bold leading-tight">{slide.title}</DialogPrimitive.Title>
                <p className="mt-4 max-w-sm text-sm text-muted-foreground">{slide.body}</p>
              </>
            );
          })()
        ) : isNameStep ? (
          <div className="w-full max-w-sm text-left">
            <div className="flex items-center gap-2 text-primary">
              <Sparkles className="h-6 w-6" />
              <DialogPrimitive.Title className="text-xl font-semibold">What should I call you?</DialogPrimitive.Title>
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              This is the name RestPilot uses in briefings, voice, and notifications.
              You can change it anytime in Profile.
            </p>
            <input
              type="text"
              autoFocus
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              placeholder="Your first name"
              aria-label="Your first name"
              autoComplete="given-name"
              enterKeyHint="next"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void advance();
                }
              }}
              className="mt-4 h-12 w-full rounded-xl border border-border bg-input px-3 text-base"
              maxLength={60}
            />
          </div>
        ) : (
          <div className="w-full max-w-md text-left">
            <div className="flex items-center gap-2 text-primary">
              <ShieldCheck className="h-6 w-6" />
              <DialogPrimitive.Title className="text-xl font-semibold">Before we start</DialogPrimitive.Title>
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              Please confirm each item. These are required so we can give you accurate, safe guidance.
            </p>
            <ul className="mt-4 space-y-2">
              {ACK_ITEMS.map((it) => (
                <li key={it.key}>
                  <label className="flex cursor-pointer items-start gap-2 rounded-xl border border-border bg-card/40 p-3 text-xs leading-relaxed">
                    <Checkbox
                      checked={!!acks[it.key]}
                      onCheckedChange={(v) =>
                        setAcks((a) => ({ ...a, [it.key]: v === true }))
                      }
                      className="mt-0.5"
                    />
                    <span>{it.label}</span>
                  </label>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-[10px] text-muted-foreground/70">
              See the{" "}
              <Link to="/legal/disclaimers" className="text-primary underline">Disclaimers</Link>,{" "}
              <Link to="/safety" className="text-primary underline">Safety Center</Link>, and{" "}
              <Link to="/legal/privacy" className="text-primary underline">Privacy Policy</Link>.
            </p>
          </div>
        )}
      </div>

      <div className="flex flex-col gap-4 px-6 pb-[calc(env(safe-area-inset-bottom)+1.5rem)]">
        <div className="flex justify-center gap-2">
          {Array.from({ length: totalSteps }).map((_, i) => (
            <span
              key={i}
              className={`h-1.5 rounded-full transition-all ${
                i === step ? "w-6 bg-primary" : "w-1.5 bg-muted"
              }`}
            />
          ))}
        </div>
        {step > 0 && (
          <button
            type="button"
            onClick={() => !busy && setStep(step - 1)}
            disabled={busy}
            className="flex h-10 items-center justify-center gap-1 self-center rounded-xl px-4 text-sm text-muted-foreground disabled:opacity-50"
          >
            <ChevronLeft className="h-4 w-4" />
            Back
          </button>
        )}
        <button
          onClick={advance}
          disabled={busy || (isConsentStep && !allAcked) || (isNameStep && !nameOk)}
          className="flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-primary text-base font-semibold text-primary-foreground shadow-[var(--shadow-glow)] active:scale-[0.99] disabled:opacity-50"
        >
          {isConsentStep
            ? busy ? "Saving…" : "I agree — Get started"
            : isNameStep
              ? busy ? "Saving…" : "Continue"
              : "Next"}
          {!isConsentStep && !isNameStep && <ChevronRight className="h-5 w-5" />}
        </button>
      </div>


      <DebugHUD
        signedIn={sessionReady ? hasSession : null}
        companionOn={false}
        prefsLoaded={isSuccess}
        micState="not-mounted"
        voiceStatus="not-mounted"
        orbState="onboarding"
        greetShown={false}
      />
    </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
