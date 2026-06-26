import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import {
  ChevronLeft,
  Sparkles,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Bed,
  Loader2,
} from "lucide-react";
import { DAYS, fetchShifts, parseTime, fmt, type Shift } from "@/lib/shifts";
import { fetchEmployers } from "@/lib/employers";
import { fetchPrefs } from "@/lib/prefs";
import { computeInsights } from "@/lib/insights";
import { toast } from "sonner";

export const Route = createFileRoute("/swap")({
  head: () => ({
    meta: [
      { title: "Shift Swap Copilot — RestPilot AI" },
      {
        name: "description",
        content:
          "Get an AI-calculated recovery cost and optimal nap plan for a proposed shift swap.",
      },
    ],
  }),
  component: SwapPage,
});

type SwapResult = {
  verdict: "take_it" | "take_with_caveats" | "skip_it";
  verdict_label: string;
  cost: "low" | "medium" | "high";
  cost_reason: string;
  risks: string[];
  naps: { time: string; duration_min: number; why: string }[];
  summary: string;
};

function SwapPage() {
  const [day, setDay] = useState(0);
  const [start, setStart] = useState("19:00");
  const [end, setEnd] = useState("07:00");
  const [result, setResult] = useState<SwapResult | null>(null);
  const [loading, setLoading] = useState(false);

  async function analyze() {
    setLoading(true);
    setResult(null);
    try {
      const current = await fetchShifts();
      const prefs = await fetchPrefs();
      const employers = await fetchEmployers();
      const insights = computeInsights(current, prefs, new Date(), employers);
      const empName = (id?: string | null) =>
        id ? employers.find((e) => e.id === id)?.name : undefined;

      const context = `Proposed extra shift: ${DAYS[day]} ${fmt(parseTime(start))}–${fmt(parseTime(end))}.

Current week:
${
  current.length === 0
    ? "(empty — only this proposed shift)"
    : current
        .map(
          (s: Shift) =>
            `- ${DAYS[s.day]} ${fmt(s.start)}–${fmt(s.end)}${
              empName(s.employerId) ? ` @ ${empName(s.employerId)}` : ""
            }${s.title ? ` (${s.title})` : ""}`,
        )
        .join("\n")
}

User state: ${insights.contextString}`;

      const resp = await fetch("/api/swap", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ context }),
      });

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ error: "Request failed" }));
        toast.error(err.error || "Analysis failed");
        return;
      }
      const data = (await resp.json()) as SwapResult;
      setResult(data);
    } catch (e) {
      console.error(e);
      toast.error("Network error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex flex-col gap-5 px-5 pt-12 pb-6">
      <Link to="/plan" className="flex items-center gap-1 text-sm text-muted-foreground">
        <ChevronLeft className="h-4 w-4" /> Back to Plan
      </Link>
      <header>
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-indigo-glow">
          Shift Swap Copilot
        </p>
        <h1 className="mt-2 text-3xl leading-tight" style={{ fontFamily: "var(--font-display)" }}>
          Should you take it?
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Punch in a proposed shift. AI weighs the recovery cost against your week.
        </p>
      </header>

      <section className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4">
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-muted-foreground">Day</span>
          <select
            value={day}
            onChange={(e) => setDay(Number(e.target.value))}
            className="h-12 rounded-xl border border-border bg-input px-3 text-sm font-semibold"
          >
            {DAYS.map((d, i) => (
              <option key={d} value={i}>
                {d}
              </option>
            ))}
          </select>
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">Starts</span>
            <input
              type="time"
              value={start}
              onChange={(e) => setStart(e.target.value)}
              className="h-12 rounded-xl border border-border bg-input px-3 text-base font-semibold"
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">Ends</span>
            <input
              type="time"
              value={end}
              onChange={(e) => setEnd(e.target.value)}
              className="h-12 rounded-xl border border-border bg-input px-3 text-base font-semibold"
            />
          </label>
        </div>
      </section>

      <button
        onClick={analyze}
        disabled={loading}
        className="flex h-14 items-center justify-center gap-2 rounded-2xl bg-primary text-base font-semibold text-primary-foreground shadow-[var(--shadow-glow)] disabled:opacity-50 active:scale-[0.99]"
      >
        {loading ? (
          <>
            <Loader2 className="h-5 w-5 animate-spin" /> Analyzing your week…
          </>
        ) : (
          <>
            <Sparkles className="h-5 w-5" /> Analyze swap
          </>
        )}
      </button>

      {result && <SwapResultCard result={result} />}
    </main>
  );
}

function SwapResultCard({ result }: { result: SwapResult }) {
  const verdictMeta =
    result.verdict === "take_it"
      ? { icon: CheckCircle2, color: "var(--mint)", bg: "color-mix(in srgb, var(--mint) 14%, var(--card))" }
      : result.verdict === "skip_it"
      ? { icon: XCircle, color: "var(--destructive)", bg: "color-mix(in srgb, var(--destructive) 14%, var(--card))" }
      : { icon: AlertTriangle, color: "var(--amber)", bg: "color-mix(in srgb, var(--amber) 14%, var(--card))" };
  const VerdictIcon = verdictMeta.icon;

  const costColor =
    result.cost === "high"
      ? "var(--destructive)"
      : result.cost === "medium"
      ? "var(--amber)"
      : "var(--mint)";

  return (
    <div className="flex flex-col gap-4">
      <section
        className="rounded-2xl border p-5"
        style={{ borderColor: verdictMeta.color, background: verdictMeta.bg }}
      >
        <div className="flex items-center gap-3">
          <VerdictIcon className="h-6 w-6" style={{ color: verdictMeta.color }} />
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
              AI Verdict
            </p>
            <p className="text-xl font-bold" style={{ color: verdictMeta.color }}>
              {result.verdict_label}
            </p>
          </div>
        </div>
        <p className="mt-3 text-sm leading-relaxed">{result.summary}</p>
      </section>

      <section className="rounded-2xl border border-border bg-card p-4">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-indigo-glow">
          Recovery Cost
        </p>
        <p className="mt-1 text-2xl capitalize" style={{ fontFamily: "var(--font-display)", color: costColor }}>
          {result.cost}
        </p>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{result.cost_reason}</p>
      </section>

      {result.risks?.length > 0 && (
        <section className="rounded-2xl border border-border bg-card p-4">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-indigo-glow">
            Risk factors
          </p>
          <ul className="mt-2 flex flex-col gap-2">
            {result.risks.map((r, i) => (
              <li key={i} className="flex gap-2 text-sm leading-snug">
                <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-amber" />
                {r}
              </li>
            ))}
          </ul>
        </section>
      )}

      {result.naps?.length > 0 && (
        <section className="rounded-2xl border border-border bg-card p-4">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-indigo-glow">
            Strategic naps
          </p>
          <ul className="mt-2 flex flex-col gap-3">
            {result.naps.map((n, i) => (
              <li key={i} className="flex gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/15 text-indigo-glow">
                  <Bed className="h-4 w-4" />
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-semibold">
                    {n.time} · {n.duration_min} min
                  </p>
                  <p className="text-xs leading-relaxed text-muted-foreground">{n.why}</p>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
