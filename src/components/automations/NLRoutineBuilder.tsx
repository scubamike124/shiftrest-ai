// Phase 7 — Natural language routine builder UI.
// User describes a routine in plain English; we parse it, show a preview,
// and only save after explicit confirmation. Steps with sensitive devices
// or invalid syntax surface as warnings.

import { useMemo, useState } from "react";
import { Sparkles, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { parseNaturalLanguageRoutine } from "@/lib/automations/nl-builder";
import { planAutomation } from "@/lib/automations/engine";
import type { Automation, AutomationStep } from "@/lib/automations/types";

const EXAMPLES = [
  "At 10pm turn on quiet mode and play rain for 45 minutes",
  "Goodnight: play ocean for 30 minutes and say sweet dreams",
  "At 6:30am turn off quiet mode and stop all sounds",
];

export interface NLRoutineBuilderProps {
  onSave: (draft: {
    name: string;
    kind: Automation["kind"];
    trigger: Automation["trigger"];
    steps: AutomationStep[];
  }) => Promise<void> | void;
  busy?: boolean;
}

export function NLRoutineBuilder({ onSave, busy }: NLRoutineBuilderProps) {
  const [text, setText] = useState("");
  const [pending, setPending] = useState<ReturnType<typeof parseNaturalLanguageRoutine> | null>(null);

  const plan = useMemo(() => {
    if (!pending) return null;
    return planAutomation(
      { steps: pending.steps, requireConfirmation: true, name: pending.name },
      [],
    );
  }, [pending]);

  function preview() {
    const t = text.trim();
    if (!t) {
      toast.message("Describe the routine first", {
        description: "Try one of the examples below.",
      });
      return;
    }
    const draft = parseNaturalLanguageRoutine(t);
    if (draft.steps.length === 0) {
      toast.error("I couldn't translate that yet", {
        description: draft.warnings[0] ?? "Try simpler phrasing or use an example.",
      });
      return;
    }
    setPending(draft);
  }

  async function confirmSave() {
    if (!pending) return;
    await onSave({
      name: pending.name,
      kind: pending.kind,
      trigger: pending.trigger,
      steps: pending.steps,
    });
    setPending(null);
    setText("");
  }

  return (
    <Card className="flex flex-col gap-3 p-4" aria-label="Describe a routine">
      <div className="flex items-center gap-2">
        <Wand2 className="h-4 w-4 text-primary" aria-hidden />
        <p className="text-sm font-semibold">Describe a routine in your words</p>
      </div>
      <Textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder='e.g. "At 10pm turn on quiet mode and play rain for 45 minutes"'
        maxLength={400}
        rows={3}
        className="min-h-[88px] text-sm"
        aria-label="Routine description"
      />
      <div className="flex flex-wrap gap-1.5">
        {EXAMPLES.map((ex) => (
          <button
            key={ex}
            type="button"
            onClick={() => setText(ex)}
            className="rounded-full border border-border/60 bg-muted/40 px-2.5 py-1 text-[11px] text-muted-foreground hover:bg-muted"
          >
            {ex}
          </button>
        ))}
      </div>
      <div className="flex justify-end">
        <Button
          type="button"
          onClick={preview}
          disabled={busy || !text.trim()}
          className="min-h-11"
        >
          <Sparkles className="mr-1 h-4 w-4" aria-hidden /> Preview
        </Button>
      </div>

      <Dialog open={pending !== null} onOpenChange={(o) => !o && setPending(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Save "{pending?.name}"?</DialogTitle>
            <DialogDescription>{pending?.rationale}</DialogDescription>
          </DialogHeader>
          <ol className="space-y-1 rounded-md border border-border/60 bg-muted/30 p-3 text-xs">
            {plan?.steps.map((s, i) => (
              <li key={i} className="flex items-start gap-2">
                <span className="text-muted-foreground">{i + 1}.</span>
                <span className={s.blockedReason ? "text-destructive" : ""}>
                  {s.label}
                  {s.blockedReason ? ` — ${s.blockedReason}` : ""}
                </span>
              </li>
            ))}
          </ol>
          {pending && pending.warnings.length > 0 && (
            <ul className="space-y-1 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-[11px] text-amber-700 dark:text-amber-300">
              {pending.warnings.map((w, i) => (
                <li key={i}>• {w}</li>
              ))}
            </ul>
          )}
          <DialogFooter className="gap-2">
            <Button variant="ghost" onClick={() => setPending(null)} className="min-h-11">
              Cancel
            </Button>
            <Button
              onClick={() => void confirmSave()}
              className="min-h-11"
              disabled={busy || !plan || plan.steps.length === 0 || plan.hasBlocked}
            >
              Save routine
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
