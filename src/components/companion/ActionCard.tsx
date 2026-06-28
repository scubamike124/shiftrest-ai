// Slice 8 — Confirmation card the Companion renders inside a chat turn for
// any proposed action. Nothing executes until the user taps Confirm.

import { Check, X, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { describeAction, type CompanionAction } from "@/lib/companion/actions";

export function ActionCard({
  action,
  onConfirm,
  onCancel,
  busy,
  done,
}: {
  action: CompanionAction;
  onConfirm: () => void;
  onCancel: () => void;
  busy?: boolean;
  /** When set, the card collapses into a static read-only state. */
  done?: { ok: boolean; message: string } | null;
}) {
  const d = describeAction(action);

  if (done) {
    return (
      <div
        role="status"
        className="mt-1 rounded-2xl border border-border/60 bg-muted/40 px-3.5 py-2 text-sm"
      >
        <p className="font-medium">{d.title}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">{done.message}</p>
      </div>
    );
  }

  return (
    <div
      role="group"
      aria-label={d.title}
      className="mt-1 rounded-2xl border border-primary/30 bg-primary/5 px-3.5 py-3 text-sm"
    >
      <p className="font-medium leading-tight">{d.title}</p>
      <p className="mt-1 text-xs text-muted-foreground">{d.body}</p>
      {d.unavailable && d.unavailableReason && (
        <p className="mt-2 inline-flex items-center gap-1.5 rounded-md bg-muted/60 px-2 py-1 text-[11px] text-muted-foreground">
          <Info className="h-3 w-3" />
          {d.unavailableReason}
        </p>
      )}
      <div className="mt-3 flex items-center justify-end gap-2">
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={onCancel}
          disabled={busy}
          aria-label="Cancel action"
        >
          <X className="mr-1 h-3.5 w-3.5" />
          Cancel
        </Button>
        <Button
          type="button"
          size="sm"
          onClick={onConfirm}
          disabled={busy || d.unavailable}
          aria-label={d.confirmLabel}
        >
          <Check className="mr-1 h-3.5 w-3.5" />
          {busy ? "Working…" : d.confirmLabel}
        </Button>
      </div>
    </div>
  );
}
