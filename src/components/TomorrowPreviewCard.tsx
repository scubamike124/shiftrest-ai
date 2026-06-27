import { useEffect, useState } from "react";
import { CalendarClock, RefreshCw, Sparkles, ShieldCheck, Moon, Sun, Coffee, Bed, Car, Heart, Bell } from "lucide-react";
import { aiTomorrowPreview, type TomorrowPreviewResponse, type TomorrowPreviewBlock } from "@/lib/ai-client";
import { FeedbackChips } from "./FeedbackChips";

const KIND_ICON: Record<TomorrowPreviewBlock["kind"], typeof Bed> = {
  sleep: Bed,
  alarm: Bell,
  light: Sun,
  caffeine: Coffee,
  commute: Car,
  winddown: Moon,
  recovery: Heart,
};

const CONF: Record<"low" | "medium" | "high", string> = {
  high: "bg-emerald-500/15 text-emerald-300",
  medium: "bg-amber-500/15 text-amber-300",
  low: "bg-slate-500/15 text-slate-300",
};

const CACHE_KEY = "rp_tomorrow_v1";
const TTL_MIN = 180;

type Cached = { at: number; ctxHash: string; data: TomorrowPreviewResponse };

function readCache(ctx: string): TomorrowPreviewResponse | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const c = JSON.parse(raw) as Cached;
    if (c.ctxHash !== ctx.slice(0, 200)) return null;
    if (Date.now() - c.at > TTL_MIN * 60_000) return null;
    return c.data;
  } catch {
    return null;
  }
}
function writeCache(ctx: string, data: TomorrowPreviewResponse) {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), ctxHash: ctx.slice(0, 200), data } satisfies Cached));
  } catch { /* ignore */ }
}

export function TomorrowPreviewCard({
  signedIn,
  context,
  enabled = true,
}: {
  signedIn: boolean;
  context: string;
  enabled?: boolean;
}) {
  const [data, setData] = useState<TomorrowPreviewResponse | null>(() => readCache(context));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load(force = false) {
    if (!signedIn || !enabled) return;
    if (!force) {
      const cached = readCache(context);
      if (cached) { setData(cached); return; }
    }
    setLoading(true);
    setError(null);
    try {
      const res = await aiTomorrowPreview({ context });
      setData(res);
      writeCache(context, res);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load tomorrow's plan.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (signedIn && enabled && !data) load(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signedIn, enabled]);

  if (!signedIn || !enabled) return null;

  return (
    <section className="rounded-[28px] border border-indigo-glow/25 bg-card/70 p-5 backdrop-blur">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-indigo-glow/15 text-indigo-glow">
            <CalendarClock className="h-3.5 w-3.5" />
          </span>
          <p className="text-[10px] font-semibold uppercase tracking-[0.25em] text-indigo-glow">
            Tomorrow, already planned
          </p>
        </div>
        <button
          onClick={() => load(true)}
          disabled={loading}
          aria-label="Refresh tomorrow"
          className="flex h-8 w-8 items-center justify-center rounded-full bg-secondary/60 text-muted-foreground transition hover:text-foreground disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
        </button>
      </header>

      {!data && loading && (
        <div className="mt-4 space-y-2">
          <div className="h-6 w-3/4 animate-pulse rounded bg-secondary" />
          <div className="h-4 w-full animate-pulse rounded bg-secondary/70" />
          <div className="h-16 w-full animate-pulse rounded-xl bg-secondary/60" />
        </div>
      )}

      {error && !data && (
        <div className="mt-4 text-sm text-muted-foreground">
          <p>{error}</p>
          <button onClick={() => load(true)} className="mt-2 text-sm font-semibold text-primary">Try again</button>
        </div>
      )}

      {data && (
        <div className="mt-3 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1 rounded-full bg-primary/15 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-widest text-primary">
              <Sparkles className="h-3 w-3" /> Plan ready
            </span>
            {data.confidence && (
              <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-widest ${CONF[data.confidence]}`}>
                <ShieldCheck className="h-3 w-3" /> {data.confidence} confidence
              </span>
            )}
          </div>
          <h3 className="text-lg font-semibold leading-snug" style={{ fontFamily: "var(--font-display)" }}>
            {data.headline}
          </h3>
          <p className="text-sm leading-snug text-muted-foreground">{data.summary}</p>

          <ul className="mt-2 space-y-2">
            {data.blocks.map((b, i) => {
              const Icon = KIND_ICON[b.kind] ?? Bed;
              return (
                <li key={i} className="flex gap-3 rounded-2xl border border-border/60 bg-background/40 p-3">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                    <Icon className="h-4 w-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <p className="text-sm font-semibold">{b.title}</p>
                      <p className="text-xs text-muted-foreground">{b.when}</p>
                    </div>
                    <p className="mt-0.5 text-xs leading-snug text-muted-foreground">{b.detail}</p>
                  </div>
                </li>
              );
            })}
          </ul>

          <FeedbackChips recommendationId={data.recommendationId} signedIn={signedIn} />
        </div>
      )}
    </section>
  );
}
