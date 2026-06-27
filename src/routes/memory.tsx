import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Brain,
  Pin,
  PinOff,
  Plus,
  Trash2,
  Download,
  AlertTriangle,
  Search,
  ShieldCheck,
  Clock,
  ArrowLeft,
} from "lucide-react";
import { Switch } from "@/components/ui/switch";
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

export const Route = createFileRoute("/memory")({
  head: () => ({
    meta: [
      { title: "Memory — RestPilot AI" },
      {
        name: "description",
        content:
          "Manage what RestPilot remembers about you. View, edit, delete, or export your long-term memories — fully under your control.",
      },
    ],
  }),
  component: MemoryPage,
});

const CATEGORIES: ("all" | MemoryCategory)[] = [
  "all",
  "general",
  "schedule",
  "health",
  "preferences",
  "employer",
  "recovery",
  "caffeine",
  "family",
  "goals",
];

function relativeTime(iso: string | null): string | null {
  if (!iso) return null;
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

function expiresLabel(iso: string | null): string | null {
  if (!iso) return null;
  const diff = new Date(iso).getTime() - Date.now();
  if (diff <= 0) return "expired";
  const d = Math.ceil(diff / 86_400_000);
  return `expires in ${d}d`;
}

function MemoryPage() {
  const qc = useQueryClient();
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<"all" | MemoryCategory>("all");
  const [pinnedOnly, setPinnedOnly] = useState(false);
  const [newContent, setNewContent] = useState("");
  const [newCategory, setNewCategory] = useState<MemoryCategory>("general");
  const [newImportance, setNewImportance] = useState(3);
  const [confirmWipe, setConfirmWipe] = useState(false);

  useEffect(() => {
    void getMemoryEnabled().then(setEnabled);
  }, []);

  const filters = useMemo(
    () => ({ query, category, pinnedOnly }),
    [query, category, pinnedOnly],
  );

  const { data: memories = [] as AIMemory[], isLoading } = useQuery<AIMemory[]>({
    queryKey: ["ai-memory", filters],
    queryFn: () => listMemories(filters),
    enabled: Boolean(enabled),
    staleTime: 15_000,
  });

  const refresh = () => qc.invalidateQueries({ queryKey: ["ai-memory"] });

  const toggleMut = useMutation({
    mutationFn: async (next: boolean) => {
      await setMemoryEnabled(next);
      return next;
    },
    onSuccess: (next) => {
      setEnabled(next);
      toast.success(next ? "Memory turned on" : "Memory turned off");
      refresh();
    },
    onError: () => toast.error("Could not update memory setting"),
  });

  const addMut = useMutation({
    mutationFn: async () => {
      const trimmed = newContent.trim();
      if (trimmed.length < 4) throw new Error("Memory must be at least 4 characters.");
      return addMemory(trimmed, newCategory, newImportance);
    },
    onSuccess: () => {
      setNewContent("");
      setNewImportance(3);
      refresh();
      toast.success("Memory added");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not add memory"),
  });

  const pinMut = useMutation({
    mutationFn: (m: AIMemory) => updateMemory(m.id, { pinned: !m.pinned }),
    onSuccess: refresh,
  });

  const importanceMut = useMutation({
    mutationFn: ({ id, importance }: { id: string; importance: number }) =>
      updateMemory(id, { importance }),
    onSuccess: refresh,
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteMemory(id),
    onSuccess: () => {
      refresh();
      toast.success("Memory removed");
    },
  });

  const wipeMut = useMutation({
    mutationFn: () => wipeAllMemories(),
    onSuccess: (count) => {
      setConfirmWipe(false);
      refresh();
      toast.success(count === 0 ? "Nothing to wipe" : `Wiped ${count} memories`);
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

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:py-10">
      <Link
        to="/profile"
        className="mb-4 inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> Back to profile
      </Link>

      {/* Header */}
      <div className="rounded-2xl border border-border bg-card p-5 sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              <Brain className="h-3.5 w-3.5" /> Long-term memory
            </div>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">
              Your memory, your rules
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              RestPilot only remembers things when you let it. Turn it off any
              time and everything stops being saved. You can delete or export
              what's here whenever you want.
            </p>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1">
            <Switch
              checked={Boolean(enabled)}
              disabled={enabled === null || toggleMut.isPending}
              onCheckedChange={(v) => toggleMut.mutate(v)}
            />
            <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
              {enabled ? "On" : "Off"}
            </span>
          </div>
        </div>
      </div>

      {/* Privacy card */}
      <div className="mt-4 rounded-2xl border border-border/60 bg-card/60 p-4 text-sm text-muted-foreground sm:p-5">
        <div className="flex items-center gap-2 text-foreground">
          <ShieldCheck className="h-4 w-4 text-primary" />
          <span className="text-sm font-semibold">What we save — and what we don't</span>
        </div>
        <ul className="mt-2 grid gap-1.5 text-[13px] leading-relaxed">
          <li>
            <span className="font-medium text-foreground">We save</span> durable
            facts you tell the coach: your schedule, role, recovery habits,
            caffeine preferences, goals.
          </li>
          <li>
            <span className="font-medium text-foreground">We don't save</span>{" "}
            today's mood, transient symptoms, medical diagnoses, or anything
            we're guessing at.
          </li>
          <li>
            Memories live only in your account, scoped to you, and never shared
            with other users. See the{" "}
            <Link to="/privacy" className="underline">
              privacy policy
            </Link>{" "}
            for full details.
          </li>
        </ul>
      </div>

      {/* Detected patterns — predictive layer transparency */}
      <PatternsPanel />


      {enabled === false ? (
        <div className="mt-6 rounded-2xl border border-dashed border-border bg-card/30 p-6 text-center text-sm text-muted-foreground">
          Memory is off. Turn it on above and the coach will quietly remember
          durable facts about your life so its advice stays consistent.
        </div>
      ) : (
        <>
          {/* Search + filters */}
          <div className="mt-6 space-y-3">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search memories…"
                className="w-full rounded-xl border border-border bg-background py-2.5 pl-9 pr-3 text-sm"
              />
            </div>
            <div className="flex flex-wrap gap-1.5">
              {CATEGORIES.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setCategory(c)}
                  className={`rounded-full border px-3 py-1 text-xs font-medium capitalize transition ${
                    category === c
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border bg-card text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {c}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setPinnedOnly((v) => !v)}
                className={`ml-auto inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-medium transition ${
                  pinnedOnly
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-card text-muted-foreground hover:text-foreground"
                }`}
              >
                <Pin className="h-3 w-3" /> Pinned only
              </button>
            </div>
          </div>

          {/* List */}
          <div className="mt-4">
            {isLoading ? (
              <div className="text-sm text-muted-foreground">Loading memories…</div>
            ) : memories.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-border bg-card/40 p-6 text-sm text-muted-foreground">
                <Brain className="mb-1 h-4 w-4" />
                {query || category !== "all" || pinnedOnly
                  ? "No memories match these filters."
                  : "Nothing remembered yet. As you chat with the coach, durable facts about your life will land here. You can also add your own below."}
              </div>
            ) : (
              <ul className="space-y-2">
                {memories.map((m) => (
                  <li
                    key={m.id}
                    className="rounded-2xl border border-border bg-card p-3.5 text-sm"
                  >
                    <p className="leading-snug">{m.content}</p>
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                      <span className="rounded bg-muted px-1.5 py-0.5 capitalize">
                        {m.category}
                      </span>
                      <span>• {m.source}</span>
                      {m.useCount > 0 && (
                        <span>• used {m.useCount}×</span>
                      )}
                      {relativeTime(m.lastReferencedAt) && (
                        <span className="inline-flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {relativeTime(m.lastReferencedAt)}
                        </span>
                      )}
                      {expiresLabel(m.expiresAt) && (
                        <span className="rounded bg-amber-500/10 px-1.5 py-0.5 text-amber-600 dark:text-amber-400">
                          {expiresLabel(m.expiresAt)}
                        </span>
                      )}
                    </div>
                    <div className="mt-3 flex items-center gap-1.5">
                      <div className="flex items-center gap-0.5">
                        {[1, 2, 3, 4, 5].map((i) => (
                          <button
                            key={i}
                            type="button"
                            title={`Set importance ${i}`}
                            onClick={() =>
                              importanceMut.mutate({ id: m.id, importance: i })
                            }
                            className={`h-2 w-2 rounded-full transition ${
                              i <= m.importance
                                ? "bg-primary"
                                : "bg-muted hover:bg-muted-foreground/40"
                            }`}
                          />
                        ))}
                        <span className="ml-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                          Importance
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => pinMut.mutate(m)}
                        className="ml-auto rounded p-1.5 text-muted-foreground hover:bg-muted"
                        title={m.pinned ? "Unpin" : "Pin so the AI always sees this"}
                      >
                        {m.pinned ? (
                          <Pin className="h-4 w-4 text-primary" />
                        ) : (
                          <PinOff className="h-4 w-4" />
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() => deleteMut.mutate(m.id)}
                        className="rounded p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                        title="Delete"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Add */}
          <div className="mt-6 rounded-2xl border border-border bg-card p-4 space-y-3">
            <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Add a memory yourself
            </label>
            <textarea
              value={newContent}
              onChange={(e) => setNewContent(e.target.value)}
              placeholder='e.g. "Works night shifts at Mercy Hospital, 3 on / 4 off"'
              rows={2}
              maxLength={280}
              className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm"
            />
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={newCategory}
                onChange={(e) => setNewCategory(e.target.value as MemoryCategory)}
                className="rounded-lg border border-border bg-background px-2 py-2 text-xs capitalize"
              >
                {CATEGORIES.filter((c) => c !== "all").map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
              <div className="flex items-center gap-1.5 rounded-lg border border-border px-2 py-1.5">
                <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  Importance
                </span>
                {[1, 2, 3, 4, 5].map((i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => setNewImportance(i)}
                    className={`h-2 w-2 rounded-full ${
                      i <= newImportance ? "bg-primary" : "bg-muted"
                    }`}
                  />
                ))}
              </div>
              <button
                type="button"
                onClick={() => addMut.mutate()}
                disabled={addMut.isPending || newContent.trim().length < 4}
                className="ml-auto inline-flex items-center gap-1 rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground disabled:opacity-50"
              >
                <Plus className="h-3.5 w-3.5" /> Add
              </button>
            </div>
          </div>

          {/* Footer actions */}
          <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center">
            <button
              type="button"
              onClick={handleExport}
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-border px-3 py-2 text-xs font-semibold"
            >
              <Download className="h-3.5 w-3.5" /> Export JSON
            </button>
            {confirmWipe ? (
              <div className="flex flex-wrap items-center gap-2 rounded-xl border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs">
                <AlertTriangle className="h-3.5 w-3.5 text-destructive" />
                <span>Wipe everything?</span>
                <button
                  type="button"
                  onClick={() => wipeMut.mutate()}
                  disabled={wipeMut.isPending}
                  className="rounded bg-destructive px-2 py-1 font-semibold text-destructive-foreground"
                >
                  Yes, wipe
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmWipe(false)}
                  className="rounded px-2 py-1 text-muted-foreground"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmWipe(true)}
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-destructive/30 px-3 py-2 text-xs font-semibold text-destructive"
              >
                <Trash2 className="h-3.5 w-3.5" /> Wipe all memories
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
