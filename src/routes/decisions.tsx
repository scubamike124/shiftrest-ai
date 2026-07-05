import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { requireSession } from "@/lib/require-session";
import { ArrowLeft, Sparkles, ChevronRight } from "lucide-react";
import { useTodayDecisions, intentLabel, type Decision } from "@/lib/ai/decisions";
import {
  ConfidenceBadge,
  RecommendationActions,
  RecommendationDetailSheet,
} from "@/components/ai/trust";
import { AIActivityFeed } from "@/components/AIActivityFeed";

export const Route = createFileRoute("/decisions")({
  ssr: false,
  beforeLoad: requireSession,
  head: () => ({
    meta: [
      { title: "AI Decisions Today — RestPilot AI" },
      {
        name: "description",
        content:
          "See every decision RestPilot's AI made for you today — why, with what confidence, and what changed.",
      },
    ],
  }),
  component: DecisionsPage,
});

function relTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  } catch {
    return "";
  }
}

function DecisionsPage() {
  const { data, isLoading, isError, refetch } = useTodayDecisions();
  const [active, setActive] = useState<Decision | null>(null);

  const decisions = data ?? [];

  return (
    <main className="mx-auto flex w-full min-w-0 max-w-6xl flex-col px-5 pt-8 pb-28 [padding-left:max(1.25rem,env(safe-area-inset-left))] [padding-right:max(1.25rem,env(safe-area-inset-right))] lg:px-10 lg:pt-12 lg:pb-12">
      <header className="mb-6 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Link
            to="/dashboard"
            className="inline-flex items-center gap-1 text-xs font-semibold text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Dashboard
          </Link>
          <p className="mt-3 inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.25em] text-indigo-glow">
            <Sparkles className="h-3 w-3" /> AI Decision Center
          </p>
          <h1
            className="mt-1 text-[28px] leading-tight sm:text-[34px] lg:text-[44px]"
            style={{ fontFamily: "var(--font-display)" }}
          >
            What I decided today
          </h1>
          <p className="mt-2 max-w-xl text-sm text-muted-foreground lg:text-base">
            Every nudge, alarm tweak, light plan, and recovery adjustment your coach made — with
            evidence, confidence, and what changed since last time.
          </p>
        </div>
      </header>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <section className="min-w-0">
          {isLoading && (
            <div className="space-y-3">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="h-24 animate-pulse rounded-2xl bg-secondary/60" />
              ))}
            </div>
          )}

          {isError && (
            <div className="rounded-2xl border border-border bg-card/70 p-5 text-sm text-muted-foreground">
              <p>Could not load today's decisions.</p>
              <button
                onClick={() => void refetch()}
                className="mt-2 text-sm font-semibold text-primary"
              >
                Try again
              </button>
            </div>
          )}

          {!isLoading && !isError && decisions.length === 0 && (
            <div className="rounded-2xl border border-border bg-card/70 p-6 text-sm text-muted-foreground">
              <p>No decisions yet today.</p>
              <p className="mt-1">
                Log a shift, sync a wearable, or open the dashboard for a minute — the AI starts
                adjusting your plan as data arrives.
              </p>
            </div>
          )}

          <ul className="space-y-3">
            {decisions.map((d) => (
              <li
                key={d.id}
                className="rounded-2xl border border-border bg-card/80 p-4 backdrop-blur"
              >
                <div className="flex flex-wrap items-start gap-2">
                  <span className="inline-flex h-6 items-center justify-center rounded-full bg-indigo-glow/15 px-2 text-[10px] font-bold uppercase tracking-widest text-indigo-glow">
                    {relTime(d.createdAt)}
                  </span>
                  <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                    {intentLabel(d.intent)}
                  </span>
                  {d.confidence != null && (
                    <ConfidenceBadge value={d.confidence} className="ml-auto" />
                  )}
                </div>
                <h3 className="mt-2 text-base font-semibold leading-snug">{d.headline}</h3>
                {d.rationale && (
                  <p className="mt-1 text-sm text-muted-foreground">{d.rationale}</p>
                )}

                <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                  <RecommendationActions
                    recommendationId={d.id}
                    signedIn
                    initialReaction={d.reaction}
                    size="sm"
                  />
                  <button
                    type="button"
                    onClick={() => setActive(d)}
                    className="inline-flex items-center gap-1 rounded-full border border-border bg-background/40 px-3 py-1 text-[11px] font-semibold text-muted-foreground hover:border-indigo-glow/40 hover:text-foreground"
                  >
                    Details <ChevronRight className="h-3 w-3" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>

        <aside className="min-w-0">
          <AIActivityFeed />
        </aside>
      </div>

      <RecommendationDetailSheet
        open={active != null}
        onOpenChange={(v) => !v && setActive(null)}
        recommendationId={active?.id ?? null}
        intent={active?.intent}
        headline={active?.headline}
        why={active?.rationale ?? null}
        confidence={active?.confidence ?? null}
      />
    </main>
  );
}
