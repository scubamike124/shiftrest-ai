// Slice 12 — Step 1 (Foundation). Central settings surface for Companion Skills.
//
// Foundation responsibilities only:
//  - render the full catalog grouped by category
//  - expose the master `companion.skills.v1` feature flag (default OFF)
//  - allow enabling / disabling built-in skills the user has connected
//  - link to Companion settings
//
// Skill-specific connection flows (OAuth, Home Assistant token, etc.) ship in
// later steps; this page renders a "Coming soon" badge for unavailable skills.

import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, Loader2, Lock, Sparkles, ShieldCheck, Zap } from "lucide-react";
import { toast } from "sonner";

import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";

import { track } from "@/lib/companion/analytics";
import {
  isSkillsFlagOn,
  resolveSkillRuntime,
  setSkillsFlag,
  type SkillRuntime,
} from "@/lib/companion/skills/registry";
import {
  disconnectSkill,
  listSkillConnections,
  setSkillStatus,
  type SkillConnection,
} from "@/lib/companion/skills/connections";
import type { SkillDescriptor } from "@/lib/companion/skills/types";

export const Route = createFileRoute("/settings/skills")({
  head: () => ({
    meta: [
      { title: "Companion Skills | RestPilot AI" },
      {
        name: "description",
        content:
          "Enable the Reelo Companion's skills — weather alerts, calendar, travel, smart home, comms, and learned routines.",
      },
    ],
  }),
  component: SkillsSettings,
});

const GROUP_LABELS: Record<SkillDescriptor["group"], string> = {
  intelligence: "Intelligence",
  productivity: "Productivity",
  home: "Home",
  communication: "Communication",
};

const GROUP_ORDER: SkillDescriptor["group"][] = [
  "intelligence",
  "productivity",
  "home",
  "communication",
];

function SkillsSettings() {
  const [flagOn, setFlagOnState] = useState(false);
  const [connections, setConnections] = useState<SkillConnection[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    setFlagOnState(isSkillsFlagOn());
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await listSkillConnections();
      setConnections(rows);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const runtime = useMemo<SkillRuntime[]>(
    () =>
      resolveSkillRuntime(
        connections.map((c) => ({ skill: c.skill, status: c.status })),
        { flagOn },
      ),
    [connections, flagOn],
  );

  const grouped = useMemo(() => {
    const map = new Map<SkillDescriptor["group"], SkillRuntime[]>();
    for (const skill of runtime) {
      const list = map.get(skill.group) ?? [];
      list.push(skill);
      map.set(skill.group, list);
    }
    return map;
  }, [runtime]);

  const onFlagToggle = useCallback((next: boolean) => {
    setSkillsFlag(next);
    setFlagOnState(next);
    track({ event: "skills_flag_toggled", on: next });
  }, []);

  const onToggleSkill = useCallback(
    async (skill: SkillRuntime, on: boolean) => {
      setBusyId(skill.id);
      const nextStatus: SkillConnection["status"] = on ? "connected" : "disabled";
      try {
        await setSkillStatus(skill.id, nextStatus);
        track({ event: "skill_status_changed", skill: skill.id, status: nextStatus });
        await refresh();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Could not update skill");
      } finally {
        setBusyId(null);
      }
    },
    [refresh],
  );

  const onDisconnect = useCallback(
    async (skill: SkillRuntime) => {
      setBusyId(skill.id);
      try {
        await disconnectSkill(skill.id);
        track({ event: "skill_disconnected", skill: skill.id });
        await refresh();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Could not disconnect");
      } finally {
        setBusyId(null);
      }
    },
    [refresh],
  );

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-5 pb-24 pt-6">
      <header className="flex items-center gap-2">
        <Link
          to="/settings/companion"
          className="inline-flex h-9 w-9 min-h-11 min-w-11 items-center justify-center rounded-md border border-border/60"
          aria-label="Back to Companion settings"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div>
          <h1 className="text-lg font-semibold">Companion Skills</h1>
          <p className="text-xs text-muted-foreground">
            Choose what Reelo can do for you. Every action still asks before it runs.
          </p>
        </div>
      </header>

      <Card className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" aria-hidden />
              <p className="text-sm font-semibold">Enable Skills (beta)</p>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Master switch for Reelo's new skill catalog. Off by default while we roll out each
              skill. Stored on this device.
            </p>
          </div>
          <Switch
            checked={flagOn}
            onCheckedChange={onFlagToggle}
            aria-label="Enable Companion Skills"
          />
        </div>
      </Card>

      {loading ? (
        <Card className="flex items-center justify-center gap-2 p-6 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          Loading your skills…
        </Card>
      ) : (
        GROUP_ORDER.map((group) => {
          const skills = grouped.get(group);
          if (!skills || skills.length === 0) return null;
          return (
            <section key={group} aria-label={GROUP_LABELS[group]} className="flex flex-col gap-3">
              <p className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {GROUP_LABELS[group]}
              </p>
              {skills.map((skill) => (
                <SkillRow
                  key={skill.id}
                  skill={skill}
                  flagOn={flagOn}
                  busy={busyId === skill.id}
                  onToggle={(v) => onToggleSkill(skill, v)}
                  onDisconnect={() => onDisconnect(skill)}
                />
              ))}
            </section>
          );
        })
      )}

      <Separator className="my-2" />
      <p className="px-1 text-[11px] leading-relaxed text-muted-foreground">
        Reelo never executes a skill silently. Every destructive action shows a confirmation with
        the full payload, respects quiet hours, and is recorded in your Action History.
      </p>
    </main>
  );
}

function riskBadge(risk: SkillDescriptor["risk"]) {
  if (risk === "destructive")
    return (
      <Badge variant="destructive" className="gap-1 text-[10px]">
        <Zap className="h-3 w-3" aria-hidden />
        Destructive
      </Badge>
    );
  if (risk === "sensitive")
    return (
      <Badge variant="secondary" className="gap-1 text-[10px]">
        <Lock className="h-3 w-3" aria-hidden />
        Sensitive
      </Badge>
    );
  return (
    <Badge variant="outline" className="gap-1 text-[10px]">
      <ShieldCheck className="h-3 w-3" aria-hidden />
      Safe
    </Badge>
  );
}

function SkillRow({
  skill,
  flagOn,
  busy,
  onToggle,
  onDisconnect,
}: {
  skill: SkillRuntime;
  flagOn: boolean;
  busy: boolean;
  onToggle: (on: boolean) => void;
  onDisconnect: () => void;
}) {
  const isComingSoon = skill.status === "coming_soon";
  const isConnected = skill.status === "connected";
  const isDisabled = skill.status === "disabled";
  const switchDisabled = busy || isComingSoon || !flagOn || (!skill.builtin && !isConnected && !isDisabled);

  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold leading-tight">{skill.name}</p>
            {riskBadge(skill.risk)}
            {isComingSoon && (
              <Badge variant="outline" className="text-[10px]">
                Coming soon
              </Badge>
            )}
            {skill.builtin && !isComingSoon && (
              <Badge variant="secondary" className="text-[10px]">
                Built-in
              </Badge>
            )}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">{skill.summary}</p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <Label htmlFor={`skill-${skill.id}`} className="sr-only">
            Enable {skill.name}
          </Label>
          <Switch
            id={`skill-${skill.id}`}
            checked={isConnected}
            disabled={switchDisabled}
            onCheckedChange={onToggle}
            aria-label={`Enable ${skill.name}`}
          />
        </div>
      </div>

      <p className="text-[11px] leading-relaxed text-muted-foreground">{skill.details}</p>

      {!skill.builtin && (isConnected || isDisabled) && (
        <div className="flex justify-end">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={onDisconnect}
            disabled={busy}
            className="min-h-11 text-destructive hover:text-destructive"
          >
            Disconnect
          </Button>
        </div>
      )}
    </Card>
  );
}
