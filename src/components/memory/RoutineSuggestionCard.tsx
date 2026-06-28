import { Button } from "@/components/ui/button";
import { Sparkles, Check, X, Clock } from "lucide-react";
import type { RoutineSuggestion, RoutineStep } from "@/lib/memory/suggestions";

function describeStep(step: RoutineStep): string {
  switch (step.type) {
    case "quiet_mode_on":
      return "Turn on Quiet Mode";
    case "quiet_mode_off":
      return "Turn off Quiet Mode";
    case "play_sound":
      return `Play ${step.track.replace(/_/g, " ")}`;
    case "stop_sound":
      return "Stop sound";
    case "set_alarm":
      return `Set alarm for ${step.time}`;
    case "set_timer":
      return `${step.minutes}-minute sleep timer`;
    case "start_sleep_mode":
      return "Start Sleep Mode";
    case "departure_reminder":
      return `Remind ${step.minutes_before} min before you need to leave`;
    case "note":
      return step.text;
    default:
      return "";
  }
}

type Props = {
  suggestion: RoutineSuggestion;
  busy?: boolean;
  onAccept: () => void;
  onDismiss: () => void;
  onSnooze: () => void;
};

export function RoutineSuggestionCard({ suggestion, busy, onAccept, onDismiss, onSnooze }: Props) {
  return (
    <article className="rounded-2xl border border-primary/30 bg-primary/[0.04] p-4">
      <header className="flex items-start gap-2">
        <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
        <div className="min-w-0">
          <h3 className="text-sm font-semibold leading-snug">{suggestion.title}</h3>
          <p className="mt-1 text-xs text-muted-foreground">{suggestion.reason}</p>
        </div>
      </header>

      {suggestion.proposedSteps.length > 0 && (
        <ul className="mt-3 space-y-1 rounded-xl bg-background/60 p-3 text-xs">
          {suggestion.proposedSteps.map((s, i) => (
            <li key={i} className="flex items-center gap-2">
              <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-primary/15 text-[10px] font-semibold text-primary">
                {i + 1}
              </span>
              <span>{describeStep(s)}</span>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        <Button size="sm" disabled={busy} onClick={onAccept} className="gap-1.5">
          <Check className="h-3.5 w-3.5" /> Save as routine
        </Button>
        <Button size="sm" variant="outline" disabled={busy} onClick={onSnooze} className="gap-1.5">
          <Clock className="h-3.5 w-3.5" /> Ask later
        </Button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={onDismiss} className="gap-1.5 text-muted-foreground">
          <X className="h-3.5 w-3.5" /> Not for me
        </Button>
      </div>
    </article>
  );
}
