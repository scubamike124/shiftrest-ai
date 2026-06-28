// Slice 9 — Action history sheet for the Companion.
// Shows the last actions the user has run, with status and a Retry button for
// failures whose error kind is retryable. Per-device (localStorage), no schema.

import { useEffect, useState } from "react";
import { History, RotateCcw, Trash2, CheckCircle2, XCircle, Loader2, CircleSlash } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import {
  clearHistory,
  isRetryable,
  listHistory,
  subscribeHistory,
  type ActionHistoryEntry,
} from "@/lib/companion/action-history";
import type { CompanionAction } from "@/lib/companion/actions";

function statusIcon(s: ActionHistoryEntry["status"]) {
  switch (s) {
    case "completed":
      return <CheckCircle2 className="h-4 w-4 text-emerald-500" aria-label="Completed" />;
    case "failed":
      return <XCircle className="h-4 w-4 text-destructive" aria-label="Failed" />;
    case "cancelled":
      return <CircleSlash className="h-4 w-4 text-muted-foreground" aria-label="Cancelled" />;
    case "executing":
    case "queued":
      return <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none text-primary" aria-label={s} />;
  }
}

function timeAgo(ms: number) {
  const diff = Date.now() - ms;
  const s = Math.round(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return `${d}d ago`;
}

export function ActionHistorySheet({
  onRetry,
}: {
  onRetry: (action: CompanionAction) => void;
}) {
  const [entries, setEntries] = useState<ActionHistoryEntry[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setEntries(listHistory());
    return subscribeHistory(() => setEntries(listHistory()));
  }, []);

  const failureCount = entries.filter((e) => e.status === "failed" && isRetryable(e.errorKind)).length;

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="relative h-9 gap-1.5 px-2 text-xs"
          aria-label="Action history"
        >
          <History className="h-4 w-4" />
          <span className="hidden sm:inline">History</span>
          {failureCount > 0 && (
            <span className="ml-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold text-destructive-foreground">
              {failureCount}
            </span>
          )}
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="w-full max-w-md overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Action history</SheetTitle>
          <SheetDescription>
            The last {entries.length || "0"} actions your Companion has run on this device.
          </SheetDescription>
        </SheetHeader>
        <div className="mt-4 space-y-2">
          {entries.length === 0 && (
            <p className="rounded-xl border border-dashed border-border/60 bg-muted/30 p-6 text-center text-xs text-muted-foreground">
              No actions yet. Anything your Companion confirms with you will appear here.
            </p>
          )}
          {entries.map((e) => {
            const canRetry = e.status === "failed" && isRetryable(e.errorKind);
            return (
              <div
                key={e.id}
                className="rounded-xl border border-border/50 bg-background/60 p-3"
              >
                <div className="flex items-start gap-2">
                  <div className="mt-0.5">{statusIcon(e.status)}</div>
                  <div className="flex-1 min-w-0">
                    <p className="truncate text-sm font-medium">{e.label}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {e.message} · {timeAgo(e.at)}
                    </p>
                  </div>
                  {canRetry && (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-8 gap-1 px-2 text-xs"
                      onClick={() => {
                        setOpen(false);
                        onRetry(e.snapshot);
                      }}
                    >
                      <RotateCcw className="h-3 w-3" />
                      Retry
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        {entries.length > 0 && (
          <div className="mt-4 flex justify-end">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-xs text-muted-foreground"
              onClick={() => clearHistory()}
            >
              <Trash2 className="mr-1 h-3 w-3" />
              Clear history
            </Button>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
