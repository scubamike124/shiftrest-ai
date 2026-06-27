import { useState } from "react";
import { Check, Moon, Ban, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useRecommendationActions, type ActionKind } from "@/lib/ai/decisions";

const BUTTONS: { kind: ActionKind; label: string; icon: typeof Check; tone: string }[] = [
  { kind: "accept", label: "Accept", icon: Check, tone: "text-emerald-300 border-emerald-400/40 hover:bg-emerald-400/10" },
  { kind: "snooze", label: "Snooze", icon: Moon, tone: "text-amber-300 border-amber-400/40 hover:bg-amber-400/10" },
  { kind: "ignore", label: "Ignore", icon: Ban, tone: "text-rose-300 border-rose-400/40 hover:bg-rose-400/10" },
];

const VERB: Record<ActionKind, string> = {
  accept: "Accepted — your coach will keep this style of advice.",
  snooze: "Snoozed for today.",
  ignore: "Ignored — your coach will hold this back.",
};

/**
 * Shared Accept / Snooze / Ignore controls. Maps to the existing ai_feedback
 * reactions (helpful / ignored_today / dismissed_forever) — these are already
 * learning signals via the nightly ai-learn job, so no new wiring is needed.
 */
export function RecommendationActions({
  recommendationId,
  signedIn,
  initialReaction,
  size = "md",
  className,
}: {
  recommendationId: string | null | undefined;
  signedIn: boolean;
  initialReaction?: "helpful" | "not_helpful" | "already_did" | "ignored_today" | "dismissed_forever" | null;
  size?: "sm" | "md";
  className?: string;
}) {
  const act = useRecommendationActions();
  const [done, setDone] = useState<ActionKind | null>(() => {
    if (initialReaction === "helpful" || initialReaction === "already_did") return "accept";
    if (initialReaction === "ignored_today") return "snooze";
    if (initialReaction === "dismissed_forever") return "ignore";
    return null;
  });
  const [busy, setBusy] = useState<ActionKind | null>(null);

  if (!recommendationId || !signedIn) return null;

  async function run(kind: ActionKind) {
    if (busy || done || !recommendationId) return;
    setBusy(kind);
    try {
      await act(recommendationId, kind);
      setDone(kind);
      toast.success(VERB[kind]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save.");
    } finally {
      setBusy(null);
    }
  }

  if (done) {
    const b = BUTTONS.find((x) => x.kind === done)!;
    const Icon = b.icon;
    return (
      <p className={cn("inline-flex items-center gap-1.5 text-[11px] font-semibold", b.tone.split(" ")[0], className)}>
        <Icon className="h-3.5 w-3.5" /> {b.label}ed
      </p>
    );
  }

  const pad = size === "sm" ? "px-2.5 py-1 text-[11px]" : "px-3 py-1.5 text-xs";
  return (
    <div className={cn("flex flex-wrap items-center gap-1.5", className)}>
      {BUTTONS.map(({ kind, label, icon: Icon, tone }) => (
        <button
          key={kind}
          type="button"
          onClick={() => run(kind)}
          disabled={!!busy}
          aria-label={label}
          className={cn(
            "inline-flex items-center gap-1 rounded-full border bg-background/40 font-semibold transition disabled:opacity-50",
            pad,
            tone,
          )}
        >
          {busy === kind ? <Loader2 className="h-3 w-3 animate-spin" /> : <Icon className="h-3 w-3" />}
          {label}
        </button>
      ))}
    </div>
  );
}
