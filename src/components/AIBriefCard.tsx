import { useEffect, useMemo, useState } from "react";
import { SafetyNote } from "@/components/legal/SafetyNote";
import { useQuery } from "@tanstack/react-query";
import {
  Sun,
  Coffee,
  Moon,
  Droplet,
  Utensils,
  Sparkles,
  Bed,
  Lightbulb,
  Loader2,
  RefreshCw,
} from "lucide-react";
import type { Insights } from "@/lib/insights";
import type { Recommendation } from "@/lib/recommendations";
import { supabase } from "@/integrations/supabase/client";


const ICONS: Record<string, typeof Sun> = {
  sun: Sun,
  light: Lightbulb,
  coffee: Coffee,
  moon: Moon,
  water: Droplet,
  food: Utensils,
  nap: Bed,
};

const REC_ICONS: Record<Recommendation["kind"], typeof Sun> = {
  "anchor-sleep": Moon,
  "wind-down": Bed,
  "bright-light": Sun,
  "amber-light": Lightbulb,
  "caffeine-on": Coffee,
  "caffeine-cutoff": Coffee,
  meal: Utensils,
  nap: Bed,
  "split-sleep": Moon,
  hydrate: Droplet,
  recovery: Sparkles,
};


type AIBrief = {
  greeting: string;
  headline: string;
  fatigue_note: string;
  top_actions: { icon: string; title: string; detail: string }[];
  coach_note: string;
};

async function fetchBrief(context: string): Promise<AIBrief> {
  const resp = await fetch("/api/insights", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ context }),
  });
  if (!resp.ok) {
    const e = await resp.json().catch(() => ({}));
    throw new Error(e.error || "Brief unavailable");
  }
  return resp.json();
}

export function AIBriefCard({
  insights,
  recommendations = [],
}: {
  insights: Insights;
  recommendations?: Recommendation[];
}) {
  const context = insights.contextString;
  // Cache by context string so the AI cost is paid once per day shape.
  const queryKey = useMemo(() => ["ai-brief", context], [context]);

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey,
    queryFn: () => fetchBrief(context),
    staleTime: 1000 * 60 * 60 * 4, // 4 hours
    retry: 1,
    enabled: !!context,
  });

  const fatigueColor =
    insights.fatigueToday.band === "extreme"
      ? "var(--destructive)"
      : insights.fatigueToday.band === "high"
      ? "var(--amber)"
      : insights.fatigueToday.band === "moderate"
      ? "var(--indigo-glow)"
      : "var(--mint)";

  return (
    <section
      className="relative overflow-hidden rounded-[28px] border border-primary/25 p-5"
      style={{
        background:
          "linear-gradient(160deg, color-mix(in srgb, var(--primary) 14%, var(--card)) 0%, var(--card) 65%)",
        boxShadow: "var(--shadow-card)",
      }}
    >
      <div className="absolute -right-12 -top-12 h-32 w-32 rounded-full bg-primary/20 blur-3xl" />

      <header className="relative z-10 flex items-start justify-between">
        <div className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/20">
            <Sparkles className="h-3.5 w-3.5 text-indigo-glow" />
          </span>
          <p className="text-[10px] font-semibold uppercase tracking-[0.25em] text-indigo-glow">
            AI Coach Brief
          </p>
        </div>
        <button
          onClick={() => refetch()}
          disabled={isFetching}
          aria-label="Refresh brief"
          className="flex h-7 w-7 items-center justify-center rounded-full bg-secondary/60 text-muted-foreground active:scale-95 disabled:opacity-50"
        >
          {isFetching ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" />
          )}
        </button>
      </header>

      {/* Fatigue + Recovery strip */}
      <div className="relative z-10 mt-4 grid grid-cols-2 gap-3">
        <div className="rounded-2xl border border-border/60 bg-card/60 p-3">
          <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            Fatigue today
          </p>
          <p
            className="mt-1 text-2xl"
            style={{ fontFamily: "var(--font-display)", color: fatigueColor }}
          >
            {insights.fatigueToday.score}
            <span className="text-xs text-muted-foreground"> /100</span>
          </p>
          <p className="mt-0.5 text-[10px] capitalize text-muted-foreground">
            {insights.fatigueToday.band}
          </p>
        </div>
        <div className="rounded-2xl border border-border/60 bg-card/60 p-3">
          <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            Recovery
          </p>
          <p className="mt-1 text-2xl" style={{ fontFamily: "var(--font-display)" }}>
            {insights.recoveryScore}
            <span className="text-xs text-muted-foreground"> /100</span>
          </p>
          <p className="mt-0.5 text-[10px] capitalize text-muted-foreground">
            {insights.recoveryBand}
          </p>
        </div>
      </div>

      {/* 3-day fatigue forecast */}
      <div className="relative z-10 mt-3 flex gap-1.5">
        {insights.fatigueForecast.map((p, i) => {
          const c =
            p.band === "extreme"
              ? "var(--destructive)"
              : p.band === "high"
              ? "var(--amber)"
              : p.band === "moderate"
              ? "var(--indigo-glow)"
              : "var(--mint)";
          return (
            <div key={i} className="flex flex-1 flex-col items-center gap-1">
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-secondary">
                <div
                  className="h-full rounded-full"
                  style={{ width: `${Math.max(8, p.score)}%`, background: c }}
                />
              </div>
              <span className="text-[10px] text-muted-foreground">
                {i === 0 ? "Today" : p.label}
              </span>
            </div>
          );
        })}
      </div>

      {/* 14-day fatigue horizon sparkline */}
      <div className="relative z-10 mt-3">
        <div className="flex items-end gap-[3px] h-8">
          {insights.fatigueHorizon.map((p, i) => {
            const c =
              p.band === "extreme"
                ? "var(--destructive)"
                : p.band === "high"
                  ? "var(--amber)"
                  : p.band === "moderate"
                    ? "var(--indigo-glow)"
                    : "var(--mint)";
            return (
              <div
                key={i}
                title={`${p.label} · ${p.score}/100 · ${p.reason}`}
                className="flex-1 rounded-sm opacity-90"
                style={{
                  height: `${Math.max(10, p.score)}%`,
                  background: c,
                }}
              />
            );
          })}
        </div>
        <p className="mt-1 text-[10px] text-muted-foreground">
          14-day fatigue horizon · debt {insights.sleepDebtHours.toFixed(1)}h
          {insights.hrvTrend != null
            ? ` · HRV ${insights.hrvTrend > 0 ? "+" : ""}${Math.round(insights.hrvTrend * 100)}%`
            : ""}
        </p>
      </div>


      {/* AI body */}
      <div className="relative z-10 mt-4 min-h-[120px]">
        {isLoading && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin text-indigo-glow" />
            Reading your week…
          </div>
        )}
        {isError && (
          <div className="rounded-xl border border-amber/40 bg-amber/10 p-3 text-xs text-amber">
            {error instanceof Error ? error.message : "Brief unavailable."}
          </div>
        )}
        {data && (
          <div className="flex flex-col gap-3">
            <div>
              <p className="text-[11px] uppercase tracking-widest text-indigo-glow">
                {data.greeting}
              </p>
              <p
                className="mt-1 text-lg leading-snug"
                style={{ fontFamily: "var(--font-display)" }}
              >
                {data.headline}
              </p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                {data.fatigue_note}
              </p>
            </div>

            <ul className="flex flex-col gap-2">
              {data.top_actions.slice(0, 3).map((a, i) => {
                const Icon = ICONS[a.icon] ?? Sparkles;
                return (
                  <li
                    key={i}
                    className="flex gap-3 rounded-xl border border-border/60 bg-card/60 p-3"
                  >
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/15 text-indigo-glow">
                      <Icon className="h-4 w-4" />
                    </span>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold leading-tight">{a.title}</p>
                      <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                        {a.detail}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ul>

            <p className="text-xs italic leading-relaxed text-muted-foreground">
              — {data.coach_note}
            </p>
          </div>
        )}
      </div>

      {/* Personalized ranked recommendations — always rendered, AI-independent */}
      {recommendations.length > 0 && (
        <div className="relative z-10 mt-4 border-t border-border/40 pt-4">
          <p className="text-[10px] font-semibold uppercase tracking-[0.25em] text-indigo-glow">
            Personalized for you · next 24h
          </p>
          <ol className="mt-2 flex flex-col gap-2">
            {recommendations.map((r, i) => {
              const Icon = REC_ICONS[r.kind] ?? Sparkles;
              return (
                <li
                  key={i}
                  className="flex gap-3 rounded-xl border border-border/60 bg-card/60 p-3"
                >
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/15 text-indigo-glow">
                    <Icon className="h-4 w-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <p className="text-sm font-semibold leading-tight">{r.title}</p>
                      <span className="shrink-0 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                        {r.whenLabel}
                      </span>
                    </div>
                    <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                      {r.detail}
                    </p>
                  </div>
                </li>
              );
            })}
          </ol>
        </div>
      )}
    <div className="mt-3 flex justify-end"><SafetyNote /></div>
    </section>

  );
}
