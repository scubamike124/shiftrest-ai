import { Activity, Sparkles, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTodayActivity, type ActivityEvent } from "@/lib/ai/decisions";

function timeShort(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  } catch { return ""; }
}

/**
 * Vertical timeline of every AI action today — recommendations + system
 * events (sync, recalc) — so the user can see the AI is continuously
 * working in the background.
 */
export function AIActivityFeed({
  max,
  showHeader = true,
  className,
}: {
  max?: number;
  showHeader?: boolean;
  className?: string;
}) {
  const { data, isLoading } = useTodayActivity();
  const events = (data ?? []).slice(0, max ?? 50);

  return (
    <section
      className={cn(
        "rounded-[24px] border border-border bg-card/70 p-5 backdrop-blur",
        className,
      )}
    >
      {showHeader && (
        <header className="mb-4 flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-indigo-glow/15 text-indigo-glow">
            <Activity className="h-3.5 w-3.5" />
          </span>
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.25em] text-indigo-glow">
              AI Activity
            </p>
            <p className="text-xs text-muted-foreground">What the AI did today</p>
          </div>
        </header>
      )}

      {isLoading && events.length === 0 && (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-10 animate-pulse rounded-xl bg-secondary/60" />
          ))}
        </div>
      )}

      {!isLoading && events.length === 0 && (
        <p className="text-sm text-muted-foreground">
          Nothing yet today — the AI starts working when you log a shift or sync a wearable.
        </p>
      )}

      <ol className="relative space-y-3">
        {events.map((e) => (
          <Row key={e.id} e={e} />
        ))}
      </ol>
    </section>
  );
}

function Row({ e }: { e: ActivityEvent }) {
  const Icon = e.kind === "decision" ? Sparkles : Zap;
  const tone =
    e.kind === "decision" ? "text-indigo-glow bg-indigo-glow/15" : "text-amber-300 bg-amber-400/10";
  return (
    <li className="flex items-start gap-3">
      <span className="mt-0.5 inline-flex w-14 shrink-0 justify-end text-[10px] font-semibold uppercase tracking-widest text-muted-foreground tabular-nums">
        {timeShort(e.at)}
      </span>
      <span className={cn("mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full", tone)}>
        <Icon className="h-3 w-3" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="block text-sm font-medium text-foreground">{e.label}</span>
          {e.count && e.count > 1 && (
            <span className="rounded-full bg-secondary px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground tabular-nums">
              ×{e.count}
            </span>
          )}
        </span>
        {e.sublabel && (
          <span className="mt-0.5 block truncate text-xs text-muted-foreground">{e.sublabel}</span>
        )}
      </span>
    </li>
  );
}
