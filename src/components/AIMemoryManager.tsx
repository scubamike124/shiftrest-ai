import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Brain, Pin, PinOff, Plus, Trash2, Download, AlertTriangle } from "lucide-react";
import {
  listMemories,
  addMemory,
  updateMemory,
  deleteMemory,
  wipeAllMemories,
  exportMemoriesAsJSON,
  type AIMemory,
  type MemoryCategory,
} from "@/lib/ai-memory";

const CATEGORIES: MemoryCategory[] = [
  "general","schedule","health","preferences","employer","recovery","caffeine","family","goals",
];

export function AIMemoryManager({ enabled }: { enabled: boolean }) {
  const qc = useQueryClient();
  const { data: memories = [], isLoading } = useQuery({
    queryKey: ["ai-memory"],
    queryFn: listMemories,
    enabled,
    staleTime: 30_000,
  });

  const [newContent, setNewContent] = useState("");
  const [newCategory, setNewCategory] = useState<MemoryCategory>("general");
  const [confirmWipe, setConfirmWipe] = useState(false);

  const refresh = () => qc.invalidateQueries({ queryKey: ["ai-memory"] });

  const addMut = useMutation({
    mutationFn: async () => {
      const trimmed = newContent.trim();
      if (trimmed.length < 4) throw new Error("Memory must be at least 4 characters.");
      return addMemory(trimmed, newCategory);
    },
    onSuccess: () => {
      setNewContent("");
      refresh();
      toast.success("Memory added");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not add memory"),
  });

  const pinMut = useMutation({
    mutationFn: (m: AIMemory) => updateMemory(m.id, { pinned: !m.pinned }),
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
    a.download = `restpilot-memories-${new Date().toISOString().slice(0,10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (!enabled) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-card/50 p-4 text-sm text-muted-foreground">
        Memory is off. Turn on “Long-term memory” above to let RestPilot remember things you tell it.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Add */}
      <div className="rounded-xl border border-border bg-card p-3 space-y-2">
        <label className="text-xs uppercase tracking-wide text-muted-foreground">
          Add a memory yourself
        </label>
        <textarea
          value={newContent}
          onChange={(e) => setNewContent(e.target.value)}
          placeholder='e.g. "Works night shifts at Mercy Hospital, 3 on / 4 off"'
          rows={2}
          maxLength={280}
          className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
        />
        <div className="flex items-center gap-2">
          <select
            value={newCategory}
            onChange={(e) => setNewCategory(e.target.value as MemoryCategory)}
            className="rounded-lg border border-border bg-background px-2 py-2 text-xs"
          >
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
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

      {/* List */}
      {isLoading ? (
        <div className="text-sm text-muted-foreground">Loading memories…</div>
      ) : memories.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-card/50 p-4 text-sm text-muted-foreground">
          <Brain className="mb-1 h-4 w-4" />
          Nothing remembered yet. As you chat with the coach, it will quietly save durable facts about you (your schedule, habits, goals). You can also add memories above.
        </div>
      ) : (
        <ul className="space-y-2">
          {memories.map((m) => (
            <li
              key={m.id}
              className="rounded-xl border border-border bg-card p-3 text-sm"
            >
              <div className="flex items-start gap-2">
                <div className="flex-1">
                  <p className="leading-snug">{m.content}</p>
                  <div className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
                    <span className="rounded bg-muted px-1.5 py-0.5">{m.category}</span>
                    <span>•</span>
                    <span>{m.source}</span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => pinMut.mutate(m)}
                  className="rounded p-1.5 text-muted-foreground hover:bg-muted"
                  title={m.pinned ? "Unpin" : "Pin so the AI always sees this"}
                >
                  {m.pinned ? <Pin className="h-4 w-4 text-primary" /> : <PinOff className="h-4 w-4" />}
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

      {/* Footer actions */}
      <div className="flex flex-col gap-2 pt-2 sm:flex-row sm:items-center">
        <button
          type="button"
          onClick={handleExport}
          className="inline-flex items-center justify-center gap-2 rounded-lg border border-border px-3 py-2 text-xs font-semibold"
        >
          <Download className="h-3.5 w-3.5" /> Export JSON
        </button>
        {confirmWipe ? (
          <div className="flex items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs">
            <AlertTriangle className="h-3.5 w-3.5 text-destructive" />
            <span>Wipe everything?</span>
            <button
              type="button"
              onClick={() => wipeMut.mutate()}
              disabled={wipeMut.isPending}
              className="ml-1 rounded bg-destructive px-2 py-1 font-semibold text-destructive-foreground"
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
            className="inline-flex items-center justify-center gap-2 rounded-lg border border-destructive/30 px-3 py-2 text-xs font-semibold text-destructive"
          >
            <Trash2 className="h-3.5 w-3.5" /> Wipe all memories
          </button>
        )}
      </div>
    </div>
  );
}
