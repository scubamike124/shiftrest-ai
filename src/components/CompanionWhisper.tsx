import { useEffect, useMemo, useState } from "react";
import { Eye, X, Wand2 } from "lucide-react";
import { aiAdjustPlan, type AdjustPlanResponse } from "@/lib/ai-client";
import type { Insights } from "@/lib/insights";

/**
 * CompanionWhisper — surfaces ONE proactive observation the AI noticed about the
 * user's recent patterns. Dismissible per-observation. Optional "Adjust my plan"
 * follow-up streams a focused adjustment via /api/ai adjust_plan.
 */
const DISMISS_KEY = "rp_whisper_dismissed_v1";

function loadDismissed(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = sessionStorage.getItem(DISMISS_KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

function saveDismissed(set: Set<string>) {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(DISMISS_KEY, JSON.stringify([...set]));
  } catch {
    /* ignore */
  }
}

function pickObservation(insights: Insights | null): { id: string; text: string } | null {
  if (!insights) return null;
  // Highest-leverage signal first.
  if (Math.abs(insights.sleepDebtHours) >= 2) {
    const sign = insights.sleepDebtHours > 0 ? "under" : "over";
    return {
      id: `debt-${Math.round(insights.sleepDebtHours)}`,
      text: `You slept ${Math.abs(insights.sleepDebtHours).toFixed(1)}h ${sign} target over the last 7 nights.`,
    };
  }
  if (insights.hrvTrend != null && insights.hrvTrend <= -0.07) {
    return {
      id: `hrv-${Math.round(insights.hrvTrend * 100)}`,
      text: `Your HRV is trending ${Math.round(Math.abs(insights.hrvTrend) * 100)}% below your 7-day baseline — your body is asking for more recovery.`,
    };
  }
  const firstSignal = insights.signals[0];
  if (firstSignal) {
    return { id: `sig-${firstSignal.slice(0, 24)}`, text: firstSignal };
  }
  return null;
}

export function CompanionWhisper({
  insights,
  signedIn,
  context,
}: {
  insights: Insights | null;
  signedIn: boolean;
  context: string;
}) {
  const obs = useMemo(() => pickObservation(insights), [insights]);
  const [dismissed, setDismissed] = useState<Set<string>>(() => new Set());
  const [adjustment, setAdjustment] = useState<AdjustPlanResponse | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setDismissed(loadDismissed());
  }, []);

  if (!obs || dismissed.has(obs.id)) return null;

  function dismiss() {
    if (!obs) return;
    const next = new Set(dismissed);
    next.add(obs.id);
    setDismissed(next);
    saveDismissed(next);
  }

  async function adjust() {
    if (!signedIn || !obs) return;
    setLoading(true);
    try {
      const res = await aiAdjustPlan({ observation: obs.text, context });
      setAdjustment(res);
    } catch (e) {
      setAdjustment({
        summary: e instanceof Error ? e.message : "Couldn't load adjustment.",
        changes: [],
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="rounded-2xl border border-indigo-glow/30 bg-card/60 p-4 backdrop-blur">
      <div className="flex items-start gap-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-indigo-glow/15 text-indigo-glow">
          <Eye className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-semibold uppercase tracking-[0.25em] text-indigo-glow">
            I noticed
          </p>
          <p className="mt-1 text-sm leading-snug">{obs.text}</p>

          {!adjustment && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                onClick={adjust}
                disabled={loading || !signedIn}
                className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-3 text-xs font-semibold text-primary-foreground disabled:opacity-60"
              >
                <Wand2 className="h-3.5 w-3.5" />
                {loading ? "Thinking…" : "Adjust tomorrow's plan"}
              </button>
              <button
                onClick={dismiss}
                className="inline-flex h-9 items-center rounded-lg px-3 text-xs font-semibold text-muted-foreground hover:text-foreground"
              >
                Not now
              </button>
            </div>
          )}

          {adjustment && (
            <div className="mt-3 space-y-2">
              <p className="text-xs italic text-muted-foreground">{adjustment.summary}</p>
              <ul className="space-y-1.5">
                {adjustment.changes.map((c, i) => (
                  <li key={i} className="rounded-lg border border-border bg-background/60 p-2 text-xs">
                    <p className="font-semibold">{c.label}</p>
                    <p className="text-muted-foreground">
                      <span className="line-through opacity-70">{c.from}</span>
                      {" → "}
                      <span className="text-foreground">{c.to}</span>
                    </p>
                    <p className="mt-0.5 text-muted-foreground">{c.reason}</p>
                  </li>
                ))}
              </ul>
              {adjustment.ifIgnored && (
                <p className="rounded-lg border border-rose-500/20 bg-rose-500/5 p-2 text-[11px] leading-snug text-foreground/90">
                  <span className="font-semibold text-rose-300">If you skip these: </span>
                  {adjustment.ifIgnored}
                </p>
              )}
            </div>
          )}
        </div>
        <button
          onClick={dismiss}
          aria-label="Dismiss"
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-secondary"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </section>
  );
}
