import { useEffect, useState } from "react";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from "@/components/ui/sheet";
import { Sparkles, Database, Lightbulb, GitCompare, Target, Loader2, CalendarRange } from "lucide-react";
import {
  deriveSources,
  fetchPreviousForIntent,
  fetchRecommendation,
  type RecommendationDetail,
  type TrustChange,
} from "@/lib/trust";
import { ConfidenceBadge } from "./ConfidenceBadge";
import { WhatChanged } from "./WhatChanged";

export type RecommendationDetailSheetProps = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** Persisted recommendation id (preferred — unlocks evidence + history). */
  recommendationId?: string | null;
  /** Intent name, for fetching previous version. */
  intent?: string;
  /** Inline overrides (used when no persisted row yet, or to enrich). */
  headline?: string;
  why?: string | null;
  confidence?: number | "low" | "medium" | "high" | null;
  sources?: string[];
  alternatives?: string[];
  expectedOutcome?: string;
  changes?: TrustChange[];
};

function Section({
  icon: Icon,
  title,
  children,
}: {
  icon: typeof Sparkles;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.22em] text-indigo-glow">
        <Icon className="h-3.5 w-3.5" aria-hidden />
        {title}
      </div>
      <div className="text-sm leading-relaxed text-foreground/90">{children}</div>
    </div>
  );
}

export function RecommendationDetailSheet(props: RecommendationDetailSheetProps) {
  const {
    open, onOpenChange, recommendationId, intent,
    headline, why, confidence, sources, alternatives, expectedOutcome, changes,
  } = props;

  const [loading, setLoading] = useState(false);
  const [detail, setDetail] = useState<RecommendationDetail | null>(null);
  const [prev, setPrev] = useState<{ headline: string; createdAt: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!open || !recommendationId) return;
    setLoading(true);
    Promise.all([
      fetchRecommendation(recommendationId),
      intent ? fetchPreviousForIntent(intent, recommendationId) : Promise.resolve(null),
    ])
      .then(([d, p]) => {
        if (cancelled) return;
        setDetail(d);
        setPrev(p ? { headline: p.headline, createdAt: p.createdAt } : null);
      })
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, [open, recommendationId, intent]);

  const finalHeadline = detail?.headline ?? headline ?? "AI recommendation";
  const finalWhy = (why ?? detail?.rationale) || null;
  const finalConfidence = confidence ?? detail?.confidence ?? null;

  // Sources: explicit > derived from evidence
  const finalSources = sources && sources.length > 0
    ? sources
    : deriveSources(detail?.evidence);

  // Alternatives & expected outcome may live in evidence_json
  const ev = detail?.evidence ?? {};
  const altFromEvidence = Array.isArray((ev as { alternatives?: unknown }).alternatives)
    ? ((ev as { alternatives: unknown[] }).alternatives).filter((s): s is string => typeof s === "string")
    : [];
  const finalAlternatives = alternatives && alternatives.length > 0 ? alternatives : altFromEvidence;

  const impact = (detail?.predictedImpact ?? {}) as Record<string, unknown>;
  const impactStr = (k: string): string | null => {
    const v = impact[k];
    return typeof v === "string" && v.trim() ? v : null;
  };
  const impactToday = impactStr("today");
  const impactTomorrow = impactStr("tomorrow");
  const impactWeek = impactStr("week");
  const impactIfIgnored = impactStr("ifIgnored");
  const hasImpactTriple = Boolean(impactToday || impactTomorrow || impactWeek);

  const outcomeFromImpact =
    typeof (impact as { expectedOutcome?: unknown }).expectedOutcome === "string"
      ? ((impact as { expectedOutcome: string }).expectedOutcome)
      : typeof (ev as { expectedOutcome?: unknown }).expectedOutcome === "string"
      ? ((ev as { expectedOutcome: string }).expectedOutcome)
      : "";
  const finalOutcome = expectedOutcome || outcomeFromImpact;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="max-h-[88vh] overflow-y-auto rounded-t-3xl border-indigo-glow/25 bg-card/95 px-5 pb-8 pt-6 backdrop-blur-xl sm:max-w-lg sm:mx-auto"
      >
        <SheetHeader className="space-y-3 text-left">
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-indigo-glow/15 text-indigo-glow">
              <Sparkles className="h-3.5 w-3.5" />
            </span>
            <span className="text-[10px] font-bold uppercase tracking-[0.25em] text-indigo-glow">
              Why this recommendation
            </span>
            {finalConfidence != null && (
              <ConfidenceBadge value={finalConfidence} showPercent className="ml-auto" />
            )}
          </div>
          <SheetTitle className="text-lg font-semibold leading-snug" style={{ fontFamily: "var(--font-display)" }}>
            {finalHeadline}
          </SheetTitle>
          <SheetDescription className="sr-only">
            Detailed explanation of this AI recommendation.
          </SheetDescription>
        </SheetHeader>

        {loading && !detail && (
          <div className="mt-6 flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading evidence…
          </div>
        )}

        <div className="mt-5 space-y-5">
          {finalWhy && (
            <Section icon={Lightbulb} title="Why">
              <p>{finalWhy}</p>
            </Section>
          )}

          {finalSources.length > 0 && (
            <Section icon={Database} title="Data sources used">
              <ul className="flex flex-wrap gap-1.5">
                {finalSources.map((s) => (
                  <li
                    key={s}
                    className="rounded-full border border-border/60 bg-background/50 px-2.5 py-1 text-xs text-foreground/85"
                  >
                    {s}
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {(changes && changes.length > 0) || (prev && finalHeadline) ? (
            <Section icon={GitCompare} title="What changed">
              <WhatChanged
                changes={changes}
                previousHeadline={prev?.headline ?? null}
                currentHeadline={finalHeadline}
              />
            </Section>
          ) : null}

          {finalAlternatives.length > 0 && (
            <Section icon={GitCompare} title="Alternatives considered">
              <ul className="list-disc space-y-1 pl-5">
                {finalAlternatives.map((a, i) => (
                  <li key={i} className="text-sm text-foreground/85">{a}</li>
                ))}
              </ul>
            </Section>
          )}

          {hasImpactTriple && (
            <Section icon={CalendarRange} title="Predicted impact">
              <ul className="space-y-2">
                {impactToday && (
                  <li className="rounded-xl border border-border/60 bg-background/40 p-3">
                    <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-indigo-glow/80">Today</p>
                    <p className="mt-1 text-sm leading-snug text-foreground/90">{impactToday}</p>
                  </li>
                )}
                {impactTomorrow && (
                  <li className="rounded-xl border border-border/60 bg-background/40 p-3">
                    <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-indigo-glow/80">Tomorrow</p>
                    <p className="mt-1 text-sm leading-snug text-foreground/90">{impactTomorrow}</p>
                  </li>
                )}
                {impactWeek && (
                  <li className="rounded-xl border border-border/60 bg-background/40 p-3">
                    <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-indigo-glow/80">This week</p>
                    <p className="mt-1 text-sm leading-snug text-foreground/90">{impactWeek}</p>
                  </li>
                )}
              </ul>
              {impactIfIgnored && (
                <p className="mt-3 text-xs leading-snug text-muted-foreground">
                  <span className="font-semibold text-foreground/80">If ignored: </span>
                  {impactIfIgnored}
                </p>
              )}
            </Section>
          )}

          {finalOutcome && !hasImpactTriple && (
            <Section icon={Target} title="If you follow this">
              <p>{finalOutcome}</p>
            </Section>
          )}

          {!finalWhy && finalSources.length === 0 && !finalOutcome && !hasImpactTriple && !loading && (
            <p className="text-sm text-muted-foreground">
              RestPilot didn't attach extra evidence to this recommendation yet. As your patterns
              and history grow, the "Why" detail here gets richer.
            </p>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
