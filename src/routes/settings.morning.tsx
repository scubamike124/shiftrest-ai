// Slice 6 — Morning Brief settings. Reorder, hide, and set commute baseline.
// Mobile-first, no third-party calls; addresses stay private in Wave A.

import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, ChevronDown, ChevronUp, Eye, EyeOff } from "lucide-react";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DEFAULT_BRIEF_LAYOUT, fetchPrefs, savePrefs, type Prefs } from "@/lib/prefs";
import type { BriefCardId } from "@/lib/morning/types";

export const Route = createFileRoute("/settings/morning")({
  head: () => ({
    meta: [
      { title: "Morning Brief settings | RestPilot AI" },
      { name: "description", content: "Choose which Morning Brief cards appear and in what order." },
    ],
  }),
  component: MorningSettings,
});

const LABELS: Record<BriefCardId, string> = {
  sleep: "Sleep last night",
  alarm: "Smart Alarm",
  weather: "Weather",
  longclock: "Today's schedule",
  departure: "Departure time",
  tip: "AI tip",
  motivation: "Daily motivation",
};

function MorningSettings() {
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [order, setOrder] = useState<BriefCardId[]>(DEFAULT_BRIEF_LAYOUT.order as BriefCardId[]);
  const [hidden, setHidden] = useState<Set<BriefCardId>>(
    new Set(DEFAULT_BRIEF_LAYOUT.hidden as BriefCardId[]),
  );
  const [home, setHome] = useState("");
  const [work, setWork] = useState("");
  const [commute, setCommute] = useState<string>("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchPrefs().then((p) => {
      if (cancelled) return;
      setPrefs(p);
      setOrder((p.briefLayout.order as BriefCardId[]).filter(isCardId));
      setHidden(new Set((p.briefLayout.hidden as BriefCardId[]).filter(isCardId)));
      setHome(p.homeAddress ?? "");
      setWork(p.workAddress ?? "");
      setCommute(p.commuteMinutesBaseline != null ? String(p.commuteMinutesBaseline) : "");
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const dirty = useMemo(() => {
    if (!prefs) return false;
    if (JSON.stringify(prefs.briefLayout.order) !== JSON.stringify(order)) return true;
    if (JSON.stringify([...prefs.briefLayout.hidden].sort()) !== JSON.stringify([...hidden].sort()))
      return true;
    if ((prefs.homeAddress ?? "") !== home) return true;
    if ((prefs.workAddress ?? "") !== work) return true;
    const cm = commute.trim() === "" ? null : Number(commute);
    if (prefs.commuteMinutesBaseline !== cm) return true;
    return false;
  }, [prefs, order, hidden, home, work, commute]);

  function move(id: BriefCardId, dir: -1 | 1) {
    setOrder((arr) => {
      const i = arr.indexOf(id);
      if (i < 0) return arr;
      const j = i + dir;
      if (j < 0 || j >= arr.length) return arr;
      const next = arr.slice();
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  }

  function toggleHidden(id: BriefCardId) {
    setHidden((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function onSave() {
    setSaving(true);
    try {
      const cm = commute.trim() === "" ? null : Math.max(1, Math.min(180, Math.round(Number(commute))));
      await savePrefs({
        briefLayout: { order, hidden: [...hidden] },
        homeAddress: home.trim() || null,
        workAddress: work.trim() || null,
        commuteMinutesBaseline: Number.isFinite(cm as number) ? (cm as number | null) : null,
      });
      toast.success("Morning Brief updated");
      setPrefs((p) => (p ? { ...p, briefLayout: { order, hidden: [...hidden] }, homeAddress: home || null, workAddress: work || null, commuteMinutesBaseline: cm } : p));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-5 pb-16 pt-6">
      <header className="flex items-center gap-2">
        <Link to="/companion" className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border/60">
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div>
          <h1 className="text-lg font-semibold">Morning Brief</h1>
          <p className="text-xs text-muted-foreground">Choose which cards appear and in what order.</p>
        </div>
      </header>

      <Card className="p-3">
        <ul className="flex flex-col gap-2">
          {order.map((id, i) => (
            <li
              key={id}
              className="flex items-center gap-2 rounded-md border border-border/60 bg-background/40 p-2"
            >
              <div className="flex flex-col">
                <button
                  type="button"
                  aria-label={`Move ${LABELS[id]} up`}
                  onClick={() => move(id, -1)}
                  disabled={i === 0}
                  className="rounded p-1 text-muted-foreground hover:bg-muted disabled:opacity-30"
                >
                  <ChevronUp className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  aria-label={`Move ${LABELS[id]} down`}
                  onClick={() => move(id, 1)}
                  disabled={i === order.length - 1}
                  className="rounded p-1 text-muted-foreground hover:bg-muted disabled:opacity-30"
                >
                  <ChevronDown className="h-3.5 w-3.5" />
                </button>
              </div>
              <span className="flex-1 text-sm">{LABELS[id]}</span>
              <button
                type="button"
                onClick={() => toggleHidden(id)}
                aria-label={hidden.has(id) ? `Show ${LABELS[id]}` : `Hide ${LABELS[id]}`}
                className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border/60 text-muted-foreground hover:bg-muted"
              >
                {hidden.has(id) ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </li>
          ))}
        </ul>
      </Card>

      <Card className="flex flex-col gap-3 p-4">
        <h2 className="text-sm font-semibold">Commute (optional)</h2>
        <p className="text-xs text-muted-foreground">
          Used to show a "Leave by" time before your first event. Addresses stay on your account — no map service is contacted in this release.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1">
            <Label htmlFor="home" className="text-xs">Home</Label>
            <Input id="home" value={home} onChange={(e) => setHome(e.target.value)} placeholder="123 Main St" />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="work" className="text-xs">Work</Label>
            <Input id="work" value={work} onChange={(e) => setWork(e.target.value)} placeholder="Hospital, Station…" />
          </div>
          <div className="flex flex-col gap-1 sm:col-span-2">
            <Label htmlFor="commute" className="text-xs">Typical drive (minutes)</Label>
            <Input
              id="commute"
              inputMode="numeric"
              value={commute}
              onChange={(e) => setCommute(e.target.value.replace(/[^0-9]/g, ""))}
              placeholder="25"
            />
          </div>
        </div>
      </Card>

      <div className="sticky bottom-3 z-10 flex justify-end">
        <Button onClick={onSave} disabled={!dirty || saving}>
          {saving ? "Saving…" : "Save changes"}
        </Button>
      </div>
    </main>
  );
}

function isCardId(s: string): s is BriefCardId {
  return ["sleep", "alarm", "weather", "longclock", "departure", "tip", "motivation"].includes(s);
}
