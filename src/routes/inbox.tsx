// Phase 4 — Personal Intelligence inbox. Quick-add + list + complete/snooze.
// Mounted at /inbox. Mobile-first. Read & suggest only.

import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState, useMemo, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ArrowLeft, Check, Clock, Inbox, Plus, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { zodValidator, fallback } from "@tanstack/zod-adapter";
import { z } from "zod";

import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";

import {
  listPersonalItems,
  upsertPersonalItem,
  setPersonalItemStatus,
  deletePersonalItem,
} from "@/lib/personal/personal.functions";
import { priorityLabel, type PersonalItem, type ItemKind } from "@/lib/personal/intel";
import { track } from "@/lib/companion/analytics";

const searchSchema = z.object({
  add: fallback(z.string().trim().max(280).optional(), undefined),
  complete: fallback(z.string().trim().max(280).optional(), undefined),
});

export const Route = createFileRoute("/inbox")({
  validateSearch: zodValidator(searchSchema),
  head: () => ({
    meta: [
      { title: "Inbox | RestPilot AI" },
      { name: "description", content: "Capture tasks, reminders, and email follow-ups Reelo can plan around." },
    ],
  }),
  component: InboxPage,
});

const KIND_LABEL: Record<ItemKind, string> = {
  task: "Task",
  reminder: "Reminder",
  email_note: "Email note",
  followup: "Follow-up",
};

function InboxPage() {
  const list = useServerFn(listPersonalItems);
  const upsert = useServerFn(upsertPersonalItem);
  const setStatus = useServerFn(setPersonalItemStatus);
  const del = useServerFn(deletePersonalItem);
  const qc = useQueryClient();
  const navigate = useNavigate({ from: "/inbox" });
  const search = Route.useSearch();

  const itemsQ = useQuery({
    queryKey: ["personal-items"],
    queryFn: () => list(),
    staleTime: 30_000,
  });

  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<ItemKind>("task");
  const titleInputRef = useRef<HTMLInputElement>(null);

  // Voice deep-link: ?add=... prefills the form. Save is still required.
  const appliedAddRef = useRef<string | null>(null);
  useEffect(() => {
    const v = search.add?.trim();
    if (v && appliedAddRef.current !== v) {
      appliedAddRef.current = v;
      setTitle(v);
      setKind("task");
      // Defer focus until after paint so the input exists.
      requestAnimationFrame(() => titleInputRef.current?.focus());
      // Clear the query so a refresh doesn't re-apply it.
      void navigate({ search: (prev: z.infer<typeof searchSchema>) => ({ ...prev, add: undefined }), replace: true });
    }
  }, [search.add, navigate]);


  const createMut = useMutation({
    mutationFn: () => upsert({ data: { title: title.trim(), kind } }),
    onSuccess: () => {
      setTitle("");
      void qc.invalidateQueries({ queryKey: ["personal-items"] });
      void qc.invalidateQueries({ queryKey: ["personal-plan"] });
      track({ event: "skill_invoked", skill: "personal_intel", action: `create_${kind}` });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not add"),
  });

  const statusMut = useMutation({
    mutationFn: (v: { id: string; status: "done" | "snoozed" | "open" | "dismissed" }) =>
      setStatus({ data: v }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["personal-items"] });
      void qc.invalidateQueries({ queryKey: ["personal-plan"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not update"),
  });

  const delMut = useMutation({
    mutationFn: (id: string) => del({ data: { id } }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["personal-items"] });
      void qc.invalidateQueries({ queryKey: ["personal-plan"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not delete"),
  });

  const open = useMemo(
    () => (itemsQ.data ?? []).filter((i) => i.status === "open" || i.status === "snoozed"),
    [itemsQ.data],
  );
  const done = useMemo(
    () => (itemsQ.data ?? []).filter((i) => i.status === "done").slice(0, 20),
    [itemsQ.data],
  );

  // Voice deep-link: ?complete=... shows matching candidates and requires user confirmation.
  const completeQuery = search.complete?.trim() ?? "";
  const completeCandidates = useMemo(() => {
    if (!completeQuery) return [];
    const needle = completeQuery.toLowerCase();
    return open.filter((i) => i.title.toLowerCase().includes(needle)).slice(0, 5);
  }, [open, completeQuery]);

  const dismissComplete = () =>
    void navigate({ search: (prev: z.infer<typeof searchSchema>) => ({ ...prev, complete: undefined }), replace: true });

  const canSubmit = title.trim().length > 0 && !createMut.isPending;


  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-5 pb-24 pt-6">
      <header className="flex items-center gap-2">
        <Link
          to="/dashboard"
          className="inline-flex h-9 w-9 min-h-11 min-w-11 items-center justify-center rounded-md border border-border/60"
          aria-label="Back to dashboard"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div className="flex-1">
          <h1 className="text-lg font-semibold inline-flex items-center gap-2">
            <Inbox className="h-4 w-4 text-primary" aria-hidden /> Inbox
          </h1>
          <p className="text-xs text-muted-foreground">
            Capture anything — Reelo plans around it. Nothing leaves this device unless you ask.
          </p>
        </div>
      </header>

      <Card className="p-4">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (canSubmit) createMut.mutate();
          }}
          className="flex flex-col gap-3"
        >
          <Label htmlFor="inbox-title" className="text-xs font-medium">
            Add to inbox
          </Label>
          <Input
            id="inbox-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Reply to landlord about lease renewal by Friday"
            maxLength={280}
            className="min-h-11"
          />
          <div className="flex flex-wrap items-center gap-2">
            {(Object.keys(KIND_LABEL) as ItemKind[]).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setKind(k)}
                aria-pressed={kind === k}
                className={`min-h-11 rounded-full border px-3 py-1.5 text-xs ${
                  kind === k ? "border-primary bg-primary/10 text-primary" : "border-border/60 text-muted-foreground"
                }`}
              >
                {KIND_LABEL[k]}
              </button>
            ))}
            <Button
              type="submit"
              disabled={!canSubmit}
              className="ml-auto min-h-11"
            >
              <Plus className="mr-1 h-4 w-4" /> Add
            </Button>
          </div>
        </form>
      </Card>

      <section aria-label="Open items" className="flex flex-col gap-2">
        <p className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Open ({open.length})
        </p>
        {itemsQ.isLoading ? (
          <Card className="p-4 text-sm text-muted-foreground">Loading…</Card>
        ) : open.length === 0 ? (
          <Card className="p-4 text-sm text-muted-foreground">
            Nothing here yet. Add a task or paste an email note above.
          </Card>
        ) : (
          open.map((item) => (
            <InboxRow
              key={item.id}
              item={item}
              onDone={() => statusMut.mutate({ id: item.id, status: "done" })}
              onSnooze={() => statusMut.mutate({ id: item.id, status: "snoozed" })}
              onReopen={() => statusMut.mutate({ id: item.id, status: "open" })}
              onDelete={() => delMut.mutate(item.id)}
            />
          ))
        )}
      </section>

      {done.length > 0 && (
        <section aria-label="Recently done" className="flex flex-col gap-2">
          <p className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Recently done
          </p>
          {done.map((item) => (
            <InboxRow
              key={item.id}
              item={item}
              compact
              onDone={() => {}}
              onSnooze={() => {}}
              onReopen={() => statusMut.mutate({ id: item.id, status: "open" })}
              onDelete={() => delMut.mutate(item.id)}
            />
          ))}
        </section>
      )}
    </main>
  );
}

function InboxRow({
  item,
  compact,
  onDone,
  onSnooze,
  onReopen,
  onDelete,
}: {
  item: PersonalItem;
  compact?: boolean;
  onDone: () => void;
  onSnooze: () => void;
  onReopen: () => void;
  onDelete: () => void;
}) {
  const isDone = item.status === "done";
  const isSnoozed = item.status === "snoozed";
  return (
    <Card className="flex items-start gap-2 p-3">
      {!isDone ? (
        <button
          type="button"
          onClick={onDone}
          aria-label={`Mark "${item.title}" as done`}
          className="mt-0.5 inline-flex h-8 w-8 min-h-11 min-w-11 items-center justify-center rounded-full border border-border/60"
        >
          <Check className="h-4 w-4" aria-hidden />
        </button>
      ) : (
        <button
          type="button"
          onClick={onReopen}
          aria-label="Reopen"
          className="mt-0.5 inline-flex h-8 w-8 min-h-11 min-w-11 items-center justify-center rounded-full border border-primary/40 bg-primary/10 text-primary"
        >
          <Check className="h-4 w-4" aria-hidden />
        </button>
      )}
      <div className="flex-1 min-w-0">
        <p className={`text-sm font-medium ${isDone ? "line-through text-muted-foreground" : ""}`}>
          {item.title}
        </p>
        {!compact && (
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <Badge variant="outline" className="text-[10px]">
              {KIND_LABEL[item.kind]}
            </Badge>
            <Badge variant="secondary" className="text-[10px]">
              {priorityLabel(item.priority)}
            </Badge>
            {isSnoozed && (
              <Badge variant="outline" className="text-[10px]">
                <Clock className="mr-1 h-3 w-3" /> snoozed
              </Badge>
            )}
            {item.dueAt && (
              <span className="text-[10px] text-muted-foreground">
                due {new Date(item.dueAt).toLocaleDateString()}
              </span>
            )}
          </div>
        )}
      </div>
      <div className="flex items-center gap-1">
        {!isDone && !isSnoozed && (
          <button
            type="button"
            onClick={onSnooze}
            aria-label="Snooze"
            className="inline-flex h-8 w-8 min-h-11 min-w-11 items-center justify-center rounded-md text-muted-foreground hover:bg-muted/50"
          >
            <Clock className="h-4 w-4" />
          </button>
        )}
        <button
          type="button"
          onClick={onDelete}
          aria-label="Delete"
          className="inline-flex h-8 w-8 min-h-11 min-w-11 items-center justify-center rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
    </Card>
  );
}
