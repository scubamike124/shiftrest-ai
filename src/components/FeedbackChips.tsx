import { useState } from "react";
import { ThumbsUp, ThumbsDown, Check, Moon, Ban, Loader2 } from "lucide-react";
import { submitFeedback, type FeedbackReaction } from "@/lib/ai-feedback";
import { toast } from "sonner";

const CHIPS: { reaction: FeedbackReaction; label: string; icon: typeof ThumbsUp }[] = [
  { reaction: "helpful", label: "Helpful", icon: ThumbsUp },
  { reaction: "already_did", label: "Already did it", icon: Check },
  { reaction: "not_helpful", label: "Not helpful", icon: ThumbsDown },
  { reaction: "ignored_today", label: "Ignore today", icon: Moon },
  { reaction: "dismissed_forever", label: "Don't show again", icon: Ban },
];

/**
 * Compact, mobile-first feedback strip rendered under any AI recommendation.
 * Single-tap → optimistic acknowledgement → persisted via submitFeedback.
 */
export function FeedbackChips({
  recommendationId,
  signedIn,
  onSubmitted,
}: {
  recommendationId: string | null | undefined;
  signedIn: boolean;
  onSubmitted?: (reaction: FeedbackReaction) => void;
}) {
  const [picked, setPicked] = useState<FeedbackReaction | null>(null);
  const [busy, setBusy] = useState(false);

  if (!recommendationId || !signedIn) return null;

  async function send(reaction: FeedbackReaction) {
    if (busy || picked || !recommendationId) return;
    setBusy(true);
    setPicked(reaction);
    try {
      await submitFeedback({ recommendationId, reaction });
      onSubmitted?.(reaction);
    } catch {
      setPicked(null);
      toast.error("Couldn't save feedback");
    } finally {
      setBusy(false);
    }
  }

  if (picked) {
    return (
      <p className="mt-3 text-[11px] text-muted-foreground">
        Thanks — your coach will use this to shape future advice.
      </p>
    );
  }

  return (
    <div className="mt-3 flex flex-wrap items-center gap-1.5">
      <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
        Was this useful?
      </span>
      {CHIPS.map(({ reaction, label, icon: Icon }) => (
        <button
          key={reaction}
          type="button"
          onClick={() => send(reaction)}
          disabled={busy}
          className="inline-flex items-center gap-1 rounded-full border border-border bg-background/60 px-2.5 py-1 text-[11px] font-medium text-muted-foreground transition hover:border-primary/40 hover:text-foreground disabled:opacity-50"
        >
          {busy && picked === reaction ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <Icon className="h-3 w-3" />
          )}
          {label}
        </button>
      ))}
    </div>
  );
}
