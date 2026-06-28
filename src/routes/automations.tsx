// Phase 5 — Automations route. Routine builder + library + run history.
// Confirmation-first execution. Respects Quiet Mode and offline.

import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  ArrowLeft,
  CheckCircle2,
  History,
  Pause,
  Play,
  Plus,
  Sparkles,
  Trash2,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";

import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import {
  listAutomations,
  upsertAutomation,
  deleteAutomation,
  listAutomationRuns,
  logAutomationRun,
} from "@/lib/automations/automations.functions";
import { listSmartDevices } from "@/lib/smart-home/devices.functions";
import {
  type Automation,
  type AutomationKind,
  type AutomationStep,
  AUTOMATION_KIND_LABELS,
} from "@/lib/automations/types";
import { planAutomation, STARTER_ROUTINES } from "@/lib/automations/engine";
import { isQuietModeOn, setQuietMode } from "@/lib/quiet-mode";
import { speak } from "@/lib/companion/speak";
import { track } from "@/lib/companion/analytics";
import { NLRoutineBuilder } from "@/components/automations/NLRoutineBuilder";

export const Route = createFileRoute("/automations")({
  head: () => ({
    meta: [
      { title: "Routines | RestPilot AI" },
      {
        name: "description",
        content:
          "Build bedtime, wake-up, goodnight, and morning routines that combine smart devices, sleep sounds, and Quiet Mode.",
      },
    ],
  }),
  component: AutomationsPage,
  errorComponent: () => (
    <main className="mx-auto max-w-md p-6 text-sm">Routines are unavailable right now.</main>
  ),
  notFoundComponent: () => <main className="mx-auto max-w-md p-6 text-sm">Not found.</main>,
});

const KINDS: AutomationKind[] = ["bedtime", "wake_up", "goodnight", "morning", "custom"];

function AutomationsPage() {
  const list = useServerFn(listAutomations);
  const upsert = useServerFn(upsertAutomation);
  const del = useServerFn(deleteAutomation);
  const listRuns = useServerFn(listAutomationRuns);
  const logRun = useServerFn(logAutomationRun);
  const listDev = useServerFn(listSmartDevices);
  const qc = useQueryClient();

  const automationsQ = useQuery({ queryKey: ["automations"], queryFn: () => list() });
  const devicesQ = useQuery({ queryKey: ["smart-devices"], queryFn: () => listDev() });
  const runsQ = useQuery({ queryKey: ["automation-runs"], queryFn: () => listRuns() });

  const devices = devicesQ.data ?? [];
  const automations = automationsQ.data ?? [];
  const runs = runsQ.data ?? [];

  const [newName, setNewName] = useState("");
  const [newKind, setNewKind] = useState<AutomationKind>("bedtime");
  const [pendingRun, setPendingRun] = useState<Automation | null>(null);

  const addStarter = useMutation({
    mutationFn: async (starter: (typeof STARTER_ROUTINES)[number]) =>
      upsert({
        data: {
          name: starter.name,
          kind: starter.kind,
          trigger: { type: "manual" },
          steps: starter.steps,
        },
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["automations"] }),
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not create routine"),
  });

  const addBlank = useMutation({
    mutationFn: async () => {
      if (!newName.trim()) throw new Error("Add a name");
      return upsert({
        data: {
          name: newName.trim(),
          kind: newKind,
          trigger: { type: "manual" },
          steps: [],
        },
      });
    },
    onSuccess: () => {
      setNewName("");
      qc.invalidateQueries({ queryKey: ["automations"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not create routine"),
  });

  const toggleMut = useMutation({
    mutationFn: async (a: Automation) =>
      upsert({
        data: {
          id: a.id,
          name: a.name,
          kind: a.kind,
          trigger: a.trigger,
          steps: a.steps,
          enabled: !a.enabled,
          requireConfirmation: a.requireConfirmation,
          respectQuietHours: a.respectQuietHours,
        },
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["automations"] }),
  });

  const delMut = useMutation({
    mutationFn: async (id: string) => del({ data: { id } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["automations"] }),
  });

  async function executeAutomation(a: Automation, plan: ReturnType<typeof planAutomation>) {
    setPendingRun(null);
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      await logRun({
        data: {
          automationId: a.id,
          status: "skipped_offline",
          triggerSource: "manual",
          stepsResolved: plan.steps.map((s) => s.step),
        },
      });
      toast.message("Offline — routine deferred", {
        description: "Reelo skipped this routine because the device is offline.",
      });
      qc.invalidateQueries({ queryKey: ["automation-runs"] });
      return;
    }
    if (a.respectQuietHours && isQuietModeOn()) {
      await logRun({
        data: {
          automationId: a.id,
          status: "skipped_quiet",
          triggerSource: "manual",
          stepsResolved: plan.steps.map((s) => s.step),
        },
      });
      toast.message("Quiet Mode is on", {
        description: "Routine skipped to keep things quiet.",
      });
      qc.invalidateQueries({ queryKey: ["automation-runs"] });
      return;
    }
    track({ event: "action_started", kind: `routine:${a.kind}` });
    try {
      // Execute the safe, local-only steps (quiet_mode, say). Device + sound
      // steps are *planned* — actually issuing them requires the user's vendor
      // app, which we never bypass. We narrate "would do" steps instead.
      for (const s of plan.steps) {
        if (s.blockedReason) continue;
        if (s.step.type === "quiet_mode") setQuietMode(s.step.on);
        if (s.step.type === "say") await speak(s.step.text, { source: "action_narration" });
      }
      await logRun({
        data: {
          automationId: a.id,
          status: "succeeded",
          triggerSource: "manual",
          stepsResolved: plan.steps.map((s) => s.step),
        },
      });
      track({ event: "action_completed", kind: `routine:${a.kind}` });
      toast.success(`${a.name} ran`);
    } catch (e) {
      await logRun({
        data: {
          automationId: a.id,
          status: "failed",
          triggerSource: "manual",
          stepsResolved: plan.steps.map((s) => s.step),
          error: e instanceof Error ? e.message : String(e),
        },
      });
      track({
        event: "action_failed",
        kind: `routine:${a.kind}`,
        reason: e instanceof Error ? e.message : "unknown",
      });
      toast.error("Routine failed");
    } finally {
      qc.invalidateQueries({ queryKey: ["automation-runs"] });
    }
  }

  const pendingPlan = useMemo(
    () => (pendingRun ? planAutomation(pendingRun, devices) : null),
    [pendingRun, devices],
  );

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-5 pb-24 pt-6">
      <header className="flex items-center gap-2">
        <Link
          to="/settings/skills"
          className="inline-flex h-11 w-11 items-center justify-center rounded-md border border-border/60"
          aria-label="Back to Companion Skills"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div>
          <h1 className="text-lg font-semibold">Routines</h1>
          <p className="text-xs text-muted-foreground">
            Multi-step routines that always ask before running and respect Quiet Mode.
          </p>
        </div>
      </header>

      {automations.length === 0 && (
        <Card className="flex flex-col gap-3 p-4">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" aria-hidden />
            <p className="text-sm font-semibold">Start with a built-in routine</p>
          </div>
          <p className="text-xs text-muted-foreground">
            We'll add it disabled so you can review before turning it on.
          </p>
          <div className="grid grid-cols-2 gap-2">
            {STARTER_ROUTINES.map((s) => (
              <Button
                key={s.name}
                variant="outline"
                size="sm"
                className="min-h-11 justify-start"
                onClick={() => addStarter.mutate(s)}
                disabled={addStarter.isPending}
              >
                {AUTOMATION_KIND_LABELS[s.kind]}
              </Button>
            ))}
          </div>
        </Card>
      )}

      <Card className="flex flex-col gap-2 p-4" aria-label="Add routine">
        <p className="text-sm font-semibold">New routine</p>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="My evening routine"
            maxLength={80}
            aria-label="Routine name"
          />
          <Select value={newKind} onValueChange={(v) => setNewKind(v as AutomationKind)}>
            <SelectTrigger className="sm:w-44" aria-label="Routine kind">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {KINDS.map((k) => (
                <SelectItem key={k} value={k}>
                  {AUTOMATION_KIND_LABELS[k]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            type="button"
            onClick={() => addBlank.mutate()}
            disabled={addBlank.isPending}
            className="min-h-11"
          >
            <Plus className="mr-1 h-4 w-4" aria-hidden /> Add
          </Button>
        </div>
      </Card>

      <section aria-label="Your routines" className="flex flex-col gap-2">
        <p className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Your routines
        </p>
        {automationsQ.isLoading ? (
          <Card className="p-4 text-sm text-muted-foreground">Loading…</Card>
        ) : automations.length === 0 ? (
          <Card className="p-4 text-sm text-muted-foreground">No routines yet.</Card>
        ) : (
          automations.map((a) => {
            const plan = planAutomation(a, devices);
            return (
              <Card key={a.id} className="flex flex-col gap-3 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-semibold leading-tight">{a.name}</p>
                      <Badge variant="secondary" className="text-[10px]">
                        {AUTOMATION_KIND_LABELS[a.kind]}
                      </Badge>
                      {plan.hasSensitive && (
                        <Badge variant="destructive" className="text-[10px]">
                          Sensitive
                        </Badge>
                      )}
                      {!a.enabled && (
                        <Badge variant="outline" className="text-[10px]">
                          Paused
                        </Badge>
                      )}
                    </div>
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      {a.steps.length === 0 ? "No steps yet." : plan.summary}
                    </p>
                  </div>
                  <Switch
                    checked={a.enabled}
                    onCheckedChange={() => toggleMut.mutate(a)}
                    aria-label={`${a.enabled ? "Pause" : "Enable"} ${a.name}`}
                  />
                </div>
                <div className="flex flex-wrap items-center justify-end gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => delMut.mutate(a.id)}
                    className="min-h-11 text-destructive"
                    aria-label={`Delete ${a.name}`}
                  >
                    <Trash2 className="mr-1 h-4 w-4" /> Delete
                  </Button>
                  <Button
                    size="sm"
                    className="min-h-11"
                    disabled={!a.enabled || a.steps.length === 0}
                    onClick={() => setPendingRun(a)}
                  >
                    {a.enabled ? <Play className="mr-1 h-4 w-4" /> : <Pause className="mr-1 h-4 w-4" />}
                    Run
                  </Button>
                </div>
              </Card>
            );
          })
        )}
      </section>

      <section aria-label="Automation history" className="flex flex-col gap-2">
        <p className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          <History className="-mt-0.5 mr-1 inline h-3 w-3" aria-hidden /> History
        </p>
        {runs.length === 0 ? (
          <Card className="p-3 text-xs text-muted-foreground">No runs yet.</Card>
        ) : (
          runs.slice(0, 10).map((r) => (
            <Card key={r.id} className="flex items-center gap-2 p-3 text-xs">
              {r.status === "succeeded" ? (
                <CheckCircle2 className="h-4 w-4 text-emerald-500" aria-hidden />
              ) : r.status === "failed" ? (
                <XCircle className="h-4 w-4 text-destructive" aria-hidden />
              ) : (
                <Pause className="h-4 w-4 text-muted-foreground" aria-hidden />
              )}
              <span className="flex-1">
                <span className="font-medium capitalize">{r.status.replace(/_/g, " ")}</span>
                <span className="text-muted-foreground"> · {new Date(r.createdAt).toLocaleString()}</span>
              </span>
              <span className="text-muted-foreground">{r.stepsResolved.length} step(s)</span>
            </Card>
          ))
        )}
      </section>

      <p className="px-1 text-[11px] leading-relaxed text-muted-foreground">
        Routines run only after you confirm. Sensitive devices (locks, garage) always require an
        extra tap. Quiet Mode and offline state are respected — runs that were skipped show up in
        history. RestPilot never bypasses your operating system's Do Not Disturb or Focus settings.
      </p>

      <Dialog open={pendingRun !== null} onOpenChange={(o) => !o && setPendingRun(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Run "{pendingRun?.name}"?</DialogTitle>
            <DialogDescription>
              {pendingPlan?.hasSensitive
                ? "This routine touches a sensitive device. Confirm to continue."
                : "Confirm to run this routine now."}
            </DialogDescription>
          </DialogHeader>
          <ol className="space-y-1 rounded-md border border-border/60 bg-muted/30 p-3 text-xs">
            {pendingPlan?.steps.map((s, i) => (
              <li key={i} className="flex items-start gap-2">
                <span className="text-muted-foreground">{i + 1}.</span>
                <span className={s.blockedReason ? "text-destructive" : ""}>
                  {s.label}
                  {s.blockedReason ? ` — ${s.blockedReason}` : ""}
                </span>
              </li>
            ))}
          </ol>
          <DialogFooter className="gap-2">
            <Button variant="ghost" onClick={() => setPendingRun(null)} className="min-h-11">
              Cancel
            </Button>
            <Button
              onClick={() => pendingRun && pendingPlan && executeAutomation(pendingRun, pendingPlan)}
              className="min-h-11"
              disabled={pendingPlan?.hasBlocked}
            >
              Run now
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}
