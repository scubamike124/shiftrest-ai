import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Eye, X, BellOff, AlertTriangle, Trash2 } from "lucide-react";
import { listPatterns, mutePattern, deletePattern, PATTERN_LABELS, type AIPattern } from "@/lib/ai-feedback";
import { aiPatternAlert, type PatternAlertResponse } from "@/lib/ai-client";
import { FeedbackChips } from "./FeedbackChips";
import { toast } from "sonner";

const TONE_RING: Record<string, string> = {
  rose: "border-rose-500/30 bg-rose-500/5",
  amber: "border-amber-400/30 bg-amber-400/5",
  indigo: "border-indigo-glow/30 bg-indigo-glow/5",
};
const TONE_DOT: Record<string, string> = {
  rose: "bg-rose-400",
  amber: "bg-amber-400",
  indigo: "bg-indigo-400",
};

export function PatternAlerts({ signedIn, context, enabled = true }: { signedIn: boolean; context: string; enabled?: boolean }) {
  const qc = useQueryClient();
  const { data: patterns = [] } = useQuery<AIPattern[]>({
    queryKey: ["ai-patterns"],
    queryFn: listPatterns,
    enabled: signedIn && enabled,
    staleTime: 60_000,
  });

  if (!signedIn || !enabled || patterns.length === 0) return null;
  const top = patterns.slice(0, 2);

  return (
    <div className="space-y-2">
      {top.map((p) => (
        <PatternItem
          key={p.id}
          pattern={p}
          context={context}
          signedIn={signedIn}
          onChanged={() => qc.invalidateQueries({ queryKey: ["ai-patterns"] })}
        />
      ))}
    </div>
  );
}

function PatternItem({
  pattern,
  context,
  signedIn,
  onChanged,
}: {
  pattern: AIPattern;
  context: string;
  signedIn: boolean;
  onChanged: () => void;
}) {
  const meta = PATTERN_LABELS[pattern.patternKey] ?? { title: pattern.patternKey, tone: "indigo" };
  const [alert, setAlert] = useState<PatternAlertResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [showWhy, setShowWhy] = useState(false);

  async function explain() {
    if (loading || alert) return;
    setLoading(true);
    try {
      const res = await aiPatternAlert({
        patternKey: pattern.patternKey,
        severity: pattern.severity,
        signals: pattern.signals,
        context,
      });
      setAlert(res);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't generate explanation");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className={`rounded-2xl border p-4 backdrop-blur ${TONE_RING[meta.tone] ?? TONE_RING.indigo}`}>
      <div className="flex items-start gap-3">
        <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${TONE_DOT[meta.tone] ?? TONE_DOT.indigo}`} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              Pattern · severity {pattern.severity}/5
            </p>
          </div>
          <p className="mt-1 text-sm font-semibold leading-snug">{meta.title}</p>

          {!alert ? (
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                onClick={explain}
                disabled={loading}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-primary px-3 text-xs font-semibold text-primary-foreground disabled:opacity-50"
              >
                <AlertTriangle className="h-3 w-3" />
                {loading ? "Thinking…" : "Why this matters"}
              </button>
              <button
                onClick={() => setShowWhy((v) => !v)}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-3 text-xs font-semibold text-muted-foreground hover:text-foreground"
              >
                <Eye className="h-3 w-3" /> {showWhy ? "Hide" : "Why am I seeing this?"}
              </button>
              <button
                onClick={async () => { await mutePattern(pattern.id, 30); toast.success("Muted 30 days"); onChanged(); }}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs font-semibold text-muted-foreground hover:text-foreground"
                title="Mute 30 days"
              >
                <BellOff className="h-3 w-3" />
              </button>
              <button
                onClick={async () => { await deletePattern(pattern.id); toast.success("Pattern removed"); onChanged(); }}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs font-semibold text-muted-foreground hover:text-destructive"
                title="Delete"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
          ) : (
            <div className="mt-3 space-y-2">
              <p className="text-sm font-semibold">{alert.headline}</p>
              <p className="text-xs leading-snug text-muted-foreground">{alert.why}</p>
              <p className="rounded-lg border border-primary/25 bg-primary/5 p-2 text-xs">
                <span className="font-semibold">Do this: </span>{alert.action}
              </p>
              <FeedbackChips recommendationId={alert.recommendationId} signedIn={signedIn} />
            </div>
          )}

          {showWhy && (
            <div className="mt-2 rounded-lg bg-background/60 p-2 text-[11px] text-muted-foreground">
              <p className="font-semibold text-foreground">Evidence</p>
              <pre className="mt-1 overflow-x-auto whitespace-pre-wrap break-words">
                {JSON.stringify(pattern.signals, null, 2)}
              </pre>
              <p className="mt-1">Seen {pattern.occurrences}× · last update {new Date(pattern.lastSeenAt).toLocaleString()}</p>
            </div>
          )}
        </div>
        <button
          onClick={async () => { await mutePattern(pattern.id, 1); onChanged(); }}
          aria-label="Dismiss today"
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-secondary"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </section>
  );
}
