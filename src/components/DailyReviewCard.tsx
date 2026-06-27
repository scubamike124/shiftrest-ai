import { useEffect, useState } from "react";
import { Sun, RefreshCw, TrendingUp, TrendingDown, Minus, CheckCircle2, AlertCircle, Target } from "lucide-react";
import { aiDailyReview, type DailyReviewResponse } from "@/lib/ai-client";
import { FeedbackChips } from "./FeedbackChips";

const CACHE_KEY = "rp_daily_review_v1";

type Cached = { day: string; data: DailyReviewResponse };

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function readCache(): DailyReviewResponse | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const c = JSON.parse(raw) as Cached;
    if (c.day !== today()) return null;
    return c.data;
  } catch { return null; }
}
function writeCache(data: DailyReviewResponse) {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(CACHE_KEY, JSON.stringify({ day: today(), data } satisfies Cached));
  } catch { /* ignore */ }
}

const TREND_ICON = { up: TrendingUp, flat: Minus, down: TrendingDown, unknown: Minus };
const TREND_TONE = { up: "text-emerald-300", flat: "text-slate-300", down: "text-rose-300", unknown: "text-muted-foreground" };

export function DailyReviewCard({
  signedIn,
  context,
  enabled = true,
}: {
  signedIn: boolean;
  context: string;
  enabled?: boolean;
}) {
  const [data, setData] = useState<DailyReviewResponse | null>(() => readCache());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load(force = false) {
    if (!signedIn || !enabled) return;
    if (!force && readCache()) { setData(readCache()); return; }
    setLoading(true); setError(null);
    try {
      const res = await aiDailyReview({ context });
      setData(res);
      writeCache(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load today's recap.");
    } finally { setLoading(false); }
  }

  useEffect(() => {
    if (signedIn && enabled && !data) load(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signedIn, enabled]);

  if (!signedIn || !enabled) return null;

  return (
    <section className="rounded-[28px] border border-amber-400/25 bg-card/70 p-5 backdrop-blur">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-amber-400/15 text-amber-300">
            <Sun className="h-3.5 w-3.5" />
          </span>
          <p className="text-[10px] font-semibold uppercase tracking-[0.25em] text-amber-300">Today's recap</p>
        </div>
        <button onClick={() => load(true)} disabled={loading} aria-label="Refresh recap"
          className="flex h-8 w-8 items-center justify-center rounded-full bg-secondary/60 text-muted-foreground transition hover:text-foreground disabled:opacity-50">
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
        </button>
      </header>

      {!data && loading && (
        <div className="mt-4 space-y-2">
          <div className="h-6 w-3/4 animate-pulse rounded bg-secondary" />
          <div className="h-4 w-full animate-pulse rounded bg-secondary/70" />
        </div>
      )}
      {error && !data && (
        <div className="mt-4 text-sm text-muted-foreground">
          <p>{error}</p>
          <button onClick={() => load(true)} className="mt-2 text-sm font-semibold text-primary">Try again</button>
        </div>
      )}

      {data && (() => {
        const TrendIcon = TREND_ICON[data.metrics.recoveryTrend];
        const trendTone = TREND_TONE[data.metrics.recoveryTrend];
        return (
          <div className="mt-3 space-y-3">
            <h3 className="text-lg font-semibold leading-snug" style={{ fontFamily: "var(--font-display)" }}>
              {data.headline}
            </h3>

            <div className="grid gap-2 sm:grid-cols-3">
              <div className="rounded-2xl border border-border/60 bg-background/40 p-3">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Recovery trend</p>
                <p className={`mt-1 inline-flex items-center gap-1 text-sm font-semibold ${trendTone}`}>
                  <TrendIcon className="h-3.5 w-3.5" /> {data.metrics.recoveryTrend}
                </p>
              </div>
              {data.metrics.sleepRecoveredMin != null && (
                <div className="rounded-2xl border border-border/60 bg-background/40 p-3">
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Sleep recovered</p>
                  <p className="mt-1 text-sm font-semibold">{data.metrics.sleepRecoveredMin} min</p>
                </div>
              )}
              {data.metrics.readinessDelta != null && (
                <div className="rounded-2xl border border-border/60 bg-background/40 p-3">
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Readiness Δ</p>
                  <p className="mt-1 text-sm font-semibold">{data.metrics.readinessDelta > 0 ? "+" : ""}{data.metrics.readinessDelta}</p>
                </div>
              )}
            </div>

            {data.wins.length > 0 && (
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-widest text-emerald-300">What helped</p>
                <ul className="mt-1 space-y-1">
                  {data.wins.map((w, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm">
                      <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-300" />
                      <span>{w}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {data.drains.length > 0 && (
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-widest text-rose-300">What drained</p>
                <ul className="mt-1 space-y-1">
                  {data.drains.map((w, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm">
                      <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-rose-300" />
                      <span>{w}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="rounded-2xl border border-primary/25 bg-primary/5 p-3">
              <p className="inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-primary">
                <Target className="h-3 w-3" /> Tomorrow's small focus
              </p>
              <p className="mt-1 text-sm">{data.tomorrowFocus}</p>
            </div>

            <FeedbackChips recommendationId={data.recommendationId} signedIn={signedIn} />
          </div>
        );
      })()}
    </section>
  );
}
