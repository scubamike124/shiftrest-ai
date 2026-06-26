import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { ChevronLeft, Sparkles } from "lucide-react";
import { DAYS, fetchShifts, parseTime, fmt, type Shift } from "@/lib/shifts";
import { fetchPrefs } from "@/lib/prefs";
import { toast } from "sonner";

export const Route = createFileRoute("/swap")({
  head: () => ({
    meta: [
      { title: "Shift Swap Copilot — ShiftRest AI" },
      {
        name: "description",
        content:
          "Get an AI-calculated recovery cost and optimal nap plan for a proposed shift swap.",
      },
    ],
  }),
  component: SwapPage,
});

function SwapPage() {
  const [day, setDay] = useState(0);
  const [start, setStart] = useState("19:00");
  const [end, setEnd] = useState("07:00");
  const [analysis, setAnalysis] = useState("");
  const [loading, setLoading] = useState(false);

  async function analyze() {
    setLoading(true);
    setAnalysis("");
    try {
      const current = await fetchShifts();
      const prefs = await fetchPrefs();
      const proposed = {
        day: DAYS[day],
        start: fmt(parseTime(start)),
        end: fmt(parseTime(end)),
      };
      const prompt = `A shift worker is considering picking up an EXTRA shift.

Current week:
${
  current.length === 0
    ? "(empty — only this proposed shift)"
    : current.map((s: Shift) => `- ${DAYS[s.day]} ${fmt(s.start)}–${fmt(s.end)}`).join("\n")
}

Proposed extra shift: ${proposed.day} ${proposed.start}–${proposed.end}

Preferences: ${prefs.sleepHours}h target sleep, ${prefs.windDownMin}min wind-down.

Give a TIGHT analysis with these exact sections:
1. Recovery cost (Low / Medium / High) + 1-sentence why.
2. Risk factors (bullets, max 4).
3. Optimal nap plan around this shift (bullets, max 3, with times).
4. Verdict: take it / take it with caveats / skip it.

Keep it under 180 words.`;

      const resp = await fetch("/api/coach", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [{ role: "user", content: prompt }],
        }),
      });

      if (!resp.ok || !resp.body) {
        const err = await resp.json().catch(() => ({ error: "Request failed" }));
        toast.error(err.error || "Analysis failed");
        return;
      }

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let out = "";
      let done = false;
      while (!done) {
        const { done: rDone, value } = await reader.read();
        if (rDone) break;
        buffer += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = buffer.indexOf("\n")) !== -1) {
          let line = buffer.slice(0, nl);
          buffer = buffer.slice(nl + 1);
          if (line.endsWith("\r")) line = line.slice(0, -1);
          if (!line.startsWith("data: ")) continue;
          const json = line.slice(6).trim();
          if (json === "[DONE]") {
            done = true;
            break;
          }
          try {
            const parsed = JSON.parse(json);
            const chunk = parsed.choices?.[0]?.delta?.content as string | undefined;
            if (chunk) {
              out += chunk;
              setAnalysis(out);
            }
          } catch {
            buffer = line + "\n" + buffer;
            break;
          }
        }
      }
    } catch (e) {
      console.error(e);
      toast.error("Network error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex flex-col gap-5 px-5 pt-12">
      <Link to="/plan" className="flex items-center gap-1 text-sm text-muted-foreground">
        <ChevronLeft className="h-4 w-4" /> Back to Plan
      </Link>
      <header>
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">
          Shift Swap Copilot
        </p>
        <h1 className="mt-2 text-3xl font-bold leading-tight">
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
        <Sparkles className="h-5 w-5" /> {loading ? "Analyzing…" : "Analyze swap"}
      </button>

      {analysis && (
        <div className="whitespace-pre-wrap rounded-2xl border border-border bg-card p-4 text-sm leading-relaxed">
          {analysis}
        </div>
      )}
    </main>
  );
}
