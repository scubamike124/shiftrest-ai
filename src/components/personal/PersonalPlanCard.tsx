// Phase 4 — Personal Intelligence card. Appears in Morning/Afternoon/Evening
// briefs. Shows the cross-skill hint, top open items, and quick suggestions.
// Read-only surface — completing an item is the only mutation.

import { useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Check, Clock, ListChecks, Sparkles } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";

import { getDailyPlan, setPersonalItemStatus } from "@/lib/personal/personal.functions";
import { priorityLabel, type PersonalItem } from "@/lib/personal/intel";
import { track } from "@/lib/companion/analytics";
import { isSkillsFlagOn } from "@/lib/companion/skills/registry";

function priorityTone(p: 1 | 2 | 3 | 4): string {
  if (p === 1) return "bg-destructive/15 text-destructive border-destructive/30";
  if (p === 2) return "bg-primary/10 text-primary border-primary/20";
  return "bg-muted text-muted-foreground border-border/60";
}

function dueLabel(item: PersonalItem, now: number): string | null {
  if (!item.dueAt) return null;
  const t = new Date(item.dueAt).getTime();
  if (!Number.isFinite(t)) return null;
  const diff = t - now;
  const abs = Math.abs(diff);
  const hrs = Math.round(abs / 3600_000);
  if (diff < 0) return hrs < 24 ? `overdue ${hrs}h` : `overdue ${Math.round(hrs / 24)}d`;
  if (hrs < 1) return "due soon";
  if (hrs < 24) return `due in ${hrs}h`;
  return `due in ${Math.round(hrs / 24)}d`;
}

export function PersonalPlanCard({
  period,
  signedIn,
}: {
  period: "morning" | "afternoon" | "evening";
  signedIn: boolean;
}) {
  const fetchPlan = useServerFn(getDailyPlan);
  const updateStatus = useServerFn(setPersonalItemStatus);
  const qc = useQueryClient();

  const enabled = signedIn && (typeof window === "undefined" ? false : isSkillsFlagOn());

  const planQ = useQuery({
    queryKey: ["personal-plan", period],
    queryFn: () => fetchPlan({ data: { period } }),
    enabled,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    if (planQ.data) track({ event: "skill_invoked", skill: "personal_intel", action: `plan_${period}` });
  }, [planQ.data, period]);

  const completeMut = useMutation({
    mutationFn: (id: string) => updateStatus({ data: { id, status: "done" } }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["personal-plan"] });
      void qc.invalidateQueries({ queryKey: ["personal-items"] });
      track({ event: "skill_invoked", skill: "personal_intel", action: "complete_item" });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not update"),
  });

  if (!enabled) return null;
  const dto = planQ.data;
  if (!dto) return null;
  const noContent = dto.top.length === 0 && dto.suggestions.length === 0 && !dto.composedHint;
  if (noContent) return null;

  const now = Date.now();
  const title =
    period === "morning" ? "Today's plan" : period === "afternoon" ? "Still to do" : "Wrap-up";

  return (
    <Card className="border-border/60 p-4" data-testid={`personal-plan-${period}`}>
      <div className="flex items-center gap-2">
        <ListChecks className="h-4 w-4 text-primary" aria-hidden />
        <p className="text-sm font-semibold">{title}</p>
        <Badge variant="outline" className="ml-auto text-[10px]">
          {dto.totalOpen} open
        </Badge>
      </div>

      {dto.composedHint && (
        <div className="mt-3 flex items-start gap-2 rounded-md border border-primary/20 bg-primary/5 p-3">
          <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" aria-hidden />
          <p className="text-xs leading-relaxed text-foreground/90">{dto.composedHint}</p>
        </div>
      )}

      {dto.top.length > 0 && (
        <ul className="mt-3 flex flex-col gap-2" role="list">
          {dto.top.map((item) => {
            const due = dueLabel(item, now);
            return (
              <li
                key={item.id}
                className="flex items-start gap-2 rounded-md border border-border/40 p-2"
              >
                <button
                  type="button"
                  onClick={() => completeMut.mutate(item.id)}
                  disabled={completeMut.isPending}
                  aria-label={`Mark "${item.title}" as done`}
                  className="mt-0.5 inline-flex h-8 w-8 min-h-11 min-w-11 items-center justify-center rounded-full border border-border/60 text-muted-foreground hover:bg-muted/50"
                >
                  <Check className="h-4 w-4" aria-hidden />
                </button>
                <div className="flex-1 min-w-0">
                  <p className="truncate text-sm font-medium">{item.title}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5">
                    <span className={`rounded border px-1.5 py-0.5 text-[10px] font-medium ${priorityTone(item.priority)}`}>
                      {priorityLabel(item.priority)}
                    </span>
                    {due && (
                      <span className="inline-flex items-center gap-1 rounded border border-border/60 px-1.5 py-0.5 text-[10px] text-muted-foreground">
                        <Clock className="h-3 w-3" aria-hidden /> {due}
                      </span>
                    )}
                    {item.source && (
                      <span className="rounded border border-border/60 px-1.5 py-0.5 text-[10px] text-muted-foreground">
                        {item.source}
                      </span>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {dto.suggestions.length > 0 && (
        <ul className="mt-3 flex flex-col gap-1.5 border-t border-border/40 pt-3" role="list">
          {dto.suggestions.map((s, i) => (
            <li key={i} className="text-xs leading-relaxed text-muted-foreground">
              • {s}
            </li>
          ))}
        </ul>
      )}

      <div className="mt-3 flex items-center justify-between">
        <p className="text-[10px] text-muted-foreground">
          Suggestions only — Reelo never sends or deletes anything.
        </p>
        <Link
          to="/inbox"
          className="text-xs font-medium text-primary underline-offset-2 hover:underline"
        >
          Open inbox →
        </Link>
      </div>
    </Card>
  );
}
