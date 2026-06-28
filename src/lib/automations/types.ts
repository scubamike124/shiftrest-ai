// Phase 5 — Automation engine types.
//
// An Automation has a trigger (manual / time / event) and an ordered list of
// steps. Steps reference either a smart device intent, a sleep-sound action,
// a quiet-mode toggle, or a wait. The engine NEVER auto-executes destructive
// or sensitive steps — confirmation is required when `requireConfirmation`
// is true at the automation OR the step level.

export type AutomationKind =
  | "bedtime"
  | "wake_up"
  | "goodnight"
  | "morning"
  | "custom";

export type AutomationTrigger =
  | { type: "manual" }
  | { type: "time"; hhmm: string; days?: number[] /* 0..6 */ }
  | { type: "event"; event: "sunset" | "sunrise" | "bedtime_window" };

export type AutomationStep =
  | {
      type: "device";
      deviceId: string;
      command: "on" | "off" | "toggle" | "brightness" | "setpoint" | "volume";
      value?: number; // 0..100 brightness/volume, or °F setpoint
      destructive?: boolean;
    }
  | { type: "sound_play"; preset: string; volume?: number }
  | { type: "sound_stop" }
  | { type: "sound_timer"; minutes: number }
  | { type: "quiet_mode"; on: boolean }
  | { type: "wait"; seconds: number }
  | { type: "say"; text: string };

import type { JsonObject } from "../json";

export interface Automation {
  id: string;
  name: string;
  kind: AutomationKind;
  trigger: AutomationTrigger;
  steps: AutomationStep[];
  enabled: boolean;
  requireConfirmation: boolean;
  respectQuietHours: boolean;
  metadata: JsonObject;
  createdAt: string;
  updatedAt: string;
}

export type RunStatus =
  | "started"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "skipped_quiet"
  | "skipped_offline";

export interface AutomationRun {
  id: string;
  automationId: string | null;
  status: RunStatus;
  triggerSource: string;
  stepsResolved: AutomationStep[];
  error: string | null;
  createdAt: string;
}

export const AUTOMATION_KIND_LABELS: Record<AutomationKind, string> = {
  bedtime: "Bedtime Routine",
  wake_up: "Wake-up Routine",
  goodnight: "Goodnight Routine",
  morning: "Morning Routine",
  custom: "Custom Routine",
};
