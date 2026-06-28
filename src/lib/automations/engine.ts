// Phase 5 — Pure automation planner.
//
// Responsibilities:
//   - validate step shape (no orphan devices, plausible bounds)
//   - compute whether confirmation is required for a given run
//   - build a human-readable summary for the confirmation sheet
//
// No IO, no React, no Supabase. Trivially unit-testable.

import type { Automation, AutomationStep } from "./types";
import type { SmartDevice } from "../smart-home/types";
import { SENSITIVE_KINDS } from "../smart-home/types";

export interface PlannedStep {
  step: AutomationStep;
  /** Resolved device, when the step references one and we found it. */
  device: SmartDevice | null;
  /** Human-readable label. */
  label: string;
  /** Step is destructive or touches a sensitive device. */
  sensitive: boolean;
  /** This specific step is unsafe to execute right now (missing device, etc.). */
  blockedReason: string | null;
}

export interface AutomationPlan {
  steps: PlannedStep[];
  /** Aggregate confirmation required at the automation level. */
  requireConfirmation: boolean;
  /** True if any sensitive device is touched. */
  hasSensitive: boolean;
  /** Any step is blocked for execution (missing device, etc.). */
  hasBlocked: boolean;
  /** One-line summary suitable for a toast. */
  summary: string;
}

export function planAutomation(
  automation: Pick<Automation, "steps" | "requireConfirmation"> & { name?: string },
  devices: ReadonlyArray<SmartDevice>,
): AutomationPlan {
  const deviceById = new Map(devices.map((d) => [d.id, d]));
  const steps: PlannedStep[] = automation.steps.map((step) => describeStep(step, deviceById));
  const hasSensitive = steps.some((s) => s.sensitive);
  const hasBlocked = steps.some((s) => s.blockedReason !== null);
  const summary = steps.length
    ? steps.map((s) => s.label).join(" → ")
    : "(no steps)";
  return {
    steps,
    requireConfirmation: automation.requireConfirmation || hasSensitive,
    hasSensitive,
    hasBlocked,
    summary,
  };
}

function describeStep(
  step: AutomationStep,
  deviceById: Map<string, SmartDevice>,
): PlannedStep {
  switch (step.type) {
    case "device": {
      const device = deviceById.get(step.deviceId) ?? null;
      const sensitive =
        Boolean(step.destructive) ||
        (device ? device.sensitive || SENSITIVE_KINDS.has(device.kind) : false);
      const label = device
        ? `${commandVerb(step.command, step.value)} ${device.label}`
        : `Device (missing)`;
      const blockedReason = !device
        ? "Device not found — re-link it in Smart Home"
        : !device.enabled
          ? "Device is disabled"
          : null;
      return { step, device, label, sensitive, blockedReason };
    }
    case "sound_play":
      return {
        step,
        device: null,
        label: `Play "${step.preset}" sound${step.volume != null ? ` at ${step.volume}%` : ""}`,
        sensitive: false,
        blockedReason: null,
      };
    case "sound_stop":
      return { step, device: null, label: "Stop all sounds", sensitive: false, blockedReason: null };
    case "sound_timer":
      return {
        step,
        device: null,
        label: `Set sleep timer for ${step.minutes} min`,
        sensitive: false,
        blockedReason: step.minutes <= 0 || step.minutes > 720 ? "Invalid timer length" : null,
      };
    case "quiet_mode":
      return {
        step,
        device: null,
        label: step.on ? "Turn Quiet Mode on" : "Turn Quiet Mode off",
        sensitive: false,
        blockedReason: null,
      };
    case "wait":
      return {
        step,
        device: null,
        label: `Wait ${step.seconds}s`,
        sensitive: false,
        blockedReason: step.seconds < 0 || step.seconds > 600 ? "Wait must be 0–600s" : null,
      };
    case "say":
      return {
        step,
        device: null,
        label: `Say: "${truncate(step.text, 40)}"`,
        sensitive: false,
        blockedReason: !step.text.trim() ? "Empty message" : null,
      };
  }
}

function commandVerb(command: string, value?: number): string {
  switch (command) {
    case "on":
      return "Turn on";
    case "off":
      return "Turn off";
    case "toggle":
      return "Toggle";
    case "brightness":
      return `Set ${value ?? 50}% brightness on`;
    case "setpoint":
      return `Set ${value ?? 70}° on`;
    case "volume":
      return `Set ${value ?? 30}% volume on`;
    default:
      return command;
  }
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n - 1)}…`;
}

/** Built-in starter routines users can clone with one tap. */
export const STARTER_ROUTINES: Array<{
  name: string;
  kind: Automation["kind"];
  steps: AutomationStep[];
}> = [
  {
    name: "Bedtime",
    kind: "bedtime",
    steps: [
      { type: "quiet_mode", on: true },
      { type: "sound_play", preset: "deep_sleep", volume: 60 },
      { type: "sound_timer", minutes: 45 },
    ],
  },
  {
    name: "Goodnight",
    kind: "goodnight",
    steps: [
      { type: "quiet_mode", on: true },
      { type: "say", text: "Sleep well." },
    ],
  },
  {
    name: "Wake-up",
    kind: "wake_up",
    steps: [
      { type: "sound_stop" },
      { type: "quiet_mode", on: false },
      { type: "say", text: "Good morning." },
    ],
  },
  {
    name: "Morning",
    kind: "morning",
    steps: [
      { type: "quiet_mode", on: false },
      { type: "say", text: "Here's your morning brief." },
    ],
  },
];
