import { useQuery } from "@tanstack/react-query";
import { Lightbulb, RefreshCw } from "lucide-react";
import { aiCoachTip } from "@/lib/ai-client";

/**
 * Lightweight, contextual coach tip card.
 * - Fetches once per mount; user can refresh on demand.
 * - Hidden entirely for guests (AI calls require auth + budget).
 */
export function CoachTipCard({ signedIn }: { signedIn: boolean }) {
  const { data, isFetching, refetch, error } = useQuery({
    queryKey: ["ai-coach-tip"],
    queryFn: () => aiCoachTip(),
    enabled: signedIn,
    staleTime: 60 * 60_000,
    retry: 0,
  });

  if (!signedIn) return null;

  return (
    <section className="rounded-2xl border border-border bg-card p-4">
      <header className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-amber/15 text-amber">
            <Lightbulb className="h-4 w-4" />
          </span>
          <h3 className="text-sm font-semibold">Coach tip</h3>
        </div>
        <button
          onClick={() => refetch()}
          disabled={isFetching}
          className="rounded-lg p-1.5 text-muted-foreground hover:bg-secondary disabled:opacity-50"
          aria-label="Refresh tip"
        >
          <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
        </button>
      </header>
      <p className="mt-3 text-sm leading-relaxed">
        {error
          ? "Couldn't load a fresh tip — try again in a moment."
          : isFetching && !data
          ? "Thinking…"
          : data?.tip ?? "Tap refresh for a contextual tip."}
      </p>
    </section>
  );
}
