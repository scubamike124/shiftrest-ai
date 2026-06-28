// Slice 12 — Step 1 (Foundation). Capability discovery + feature flag.
//
// The flag `companion.skills.v1` is read from localStorage on the client and
// defaults OFF in production. Later steps will mirror this into a server-side
// gate so the LLM only sees connected skills in its tool catalog.

import { SKILL_CATALOG, type SkillDescriptor, type SkillId, type SkillStatus } from "./types";

const FLAG_KEY = "companion.skills.v1";

export function isSkillsFlagOn(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(FLAG_KEY) === "1";
  } catch {
    return false;
  }
}

export function setSkillsFlag(on: boolean): void {
  if (typeof window === "undefined") return;
  try {
    if (on) window.localStorage.setItem(FLAG_KEY, "1");
    else window.localStorage.removeItem(FLAG_KEY);
    window.dispatchEvent(new CustomEvent("companion:skills-flag", { detail: { on } }));
  } catch {
    /* noop */
  }
}

export interface SkillRuntime extends SkillDescriptor {
  /** Resolved live status after merging catalog + DB connections. */
  status: SkillStatus;
}

/**
 * Merge the static catalog with the user's per-skill connection rows from
 * `companion_skills`. Pure function — no IO. Step 1 wires this; later steps
 * will gate the LLM tool list on the resolved set.
 */
export function resolveSkillRuntime(
  connections: ReadonlyArray<{ skill: string; status: string }>,
  opts: { flagOn?: boolean } = {},
): SkillRuntime[] {
  const flagOn = opts.flagOn ?? false;
  const byId = new Map(connections.map((c) => [c.skill, c.status]));
  return SKILL_CATALOG.map((descriptor) => {
    const row = byId.get(descriptor.id);
    let status: SkillStatus;
    if (!descriptor.available || !flagOn) {
      status = "coming_soon";
    } else if (row === "disabled") {
      status = "disabled";
    } else if (row === "connected" || descriptor.builtin) {
      status = "connected";
    } else {
      status = "disconnected";
    }
    return { ...descriptor, status };
  });
}

/** Get only the skill IDs that are live for the user right now. */
export function activeSkillIds(runtime: ReadonlyArray<SkillRuntime>): SkillId[] {
  return runtime.filter((s) => s.status === "connected").map((s) => s.id);
}
