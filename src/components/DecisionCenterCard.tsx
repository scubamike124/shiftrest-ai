import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { Sparkles, ArrowRight, ChevronRight } from "lucide-react";
import { useTodayDecisions, intentLabel, type Decision } from "@/lib/ai/decisions";
import { ConfidenceBadge, RecommendationDetailSheet } from "./ai/trust";

function timeShort(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  } catch {
    return "";
  }
}

/**
 * Dashboard surface for the AI Decision Center.
 * Tap a row → opens the full Trust sheet inline. Tap the header → /decisions.
 */
export function DecisionCenterCard({ signedIn }: { signedIn: boolean }) {
  const { data, isLoading } = useTodayDecisions();
  const [active, setActive] = useState<Decision | null>(null);

  if (!signedIn) return null;

  const rows = (data ?? []).slice(0, 3);
  const total = data?.length ?? 0;

  return (
    <section className="rounded-[24px] border border-indigo-glow/25 bg-card/80 p-5 backdrop-blur">
      <header className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.25em] text-indigo-glow">
            <Sparkles className="h-3 w-3" /> AI Decisions Today
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {isLoading
              ? "Pulling today's decisions…"
              : total === 0
              ? "No decisions yet today — the AI will start adjusting as data comes in."
              : `${total} decision${total === 1 ? "" : "s"} made for you today.`}
          </p>
        </div>
        <Link
          to="/decisions"
          className="inline-flex shrink-0 items-center gap-1 rounded-full border border-indigo-glow/30 px-3 py-1.5 text-[11px] font-semibold text-indigo-glow hover:bg-indigo-glow/10"
        >
          View all <ArrowRight className="h-3 w-3" />
        </Link>
      </header>

      {rows.length > 0 && (
        <ul className="mt-4 space-y-2">
          {rows.map((d) => (
            <li key={d.id}>
              <button
                type="button"
                onClick={() => setActive(d)}
                className="group flex w-full items-start gap-3 rounded-2xl border border-border/60 bg-background/40 p-3 text-left transition hover:border-indigo-glow/40 hover:bg-background/60"
              >
                <span className="mt-0.5 inline-flex h-7 shrink-0 items-center justify-center rounded-full bg-indigo-glow/15 px-2 text-[10px] font-bold uppercase tracking-widest text-indigo-glow">
                  {timeShort(d.createdAt)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                    {intentLabel(d.intent)}
                  </span>
                  <span className="mt-0.5 block truncate text-sm font-medium text-foreground">
                    {d.headline}
                  </span>
                </span>
                {d.confidence != null && (
                  <ConfidenceBadge value={d.confidence} className="self-center" />
                )}
                <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-muted-foreground group-hover:text-foreground" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <RecommendationDetailSheet
        open={active != null}
        onOpenChange={(v) => !v && setActive(null)}
        recommendationId={active?.id ?? null}
        intent={active?.intent}
        headline={active?.headline}
        why={active?.rationale ?? null}
        confidence={active?.confidence ?? null}
      />
    </section>
  );
}
