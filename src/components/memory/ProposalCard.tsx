import { Sparkles, Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { MemoryProposal } from "@/lib/memory-proposals";

const CATEGORY_LABELS: Record<string, string> = {
  sleep_habits: "Sleep Habit",
  alarm_prefs: "Alarm Preference",
  favorite_sounds: "Favorite Sound",
  daily_routine: "Daily Routine",
  companion_prefs: "Companion Preference",
};

export function ProposalCard({
  proposal,
  onAccept,
  onDecline,
  busy,
}: {
  proposal: MemoryProposal;
  onAccept: () => void;
  onDecline: () => void;
  busy?: boolean;
}) {
  const label = CATEGORY_LABELS[proposal.category] ?? "Suggestion";
  const confPct = Math.round(proposal.confidence * 100);
  return (
    <article className="rounded-2xl border border-primary/30 bg-primary/5 p-4">
      <header className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-primary">
        <Sparkles className="h-3.5 w-3.5" /> {label}
      </header>
      <p className="mt-2 text-sm font-medium leading-snug text-foreground">
        "{proposal.content}"
      </p>
      <p className="mt-1 text-xs text-muted-foreground">
        Seen {proposal.observedCount}× recently · {confPct}% confidence
      </p>
      <p className="mt-2 text-xs text-muted-foreground">
        Would you like me to remember this? You can change it anytime.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button size="sm" onClick={onAccept} disabled={busy} className="gap-1.5">
          <Check className="h-3.5 w-3.5" /> Yes, remember
        </Button>
        <Button size="sm" variant="ghost" onClick={onDecline} disabled={busy} className="gap-1.5">
          <X className="h-3.5 w-3.5" /> Not now
        </Button>
      </div>
    </article>
  );
}
