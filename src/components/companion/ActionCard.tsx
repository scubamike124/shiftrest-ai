// Slice 9 — Confirmation card the Companion renders inside a chat turn for
// any proposed action. Nothing executes until the user taps Confirm.
// Adds destructive badge, structured-error recovery link, and an aria-live
// status region for executing / completed / failed states.
// Slice 10 — keyboard focus management: when a fresh pending card mounts we
// move focus to the primary confirm button so keyboard / screen-reader users
// land on the actionable control without having to tab through the chat.

import { useEffect, useRef } from "react";
import { Check, X, Info, AlertTriangle, Loader2, CheckCircle2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { describeAction, type ActionResult, type CompanionAction } from "@/lib/companion/actions";

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
  done?: ActionResult | null;
}) {
  const d = describeAction(action);
  const confirmRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (done || busy || d.unavailable) return;
    // Focus on first mount only — avoids stealing focus if the user is typing.
    const id = window.setTimeout(() => confirmRef.current?.focus(), 50);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
    return (
      <div
        role="status"
        aria-live="polite"
        className="mt-1 rounded-2xl border border-border/60 bg-muted/40 px-3.5 py-2 text-sm"
      >
        <div className="flex items-start gap-2">
          <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${ok ? "text-emerald-500" : "text-destructive"}`} aria-hidden />
          <div className="flex-1">
            <p className="font-medium">{d.title}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">{done.message}</p>
            {!ok && done.error?.recovery?.href && (
              <a
                href={done.error.recovery.href}
                className="mt-2 inline-flex h-8 items-center rounded-md border border-border bg-background px-3 text-xs font-medium hover:bg-muted"
              >
                {done.error.recovery.label}
              </a>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      role="group"
      aria-label={d.title}
      className={`mt-1 rounded-2xl border px-3.5 py-3 text-sm ${
        d.destructive ? "border-destructive/40 bg-destructive/5" : "border-primary/30 bg-primary/5"
      }`}
    >
      <div className="flex items-start gap-2">
        {d.destructive && (
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden />
        )}
        <div className="flex-1">
          <p className="font-medium leading-tight">
            {d.title}
            {d.destructive && (
              <span className="ml-2 inline-flex items-center rounded-md bg-destructive/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-destructive">
                Destructive
              </span>
            )}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">{d.body}</p>
          {d.unavailable && d.unavailableReason && (
            <p className="mt-2 inline-flex items-center gap-1.5 rounded-md bg-muted/60 px-2 py-1 text-[11px] text-muted-foreground">
              <Info className="h-3 w-3" />
              {d.unavailableReason}
            </p>
          )}
        </div>
      </div>
      <div className="mt-3 flex items-center justify-end gap-2">
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={onCancel}
          disabled={busy}
          aria-label="Cancel action"
          className="min-h-11"
        >
          <X className="mr-1 h-3.5 w-3.5" />
          Cancel
        </Button>
        <Button
          ref={confirmRef}
          type="button"
          size="sm"
          onClick={onConfirm}
          disabled={busy || d.unavailable}
          aria-label={d.confirmLabel}
          variant={d.destructive ? "destructive" : "default"}
          className="min-h-11"
        >
          {busy ? (
            <>
              <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin motion-reduce:animate-none" />
              Working…
            </>
          ) : (
            <>
              <Check className="mr-1 h-3.5 w-3.5" />
              {d.confirmLabel}
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
