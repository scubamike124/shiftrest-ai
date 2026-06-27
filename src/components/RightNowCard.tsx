import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Sparkles, AlertCircle, Clock, ArrowRight, RefreshCw, ShieldCheck, Info } from "lucide-react";
import { aiRightNow, type RightNowResponse } from "@/lib/ai-client";

const CONFIDENCE_TONE: Record<NonNullable<RightNowResponse["confidence"]>, string> = {
  high: "bg-emerald-500/15 text-emerald-300",
  medium: "bg-amber-500/15 text-amber-300",
  low: "bg-slate-500/15 text-slate-300",
};

function fmtWindow(w?: { startIso: string; endIso: string }): string | null {
  if (!w) return null;
  try {
    const s = new Date(w.startIso);
    const e = new Date(w.endIso);
    if (isNaN(s.getTime()) || isNaN(e.getTime())) return null;
    const f = (d: Date) =>
      d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    return `${f(s)} – ${f(e)}`;
  } catch {
    return null;
  }
}

const CACHE_KEY = "rp_rightnow_v1";
const CACHE_TTL_MIN = 15;

type CachedShape = { at: number; hour: number; ctx: string; data: RightNowResponse };

function readCache(currentHour: number, ctxFingerprint: string): RightNowResponse | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const c = JSON.parse(raw) as CachedShape;
    if (c.hour !== currentHour || c.ctx !== ctxFingerprint) return null;
    if (Date.now() - c.at > CACHE_TTL_MIN * 60_000) return null;
    return c.data;
  } catch {
    return null;
  }
}

function writeCache(currentHour: number, ctxFingerprint: string, data: RightNowResponse) {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(
      CACHE_KEY,
      JSON.stringify({ at: Date.now(), hour: currentHour, ctx: ctxFingerprint, data } satisfies CachedShape),
    );
  } catch {
    /* quota — ignore */
  }
}

const URGENCY_TONE: Record<RightNowResponse["urgency"], { ring: string; tag: string; label: string }> = {
  now: { ring: "shadow-[0_0_0_1px_rgba(244,114,182,0.55),0_24px_60px_-20px_rgba(244,114,182,0.55)]", tag: "bg-rose-500/15 text-rose-300", label: "Do this now" },
  soon: { ring: "shadow-[0_0_0_1px_rgba(99,102,241,0.45),0_24px_60px_-20px_rgba(99,102,241,0.55)]", tag: "bg-indigo-500/15 text-indigo-300", label: "Do this soon" },
  later: { ring: "shadow-[0_0_0_1px_rgba(148,163,184,0.35),0_20px_50px_-25px_rgba(148,163,184,0.45)]", tag: "bg-slate-500/15 text-slate-300", label: "Plan for later" },
};

export function RightNowCard({
  signedIn,
  context,
}: {
  signedIn: boolean;
  context: string;
}) {
  const hour = useMemo(() => new Date().getHours(), []);
  const ctxFingerprint = useMemo(() => context.slice(0, 200), [context]);
  const [data, setData] = useState<RightNowResponse | null>(() => readCache(hour, ctxFingerprint));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load(force = false) {
    if (!signedIn) return;
    if (!force) {
      const cached = readCache(hour, ctxFingerprint);
      if (cached) {
        setData(cached);
        return;
      }
    }
    setLoading(true);
    setError(null);
    try {
      const res = await aiRightNow({ context });
      setData(res);
      writeCache(hour, ctxFingerprint, res);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load coach guidance.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (signedIn && !data) load(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signedIn, ctxFingerprint]);

  if (!signedIn) {
    return (
      <section className="relative overflow-hidden rounded-[28px] border border-primary/20 bg-card p-6">
        <p className="text-[10px] font-semibold uppercase tracking-[0.25em] text-indigo-glow">Right now</p>
        <p className="mt-2 text-lg font-semibold">Sign in to let RestPilot plan your next move.</p>
        <p className="mt-1 text-sm text-muted-foreground">
          The AI coach analyzes your shift, light, fatigue, and wearable signals to tell you exactly what to do next.
        </p>
        <Link
          to="/auth"
          className="mt-4 inline-flex h-11 items-center gap-2 rounded-xl bg-primary px-5 text-sm font-semibold text-primary-foreground"
        >
          Sign in <ArrowRight className="h-4 w-4" />
        </Link>
      </section>
    );
  }

  const tone = data ? URGENCY_TONE[data.urgency] : URGENCY_TONE.soon;

  return (
    <section
      className={`relative overflow-hidden rounded-[28px] border border-primary/30 p-6 transition-shadow ${tone.ring}`}
      style={{ background: "var(--gradient-hero)" }}
    >
      <div className="absolute -right-16 -top-16 h-40 w-40 rounded-full bg-primary/30 blur-[60px] breathe" />

      <header className="relative z-10 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/20 text-indigo-glow">
            <Sparkles className="h-3.5 w-3.5" />
          </span>
          <p className="text-[10px] font-semibold uppercase tracking-[0.25em] text-indigo-glow">
            Right now · AI Coach
          </p>
        </div>
        <button
          onClick={() => load(true)}
          disabled={loading}
          aria-label="Refresh"
          className="flex h-8 w-8 items-center justify-center rounded-full bg-secondary/60 text-muted-foreground transition hover:text-foreground disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
        </button>
      </header>

      {!data && loading && (
        <div className="relative z-10 mt-4 space-y-3">
          <div className="h-7 w-3/4 animate-pulse rounded-lg bg-secondary" />
          <div className="h-4 w-full animate-pulse rounded bg-secondary/70" />
          <div className="h-4 w-5/6 animate-pulse rounded bg-secondary/70" />
          <div className="h-11 w-40 animate-pulse rounded-xl bg-secondary" />
        </div>
      )}

      {error && !data && (
        <div className="relative z-10 mt-4 text-sm text-muted-foreground">
          <p>{error}</p>
          <button
            onClick={() => load(true)}
            className="mt-2 text-sm font-semibold text-primary"
          >
            Try again
          </button>
        </div>
      )}

      {data && (
        <div className="relative z-10 mt-4 flex flex-col gap-4">
          <div>
            <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-widest ${tone.tag}`}>
              {data.urgency === "now" ? <AlertCircle className="h-3 w-3" /> : <Clock className="h-3 w-3" />}
              {tone.label}
            </span>
            <h2
              className="mt-2 text-2xl leading-tight lg:text-3xl"
              style={{ fontFamily: "var(--font-display)" }}
            >
              {data.action}
            </h2>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-2xl border border-border/60 bg-background/40 p-3">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-indigo-glow">Why</p>
              <p className="mt-1 text-sm leading-snug text-foreground">{data.why}</p>
            </div>
            <div className="rounded-2xl border border-rose-500/20 bg-rose-500/5 p-3">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-rose-300/90">If you skip it</p>
              <p className="mt-1 text-sm leading-snug text-foreground/90">{data.ignoreCost}</p>
            </div>
          </div>

          <Link
            to={data.ctaRoute}
            className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-2xl text-sm font-semibold text-primary-foreground shadow-[var(--shadow-glow)] sm:w-auto sm:self-start sm:px-6"
            style={{ background: "var(--gradient-cta)" }}
          >
            {data.ctaLabel} <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      )}
    </section>
  );
}
