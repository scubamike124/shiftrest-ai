import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Brain,
  Trash2,
  Download,
  AlertTriangle,
  Clock,
  ArrowLeft,
  Pencil,
  Pin,
  PinOff,
  PauseCircle,
  PlayCircle,
  Plus,
} from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import {
  listMemories,
  addMemory,
  updateMemory,
  deleteMemory,
  wipeAllMemories,
  exportMemoriesAsJSON,
  setMemoryEnabled,
  getMemoryEnabled,
  type AIMemory,
  type MemoryCategory,
} from "@/lib/ai-memory";
import {
  listPendingProposals,
  acceptProposal,
  declineProposal,
  getLearningPaused,
  setLearningPaused,
  type MemoryProposal,
} from "@/lib/memory-proposals";
import { ProposalCard } from "@/components/memory/ProposalCard";
import { HowMemoryWorks } from "@/components/memory/HowMemoryWorks";
import { LearningConsentsCard } from "@/components/memory/LearningConsentsCard";
import { RoutineSuggestionCard } from "@/components/memory/RoutineSuggestionCard";
import {
  listPendingRoutineSuggestions,
  acceptRoutineSuggestion,
  dismissRoutineSuggestion,
  snoozeRoutineSuggestion,
  type RoutineSuggestion,
} from "@/lib/memory/suggestions";
import { scanForRoutines } from "@/lib/memory/suggestions.functions";
import { useServerFn } from "@tanstack/react-start";
import { Sparkles } from "lucide-react";

export const Route = createFileRoute("/memory")({
  head: () => ({
    meta: [
      { title: "My Memory — RestPilot AI" },
      {
        name: "description",
        content:
          "Everything RestPilot remembers about you, on one timeline. Review, edit, delete, pause learning, or export — fully under your control.",
      },
    ],
  }),
  component: MemoryPage,
});

// Sleep-domain categories first, then existing ones.
const CATEGORY_SECTIONS: { key: MemoryCategory; label: string }[] = [
  { key: "sleep_habits", label: "Sleep Habits" },
  { key: "alarm_prefs", label: "Alarm Preferences" },
  { key: "favorite_sounds", label: "Favorite Sounds" },
  { key: "daily_routine", label: "Daily Routine" },
  { key: "companion_prefs", label: "Companion Preferences" },
  { key: "schedule", label: "Schedule" },
  { key: "preferences", label: "Preferences" },
  { key: "health", label: "Health" },
  { key: "recovery", label: "Recovery" },
  { key: "caffeine", label: "Caffeine" },
  { key: "employer", label: "Employer" },
  { key: "family", label: "Family" },
  { key: "goals", label: "Goals" },
  { key: "general", label: "Other" },
];

const SECTION_KEYS = CATEGORY_SECTIONS.map((s) => s.key);

const ADD_CATEGORIES: MemoryCategory[] = [
  "sleep_habits",
  "alarm_prefs",
  "favorite_sounds",
  "daily_routine",
  "companion_prefs",
  "preferences",
  "schedule",
  "health",
  "general",
];

function relativeTime(iso: string | null): string {
  if (!iso) return "—";
  const diff = Date.now() - new Date(iso).getTime();
  const d = Math.floor(diff / 86_400_000);
  if (d <= 0) {
    const h = Math.floor(diff / 3_600_000);
    if (h <= 0) return "just now";
    return `${h}h ago`;
  }
  if (d === 1) return "yesterday";
  if (d < 30) return `${d}d ago`;
  const m = Math.floor(d / 30);
  if (m < 12) return `${m}mo ago`;
  return `${Math.floor(d / 365)}y ago`;
}

function whyLabel(m: AIMemory): string {
  switch (m.source) {
    case "derived":
      return "Learned from your patterns";
    case "manual":
      return "You added this";
    case "onboarding":
      return "From onboarding";
    case "chat":
    default:
      return "From a conversation";
  }
}

function MemoryPage() {
  const qc = useQueryClient();
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [paused, setPaused] = useState<boolean>(false);
  const [confirmWipe, setConfirmWipe] = useState(false);

  useEffect(() => {
    void getMemoryEnabled().then(setEnabled);
    void getLearningPaused().then(setPaused);
  }, []);

  const memQ = useQuery<AIMemory[]>({
    queryKey: ["ai-memory", "all"],
    queryFn: () => listMemories({ category: "all" }),
    enabled: Boolean(enabled),
    staleTime: 15_000,
  });

  const proposalsQ = useQuery<MemoryProposal[]>({
    queryKey: ["memory-proposals", "pending"],
    queryFn: listPendingProposals,
    enabled: Boolean(enabled),
    staleTime: 15_000,
  });

  const suggestionsQ = useQuery<RoutineSuggestion[]>({
    queryKey: ["routine-suggestions", "pending"],
    queryFn: listPendingRoutineSuggestions,
    enabled: Boolean(enabled),
    staleTime: 15_000,
  });

  const scanFn = useServerFn(scanForRoutines);
  const scanMut = useMutation({
    mutationFn: () => scanFn({ data: undefined }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["routine-suggestions"] });
      const n = (res as { suggestions_created?: number } | undefined)?.suggestions_created ?? 0;
      toast.success(n > 0 ? `Found ${n} new routine${n === 1 ? "" : "s"}` : "No new routines yet");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Scan failed"),
  });

  const acceptSugMut = useMutation({
    mutationFn: (id: string) => acceptRoutineSuggestion(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["routine-suggestions"] });
      toast.success("Saved as a routine");
    },
  });
  const dismissSugMut = useMutation({
    mutationFn: (id: string) => dismissRoutineSuggestion(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["routine-suggestions"] });
      toast.success("Dismissed");
    },
  });
  const snoozeSugMut = useMutation({
    mutationFn: (id: string) => snoozeRoutineSuggestion(id, 7),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["routine-suggestions"] });
      toast.success("I'll ask again in a week");
    },
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["ai-memory"] });
    qc.invalidateQueries({ queryKey: ["memory-proposals"] });
    qc.invalidateQueries({ queryKey: ["routine-suggestions"] });
    qc.invalidateQueries({ queryKey: ["companion-hints"] });
  };

  const enableMut = useMutation({
    mutationFn: (v: boolean) => setMemoryEnabled(v),
    onSuccess: (_d, v) => {
      setEnabled(v);
      toast.success(v ? "Memory turned on" : "Memory turned off");
      refresh();
    },
    onError: () => toast.error("Could not update memory"),
  });

  const pauseMut = useMutation({
    mutationFn: (v: boolean) => setLearningPaused(v),
    onSuccess: (_d, v) => {
      setPaused(v);
      toast.success(v ? "Learning paused" : "Learning resumed");
    },
    onError: () => toast.error("Could not change learning state"),
  });

  const acceptMut = useMutation({
    mutationFn: (p: MemoryProposal) => acceptProposal(p),
    onSuccess: () => {
      refresh();
      toast.success("Saved to memory");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Couldn't save"),
  });
  const declineMut = useMutation({
    mutationFn: (id: string) => declineProposal(id),
    onSuccess: () => {
      refresh();
      toast.success("Skipped");
    },
  });

  const delMut = useMutation({
    mutationFn: (id: string) => deleteMemory(id),
    onSuccess: () => {
      refresh();
      toast.success("Forgotten");
    },
  });
  const wipeMut = useMutation({
    mutationFn: () => wipeAllMemories(),
    onSuccess: (n) => {
      setConfirmWipe(false);
      refresh();
      toast.success(n === 0 ? "Nothing to wipe" : `Wiped ${n} memories`);
    },
  });

  async function handleExport() {
    const json = await exportMemoriesAsJSON();
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `restpilot-memories-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const grouped = useMemo(() => {
    const map = new Map<MemoryCategory, AIMemory[]>();
    for (const m of memQ.data ?? []) {
      const key = (SECTION_KEYS as string[]).includes(m.category) ? m.category : ("general" as MemoryCategory);
      const arr = map.get(key) ?? [];
      arr.push(m);
      map.set(key, arr);
    }
    return map;
  }, [memQ.data]);

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-6 sm:py-10">
      <Link
        to="/profile"
        className="mb-4 inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> Back to profile
      </Link>

      {/* Header */}
      <header className="rounded-2xl border border-border bg-card p-5 sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              <Brain className="h-3.5 w-3.5" /> My Memory
            </div>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">
              Everything I remember
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Nothing is hidden. Memory is off by default and only grows when you say yes.
            </p>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1">
            <Switch
              checked={Boolean(enabled)}
              disabled={enabled === null || enableMut.isPending}
              onCheckedChange={(v) => enableMut.mutate(v)}
              aria-label="Memory on/off"
            />
            <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
              {enabled ? "On" : "Off"}
            </span>
          </div>
        </div>

        {enabled && (
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant={paused ? "default" : "outline"}
              onClick={() => pauseMut.mutate(!paused)}
              disabled={pauseMut.isPending}
              className="gap-1.5"
            >
              {paused ? <PlayCircle className="h-4 w-4" /> : <PauseCircle className="h-4 w-4" />}
              {paused ? "Resume learning" : "Pause learning"}
            </Button>
            <Button size="sm" variant="outline" onClick={handleExport} className="gap-1.5">
              <Download className="h-4 w-4" /> Export
            </Button>
            {confirmWipe ? (
              <span className="inline-flex items-center gap-2 rounded-full border border-destructive/40 bg-destructive/5 px-3 py-1 text-xs">
                <AlertTriangle className="h-3.5 w-3.5 text-destructive" />
                Delete everything?
                <button
                  type="button"
                  onClick={() => wipeMut.mutate()}
                  disabled={wipeMut.isPending}
                  className="rounded bg-destructive px-2 py-0.5 font-semibold text-destructive-foreground"
                >
                  Yes
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmWipe(false)}
                  className="rounded px-2 py-0.5 text-muted-foreground"
                >
                  Cancel
                </button>
              </span>
            ) : (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setConfirmWipe(true)}
                className="gap-1.5 text-destructive hover:text-destructive"
              >
                <Trash2 className="h-4 w-4" /> Delete all
              </Button>
            )}
          </div>
        )}
      </header>

      <HowMemoryWorks />

      {enabled === false ? (
        <div className="mt-6 rounded-2xl border border-dashed border-border bg-card/30 p-6 text-center text-sm text-muted-foreground">
          Memory is off. When you turn it on, RestPilot will quietly watch for repeated
          patterns and ask before saving anything.
        </div>
      ) : (
        <>
          <LearningConsentsCard disabled={paused} />

          {/* Cross-skill routine suggestions */}
          <section className="mt-6 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                Suggested routines
              </h2>
              <Button
                size="sm"
                variant="outline"
                disabled={scanMut.isPending}
                onClick={() => scanMut.mutate()}
                className="gap-1.5"
              >
                <Sparkles className="h-3.5 w-3.5" />
                {scanMut.isPending ? "Scanning…" : "Scan now"}
              </Button>
            </div>
            {(suggestionsQ.data?.length ?? 0) === 0 ? (
              <p className="rounded-2xl border border-dashed border-border bg-card/30 p-4 text-xs text-muted-foreground">
                No suggestions yet. I'll combine the categories you allowed (above) and
                propose helpful routines — you always approve or reject each one.
              </p>
            ) : (
              (suggestionsQ.data ?? []).map((s) => (
                <RoutineSuggestionCard
                  key={s.id}
                  suggestion={s}
                  busy={acceptSugMut.isPending || dismissSugMut.isPending || snoozeSugMut.isPending}
                  onAccept={() => acceptSugMut.mutate(s.id)}
                  onDismiss={() => dismissSugMut.mutate(s.id)}
                  onSnooze={() => snoozeSugMut.mutate(s.id)}
                />
              ))
            )}
          </section>

          {/* Pending memory proposals */}
          {(proposalsQ.data?.length ?? 0) > 0 && (
            <section className="mt-6 space-y-3">
              <h2 className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                Things I'd like to remember
              </h2>
              {(proposalsQ.data ?? []).map((p) => (
                <ProposalCard
                  key={p.id}
                  proposal={p}
                  busy={acceptMut.isPending || declineMut.isPending}
                  onAccept={() => acceptMut.mutate(p)}
                  onDecline={() => declineMut.mutate(p.id)}
                />
              ))}
            </section>
          )}

          {/* Timeline */}
          <section className="mt-6 space-y-6">
            {CATEGORY_SECTIONS.map((s) => {
              const items = grouped.get(s.key);
              if (!items || items.length === 0) return null;
              return (
                <div key={s.key}>
                  <h2 className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                    {s.label}
                  </h2>
                  <ul className="space-y-2">
                    {items.map((m) => (
                      <MemoryRow
                        key={m.id}
                        memory={m}
                        onSave={(content) =>
                          updateMemory(m.id, { content }).then(refresh).catch(() => undefined)
                        }
                        onPin={() =>
                          updateMemory(m.id, { pinned: !m.pinned }).then(refresh).catch(() => undefined)
                        }
                        onDelete={() => delMut.mutate(m.id)}
                      />
                    ))}
                  </ul>
                </div>
              );
            })}
            {(memQ.data?.length ?? 0) === 0 && (
              <div className="rounded-2xl border border-dashed border-border bg-card/40 p-6 text-sm text-muted-foreground">
                Nothing remembered yet. As you use RestPilot, I'll watch for patterns and
                ask before saving anything.
              </div>
            )}
          </section>

          {/* Manual add */}
          <AddMemoryCard
            onAdded={() => {
              refresh();
              toast.success("Memory added");
            }}
          />
        </>
      )}
    </div>
  );
}

function MemoryRow({
  memory,
  onSave,
  onPin,
  onDelete,
}: {
  memory: AIMemory;
  onSave: (content: string) => void;
  onPin: () => void;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(memory.content);
  const confPct = Math.round((memory.importance / 5) * 100);
  return (
    <li className="rounded-2xl border border-border bg-card p-3.5 text-sm">
      {editing ? (
        <div className="space-y-2">
          <textarea
            value={value}
            onChange={(e) => setValue(e.target.value)}
            rows={2}
            maxLength={280}
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
          />
          <div className="flex gap-2">
            <Button
              size="sm"
              onClick={() => {
                onSave(value.trim());
                setEditing(false);
              }}
              disabled={value.trim().length < 4}
            >
              Save
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setValue(memory.content);
                setEditing(false);
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <p className="leading-snug">{memory.content}</p>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <Clock className="h-3 w-3" />
          Learned {relativeTime(memory.createdAt)}
        </span>
        <span>· {whyLabel(memory)}</span>
        <span className="rounded-full bg-muted px-1.5 py-0.5">Importance {confPct}%</span>
      </div>
      {!editing && (
        <div className="mt-3 flex items-center justify-end gap-1.5">
          <button
            type="button"
            onClick={onPin}
            title={memory.pinned ? "Unpin" : "Pin"}
            className="rounded p-1.5 text-muted-foreground hover:bg-muted"
          >
            {memory.pinned ? <Pin className="h-4 w-4 text-primary" /> : <PinOff className="h-4 w-4" />}
          </button>
          <button
            type="button"
            onClick={() => setEditing(true)}
            title="Edit"
            className="rounded p-1.5 text-muted-foreground hover:bg-muted"
          >
            <Pencil className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={onDelete}
            title="Forget this"
            className="rounded p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      )}
    </li>
  );
}

function AddMemoryCard({ onAdded }: { onAdded: () => void }) {
  const [content, setContent] = useState("");
  const [category, setCategory] = useState<MemoryCategory>("preferences");
  const [busy, setBusy] = useState(false);

  async function submit() {
    const trimmed = content.trim();
    if (trimmed.length < 4) return;
    setBusy(true);
    try {
      const result = await addMemory(trimmed, category, 3);
      if (!result) {
        toast.error("Sign in required");
        return;
      }
      setContent("");
      onAdded();
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mt-6 rounded-2xl border border-border bg-card p-4">
      <h2 className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
        Add a memory yourself
      </h2>
      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        placeholder='e.g. "I prefer Ocean sounds when I travel"'
        rows={2}
        maxLength={280}
        className="mt-3 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
      />
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value as MemoryCategory)}
          className="rounded-lg border border-border bg-background px-2 py-2 text-xs"
        >
          {ADD_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {CATEGORY_SECTIONS.find((s) => s.key === c)?.label ?? c}
            </option>
          ))}
        </select>
        <Button
          size="sm"
          className="ml-auto gap-1.5"
          onClick={submit}
          disabled={busy || content.trim().length < 4}
        >
          <Plus className="h-3.5 w-3.5" /> Add memory
        </Button>
      </div>
    </section>
  );
}
