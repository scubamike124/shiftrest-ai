// Slice 7 — Daily Companion settings. Extends the Morning Brief settings
// with per-period enable toggles, per-period layout, and a link back to
// the legacy /settings/morning page for the morning-only layout.

import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, ChevronDown, ChevronUp, Eye, EyeOff } from "lucide-react";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  DEFAULT_AFTERNOON_LAYOUT,
  DEFAULT_BRIEF_ENABLED,
  DEFAULT_BRIEF_LAYOUT,
  DEFAULT_EVENING_LAYOUT,
  fetchPrefs,
  savePrefs,
  type Prefs,
} from "@/lib/prefs";
import type { BriefCardId } from "@/lib/morning/types";
import type { AfternoonCardId, EveningCardId } from "@/lib/companion/types";
import {
  loadLocalPrefs,
  saveLocalPrefs,
  type CompanionLocalPrefs,
} from "@/lib/companion/voice-action-prefs";

export const Route = createFileRoute("/settings/companion")({
  head: () => ({
    meta: [
      { title: "Daily Companion settings | RestPilot AI" },
      {
        name: "description",
        content:
          "Enable Morning, Afternoon, and Evening briefings, reorder cards, and tune your Companion.",
      },
    ],
  }),
  component: CompanionSettings,
});

const MORNING_LABELS: Record<BriefCardId, string> = {
  sleep: "Sleep last night",
  alarm: "Smart Alarm",
  weather: "Weather",
  longclock: "Today's schedule",
  departure: "Departure time",
  tip: "AI tip",
  motivation: "Daily motivation",
};

const AFTERNOON_LABELS: Record<AfternoonCardId, string> = {
  remaining: "Rest of today",
  nextTraffic: "Next appointment / traffic",
  weatherShift: "Weather changes",
  workingLate: "Working late nudge",
  hydration: "Hydration reminder",
  movement: "Movement reminder",
  battery: "Battery reminder",
};

const EVENING_LABELS: Record<EveningCardId, string> = {
  tomorrowFirst: "Tomorrow's first event",
  tomorrowWeather: "Tomorrow's weather",
  clothing: "Clothing suggestion",
  smartAlarm: "Smart Alarm recommendation",
  bedtime: "Suggested bedtime",
  prep: "Calendar prep",
  travel: "Travel reminder",
  summary: "AI evening summary",
  windDown: "Wind-down reminder",
};

function move<T extends string>(arr: T[], id: T, dir: -1 | 1): T[] {
  const i = arr.indexOf(id);
  if (i < 0) return arr;
  const j = i + dir;
  if (j < 0 || j >= arr.length) return arr;
  const next = arr.slice();
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}

function LayoutEditor<T extends string>({
  order,
  hidden,
  labels,
  onMove,
  onToggle,
}: {
  order: T[];
  hidden: Set<T>;
  labels: Record<T, string>;
  onMove: (id: T, dir: -1 | 1) => void;
  onToggle: (id: T) => void;
}) {
  return (
    <ul className="flex flex-col gap-2">
      {order.map((id, i) => (
        <li
          key={id}
          className="flex items-center gap-2 rounded-md border border-border/60 bg-background/40 p-2"
        >
          <div className="flex flex-col">
            <button
              type="button"
              aria-label={`Move ${labels[id]} up`}
              onClick={() => onMove(id, -1)}
              disabled={i === 0}
              className="rounded p-1 text-muted-foreground hover:bg-muted disabled:opacity-30"
            >
              <ChevronUp className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              aria-label={`Move ${labels[id]} down`}
              onClick={() => onMove(id, 1)}
              disabled={i === order.length - 1}
              className="rounded p-1 text-muted-foreground hover:bg-muted disabled:opacity-30"
            >
              <ChevronDown className="h-3.5 w-3.5" />
            </button>
          </div>
          <span className="flex-1 text-sm">{labels[id]}</span>
          <button
            type="button"
            onClick={() => onToggle(id)}
            aria-label={hidden.has(id) ? `Show ${labels[id]}` : `Hide ${labels[id]}`}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border/60 text-muted-foreground hover:bg-muted"
          >
            {hidden.has(id) ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </li>
      ))}
    </ul>
  );
}

function CompanionSettings() {
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [enabled, setEnabled] = useState(DEFAULT_BRIEF_ENABLED);

  const [mOrder, setMOrder] = useState<BriefCardId[]>(DEFAULT_BRIEF_LAYOUT.order as BriefCardId[]);
  const [mHidden, setMHidden] = useState<Set<BriefCardId>>(new Set(DEFAULT_BRIEF_LAYOUT.hidden as BriefCardId[]));

  const [aOrder, setAOrder] = useState<AfternoonCardId[]>(DEFAULT_AFTERNOON_LAYOUT.order as AfternoonCardId[]);
  const [aHidden, setAHidden] = useState<Set<AfternoonCardId>>(new Set(DEFAULT_AFTERNOON_LAYOUT.hidden as AfternoonCardId[]));

  const [eOrder, setEOrder] = useState<EveningCardId[]>(DEFAULT_EVENING_LAYOUT.order as EveningCardId[]);
  const [eHidden, setEHidden] = useState<Set<EveningCardId>>(new Set(DEFAULT_EVENING_LAYOUT.hidden as EveningCardId[]));

  const [commute, setCommute] = useState<string>("");
  const [home, setHome] = useState("");
  const [work, setWork] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchPrefs().then((p) => {
      if (cancelled) return;
      setPrefs(p);
      setEnabled(p.briefEnabled);
      setMOrder((p.briefLayout.order as BriefCardId[]).filter((s): s is BriefCardId => s in MORNING_LABELS));
      setMHidden(new Set((p.briefLayout.hidden as BriefCardId[]).filter((s): s is BriefCardId => s in MORNING_LABELS)));
      setAOrder((p.afternoonLayout.order as AfternoonCardId[]).filter((s): s is AfternoonCardId => s in AFTERNOON_LABELS));
      setAHidden(new Set((p.afternoonLayout.hidden as AfternoonCardId[]).filter((s): s is AfternoonCardId => s in AFTERNOON_LABELS)));
      setEOrder((p.eveningLayout.order as EveningCardId[]).filter((s): s is EveningCardId => s in EVENING_LABELS));
      setEHidden(new Set((p.eveningLayout.hidden as EveningCardId[]).filter((s): s is EveningCardId => s in EVENING_LABELS)));
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
    if (JSON.stringify(prefs.briefEnabled) !== JSON.stringify(enabled)) return true;
    if (JSON.stringify(prefs.briefLayout.order) !== JSON.stringify(mOrder)) return true;
    if (JSON.stringify([...prefs.briefLayout.hidden].sort()) !== JSON.stringify([...mHidden].sort())) return true;
    if (JSON.stringify(prefs.afternoonLayout.order) !== JSON.stringify(aOrder)) return true;
    if (JSON.stringify([...prefs.afternoonLayout.hidden].sort()) !== JSON.stringify([...aHidden].sort())) return true;
    if (JSON.stringify(prefs.eveningLayout.order) !== JSON.stringify(eOrder)) return true;
    if (JSON.stringify([...prefs.eveningLayout.hidden].sort()) !== JSON.stringify([...eHidden].sort())) return true;
    if ((prefs.homeAddress ?? "") !== home) return true;
    if ((prefs.workAddress ?? "") !== work) return true;
    const cm = commute.trim() === "" ? null : Number(commute);
    if (prefs.commuteMinutesBaseline !== cm) return true;
    return false;
  }, [prefs, enabled, mOrder, mHidden, aOrder, aHidden, eOrder, eHidden, home, work, commute]);

  async function onSave() {
    setSaving(true);
    try {
      const cm = commute.trim() === "" ? null : Math.max(1, Math.min(180, Math.round(Number(commute))));
      await savePrefs({
        briefEnabled: enabled,
        briefLayout: { order: mOrder, hidden: [...mHidden] },
        afternoonLayout: { order: aOrder, hidden: [...aHidden] },
        eveningLayout: { order: eOrder, hidden: [...eHidden] },
        homeAddress: home.trim() || null,
        workAddress: work.trim() || null,
        commuteMinutesBaseline: Number.isFinite(cm as number) ? (cm as number | null) : null,
      });
      toast.success("Daily Companion updated");
      const next = await fetchPrefs();
      setPrefs(next);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-5 pb-24 pt-6">
      <header className="flex items-center gap-2">
        <Link to="/companion" className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border/60">
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div>
          <h1 className="text-lg font-semibold">Daily Companion</h1>
          <p className="text-xs text-muted-foreground">
            Choose which briefings appear, reorder cards, and tune your commute baseline.
          </p>
        </div>
      </header>

      <Card className="p-4">
        <h2 className="text-sm font-semibold">Briefings</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          The Companion automatically picks the right briefing based on your local time.
        </p>
        <div className="mt-3 flex flex-col gap-3">
          {(["morning", "afternoon", "evening"] as const).map((p) => (
            <div key={p} className="flex items-center justify-between gap-3">
              <Label htmlFor={`enable-${p}`} className="text-sm capitalize">
                {p} brief
              </Label>
              <Switch
                id={`enable-${p}`}
                checked={enabled[p]}
                onCheckedChange={(v) => setEnabled((cur) => ({ ...cur, [p]: v }))}
              />
            </div>
          ))}
        </div>
      </Card>

      <Card className="p-3">
        <p className="px-1 pb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Morning cards
        </p>
        <LayoutEditor<BriefCardId>
          order={mOrder}
          hidden={mHidden}
          labels={MORNING_LABELS}
          onMove={(id, d) => setMOrder((o) => move(o, id, d))}
          onToggle={(id) => setMHidden((s) => toggle(s, id))}
        />
      </Card>

      <Card className="p-3">
        <p className="px-1 pb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Afternoon cards
        </p>
        <LayoutEditor<AfternoonCardId>
          order={aOrder}
          hidden={aHidden}
          labels={AFTERNOON_LABELS}
          onMove={(id, d) => setAOrder((o) => move(o, id, d))}
          onToggle={(id) => setAHidden((s) => toggle(s, id))}
        />
      </Card>

      <Card className="p-3">
        <p className="px-1 pb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Evening cards
        </p>
        <LayoutEditor<EveningCardId>
          order={eOrder}
          hidden={eHidden}
          labels={EVENING_LABELS}
          onMove={(id, d) => setEOrder((o) => move(o, id, d))}
          onToggle={(id) => setEHidden((s) => toggle(s, id))}
        />
      </Card>

      <VoiceActionsCard />


      <Card className="flex flex-col gap-3 p-4">
        <h2 className="text-sm font-semibold">Commute (optional)</h2>
        <p className="text-xs text-muted-foreground">
          Used for "leave by" estimates in Morning and Afternoon briefs.
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

function toggle<T>(s: Set<T>, id: T): Set<T> {
  const next = new Set(s);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

function VoiceActionsCard() {
  const [p, setP] = useState<import("@/lib/companion/voice-action-prefs").CompanionLocalPrefs>(() =>
    require_("@/lib/companion/voice-action-prefs").loadLocalPrefs(),
  );
  const update = (
    patch: Partial<import("@/lib/companion/voice-action-prefs").CompanionLocalPrefs>,
  ) => {
    const next = require_("@/lib/companion/voice-action-prefs").saveLocalPrefs(patch);
    setP(next);
  };
  const qh = p.quietHours;
  return (
    <Card className="flex flex-col gap-3 p-4">
      <div>
        <h2 className="text-sm font-semibold">Companion voice &amp; actions</h2>
        <p className="text-xs text-muted-foreground">
          Saved on this device only. Microphone is only used when you tap it — no background listening, no
          always-on recording. Companion actions always ask for confirmation before they run.
        </p>
      </div>
      <Row label="Voice input" hint="Show the mic button on the Companion composer.">
        <Switch checked={p.voiceInputEnabled} onCheckedChange={(v) => update({ voiceInputEnabled: v })} />
      </Row>
      <Row label="Voice replies" hint="Speak the Companion's replies aloud (uses TTS credits).">
        <Switch checked={p.voiceRepliesEnabled} onCheckedChange={(v) => update({ voiceRepliesEnabled: v })} />
      </Row>
      <Row label="Action suggestions" hint="Let the Companion propose actions like starting a sound.">
        <Switch checked={p.actionSuggestionsEnabled} onCheckedChange={(v) => update({ actionSuggestionsEnabled: v })} />
      </Row>
      <Row label="Always confirm" hint="Require Confirm before any action runs.">
        <Switch
          checked={p.requireActionConfirmation}
          onCheckedChange={(v) => update({ requireActionConfirmation: v })}
        />
      </Row>
      <div className="rounded-lg border border-border/60 bg-muted/30 p-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium">Quiet hours for voice</p>
            <p className="text-xs text-muted-foreground">Voice replies stay silent during these hours.</p>
          </div>
          <Switch
            checked={Boolean(qh)}
            onCheckedChange={(v) =>
              update({ quietHours: v ? { start: "22:00", end: "07:00" } : null })
            }
          />
        </div>
        {qh && (
          <div className="mt-3 grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <Label className="text-xs" htmlFor="qh-start">Start</Label>
              <Input
                id="qh-start"
                type="time"
                value={qh.start}
                onChange={(e) => update({ quietHours: { ...qh, start: e.target.value } })}
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label className="text-xs" htmlFor="qh-end">End</Label>
              <Input
                id="qh-end"
                type="time"
                value={qh.end}
                onChange={(e) => update({ quietHours: { ...qh, end: e.target.value } })}
              />
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div>
        <p className="text-sm font-medium">{label}</p>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </div>
      {children}
    </div>
  );
}

// Local dynamic import shim so the settings page doesn't get bundled with the
// localStorage helpers until needed.
function require_<T = unknown>(_: string): T {
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  return require(_) as T;
}
