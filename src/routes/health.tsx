// Phase 8 — Health & Wellness trends. Read-only, permission-based, no medical advice.

import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Activity,
  ArrowLeft,
  ArrowRight,
  Heart,
  Moon,
  ShieldCheck,
  Sparkles,
  Sunrise,
  TrendingDown,
  TrendingUp,
  Minus,
} from "lucide-react";

import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  getWearableSummary,
  listWearableReadings,
} from "@/lib/wearables/wearables.functions";
import {
  computeTrends,
  PLANNED_PROVIDERS,
  type MetricSummary,
  type TrendDirection,
} from "@/lib/health/trends";
import { PROVIDER_LABEL } from "@/lib/wearables/types";

export const Route = createFileRoute("/health")({
  head: () => ({
    meta: [
      { title: "Health & Wellness | RestPilot AI" },
      {
        name: "description",
        content:
          "Read-only sleep, recovery, and consistency trends from your connected wearable. Wellness only — not medical advice.",
      },
    ],
  }),
  component: HealthPage,
});

function TrendIcon({ d }: { d: TrendDirection | undefined }) {
  if (d === "up") return <TrendingUp className="h-3.5 w-3.5 text-emerald-500" aria-label="trending up" />;
  if (d === "down") return <TrendingDown className="h-3.5 w-3.5 text-amber-500" aria-label="trending down" />;
  if (d === "flat") return <Minus className="h-3.5 w-3.5 text-muted-foreground" aria-label="steady" />;
  return null;
}

function MetricCard({ icon, m }: { icon: React.ReactNode; m: MetricSummary }) {
  return (
    <Card className="p-4">
      <div className="flex items-center gap-2">
        <span className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-primary/10 text-primary" aria-hidden>
          {icon}
        </span>
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{m.label}</p>
        <div className="ml-auto"><TrendIcon d={m.direction} /></div>
      </div>
      <p className="mt-2 text-2xl font-semibold tabular-nums" aria-live="polite">
        {m.value ?? "—"}
      </p>
      <p className="mt-1 text-xs text-muted-foreground">{m.context}</p>
      {m.n > 0 && (
        <p className="mt-1 text-[10px] text-muted-foreground/70">based on {m.n} reading{m.n === 1 ? "" : "s"}</p>
      )}
    </Card>
  );
}

function Sparkline({ data }: { data: Array<{ date: string; hours: number | null }> }) {
  const points = data.filter((d) => d.hours != null) as Array<{ date: string; hours: number }>;
  if (points.length < 2) {
    return <p className="text-xs text-muted-foreground">Not enough nights yet for a trend line.</p>;
  }
  const w = 280;
  const h = 60;
  const max = Math.max(10, ...points.map((p) => p.hours));
  const min = Math.min(4, ...points.map((p) => p.hours));
  const span = max - min || 1;
  const stepX = w / (points.length - 1);
  const path = points
    .map((p, i) => `${i === 0 ? "M" : "L"} ${(i * stepX).toFixed(1)} ${(h - ((p.hours - min) / span) * h).toFixed(1)}`)
    .join(" ");
  return (
    <svg
      role="img"
      aria-label={`Sleep duration trend over ${points.length} nights`}
      viewBox={`0 0 ${w} ${h}`}
      className="h-16 w-full"
    >
      <path d={path} fill="none" stroke="currentColor" strokeWidth="2" className="text-primary" />
    </svg>
  );
}

function HealthPage() {
  const summaryFn = useServerFn(getWearableSummary);
  const readingsFn = useServerFn(listWearableReadings);

  const summaryQ = useQuery({
    queryKey: ["wearable-summary"],
    queryFn: () => summaryFn(),
    staleTime: 60_000,
  });
  const readingsQ = useQuery({
    queryKey: ["wearable-readings", 30],
    queryFn: () => readingsFn({ data: { days: 30 } }),
    staleTime: 60_000,
  });

  const trends = useMemo(
    () => computeTrends(readingsQ.data ?? [], 14),
    [readingsQ.data],
  );

  const connected = (summaryQ.data?.connections ?? []).length > 0;
  const loading = summaryQ.isLoading || readingsQ.isLoading;

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-5 pb-24 pt-6">
      <header className="flex items-center gap-2">
        <Link
          to="/dashboard"
          className="inline-flex h-9 w-9 min-h-11 min-w-11 items-center justify-center rounded-md border border-border/60"
          aria-label="Back to dashboard"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div className="flex-1">
          <h1 className="text-lg font-semibold inline-flex items-center gap-2">
            <Heart className="h-4 w-4 text-primary" aria-hidden /> Health &amp; Wellness
          </h1>
          <p className="text-xs text-muted-foreground">
            Trends from your connected wearable. Read-only. You're always in control.
          </p>
        </div>
      </header>

      <Card className="border-amber-500/30 bg-amber-500/5 p-3">
        <div className="flex items-start gap-2">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden />
          <p className="text-xs text-muted-foreground">
            <span className="font-medium text-foreground">Wellness only.</span> RestPilot AI is not a
            medical device. Nothing here diagnoses, treats, cures, or prevents any condition. Talk to
            a qualified clinician for health decisions.
          </p>
        </div>
      </Card>

      {!connected && !loading ? (
        <Card className="p-4">
          <p className="text-sm font-medium">No wearable connected.</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Connect Fitbit or Oura to see your sleep, recovery, and consistency trends. We only read
            what you authorize, and you can disconnect anytime.
          </p>
          <Link
            to="/profile"
            className="mt-3 inline-flex min-h-11 items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground"
          >
            Connect a wearable <ArrowRight className="h-4 w-4" />
          </Link>
        </Card>
      ) : loading ? (
        <Card className="p-4 text-sm text-muted-foreground">Loading your trends…</Card>
      ) : trends.nights === 0 ? (
        <Card className="p-4">
          <p className="text-sm font-medium">No nights synced yet in the last {trends.windowDays} days.</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Your wearable will sync overnight. Check back after your next night of sleep.
          </p>
        </Card>
      ) : (
        <>
          <section aria-label="Sleep trends" className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <MetricCard icon={<Moon className="h-4 w-4" />} m={trends.sleepDuration} />
            <MetricCard icon={<Sunrise className="h-4 w-4" />} m={trends.bedtimeConsistency} />
            <MetricCard icon={<Sunrise className="h-4 w-4" />} m={trends.wakeConsistency} />
            <MetricCard icon={<Activity className="h-4 w-4" />} m={trends.hrv} />
            <MetricCard icon={<Heart className="h-4 w-4" />} m={trends.restingHr} />
          </section>

          <Card className="p-4">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" aria-hidden />
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Sleep duration — last {trends.sleepDurationSeries.length} nights
              </p>
            </div>
            <div className="mt-3">
              <Sparkline data={trends.sleepDurationSeries} />
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground">
              Hours per night. Aim for what feels rested for you — not a fixed number.
            </p>
          </Card>
        </>
      )}

      <Card className="p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Connected
        </p>
        {connected ? (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {summaryQ.data!.connections.map((c) => (
              <Badge key={c.provider} variant="secondary" className="text-[11px]">
                {PROVIDER_LABEL[c.provider]} · synced {c.lastSyncAt ? new Date(c.lastSyncAt).toLocaleDateString() : "never"}
              </Badge>
            ))}
          </div>
        ) : (
          <p className="mt-2 text-xs text-muted-foreground">No providers connected yet.</p>
        )}
        <Link
          to="/profile"
          className="mt-3 inline-flex items-center gap-1 text-xs text-primary underline-offset-2 hover:underline"
        >
          Manage connections <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </Card>

      <section aria-label="Planned providers" className="flex flex-col gap-2">
        <p className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          More providers — planned
        </p>
        {PLANNED_PROVIDERS.map((p) => (
          <Card key={p.id} className="p-3">
            <div className="flex items-start gap-2">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium">{p.label}</p>
                <p className="text-xs text-muted-foreground">{p.blurb}</p>
                <p className="mt-1 text-[11px] text-muted-foreground/80">{p.status}</p>
              </div>
              <Badge variant="outline" className="text-[10px]">Coming soon</Badge>
            </div>
          </Card>
        ))}
      </section>

      <p className="text-center text-[11px] text-muted-foreground">
        Your wearable data stays in your account. Disconnect anytime from Profile.
      </p>
    </main>
  );
}
