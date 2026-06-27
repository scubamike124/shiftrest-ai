import { ArrowRight, History } from "lucide-react";
import { cn } from "@/lib/utils";
import type { TrustChange } from "@/lib/trust";

export function WhatChanged({
  changes,
  previousHeadline,
  currentHeadline,
  className,
}: {
  changes?: TrustChange[];
  previousHeadline?: string | null;
  currentHeadline?: string | null;
  className?: string;
}) {
  const hasChanges = changes && changes.length > 0;
  const headlineChanged =
    previousHeadline && currentHeadline && previousHeadline.trim() !== currentHeadline.trim();

  if (!hasChanges && !headlineChanged) return null;

  return (
    <div
      className={cn(
        "rounded-2xl border border-indigo-glow/20 bg-indigo-glow/5 p-3",
        className,
      )}
    >
      <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-indigo-glow">
        <History className="h-3 w-3" aria-hidden />
        What changed since last time
      </div>

      {headlineChanged && (
        <p className="mt-1.5 text-xs leading-snug text-muted-foreground">
          <span className="line-through opacity-70">{previousHeadline}</span>
          <ArrowRight className="mx-1 inline h-3 w-3 align-middle text-indigo-glow" />
          <span className="text-foreground">{currentHeadline}</span>
        </p>
      )}

      {hasChanges && (
        <ul className="mt-2 space-y-1.5">
          {changes!.map((c, i) => (
            <li key={i} className="text-xs leading-snug">
              <span className="font-semibold text-foreground">{c.label}: </span>
              <span className="text-muted-foreground line-through">{c.from}</span>
              <ArrowRight className="mx-1 inline h-3 w-3 align-middle text-indigo-glow" />
              <span className="font-medium text-foreground">{c.to}</span>
              {c.reason && (
                <span className="ml-1 text-muted-foreground"> — {c.reason}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
