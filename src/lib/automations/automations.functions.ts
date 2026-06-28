// Phase 5 — Automation CRUD + run-log server functions.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type {
  Automation,
  AutomationKind,
  AutomationRun,
  AutomationStep,
  AutomationTrigger,
  RunStatus,
} from "./types";

const AUTOMATION_KINDS = ["bedtime", "wake_up", "goodnight", "morning", "custom"] as const;
const RUN_STATUSES = [
  "started",
  "succeeded",
  "failed",
  "cancelled",
  "skipped_quiet",
  "skipped_offline",
] as const;

const triggerSchema: z.ZodType<AutomationTrigger> = z.union([
  z.object({ type: z.literal("manual") }),
  z.object({
    type: z.literal("time"),
    hhmm: z.string().regex(/^\d{2}:\d{2}$/),
    days: z.array(z.number().int().min(0).max(6)).optional(),
  }),
  z.object({
    type: z.literal("event"),
    event: z.enum(["sunset", "sunrise", "bedtime_window"]),
  }),
]);

const stepSchema: z.ZodType<AutomationStep> = z.union([
  z.object({
    type: z.literal("device"),
    deviceId: z.string().uuid(),
    command: z.enum(["on", "off", "toggle", "brightness", "setpoint", "volume"]),
    value: z.number().min(0).max(100).optional(),
    destructive: z.boolean().optional(),
  }),
  z.object({
    type: z.literal("sound_play"),
    preset: z.string().min(1).max(40),
    volume: z.number().min(0).max(100).optional(),
  }),
  z.object({ type: z.literal("sound_stop") }),
  z.object({ type: z.literal("sound_timer"), minutes: z.number().int().min(1).max(720) }),
  z.object({ type: z.literal("quiet_mode"), on: z.boolean() }),
  z.object({ type: z.literal("wait"), seconds: z.number().int().min(0).max(600) }),
  z.object({ type: z.literal("say"), text: z.string().min(1).max(280) }),
]);

const upsertSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().min(1).max(80),
  kind: z.enum(AUTOMATION_KINDS),
  trigger: triggerSchema,
  steps: z.array(stepSchema).max(40),
  enabled: z.boolean().optional(),
  requireConfirmation: z.boolean().optional(),
  respectQuietHours: z.boolean().optional(),
  metadata: z.record(z.string(), z.any()).optional(),
});

type AutomationRow = {
  id: string;
  name: string;
  kind: string;
  trigger: unknown;
  steps: unknown;
  enabled: boolean;
  require_confirmation: boolean;
  respect_quiet_hours: boolean;
  metadata: unknown;
  created_at: string;
  updated_at: string;
};

import type { JsonObject } from "../json";

function toAutomation(r: AutomationRow): Automation {
  return {
    id: r.id,
    name: r.name,
    kind: r.kind as AutomationKind,
    trigger: (r.trigger ?? { type: "manual" }) as AutomationTrigger,
    steps: ((r.steps ?? []) as AutomationStep[]) || [],
    enabled: r.enabled,
    requireConfirmation: r.require_confirmation,
    respectQuietHours: r.respect_quiet_hours,
    metadata: (r.metadata ?? {}) as JsonObject,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export const listAutomations = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<Automation[]> => {
    const { data, error } = await context.supabase
      .from("automations" as never)
      .select("*")
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    return ((data ?? []) as unknown as AutomationRow[]).map(toAutomation);
  });

export const upsertAutomation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => upsertSchema.parse(input))
  .handler(async ({ data, context }): Promise<Automation> => {
    const row = {
      id: data.id,
      user_id: context.userId,
      name: data.name.trim(),
      kind: data.kind,
      trigger: data.trigger,
      steps: data.steps,
      enabled: data.enabled ?? true,
      require_confirmation: data.requireConfirmation ?? true,
      respect_quiet_hours: data.respectQuietHours ?? true,
      metadata: data.metadata ?? {},
    };
    const { data: out, error } = await context.supabase
      .from("automations" as never)
      .upsert(row as never)
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return toAutomation(out as unknown as AutomationRow);
  });

export const deleteAutomation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("automations" as never)
      .delete()
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

const runInsertSchema = z.object({
  automationId: z.string().uuid().nullable().optional(),
  status: z.enum(RUN_STATUSES),
  triggerSource: z.string().min(1).max(40).default("manual"),
  stepsResolved: z.array(stepSchema).max(40).optional(),
  error: z.string().max(500).nullable().optional(),
});

export const logAutomationRun = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => runInsertSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("automation_runs" as never)
      .insert({
        user_id: context.userId,
        automation_id: data.automationId ?? null,
        status: data.status,
        trigger_source: data.triggerSource,
        steps_resolved: data.stepsResolved ?? [],
        error: data.error ?? null,
      } as never);
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

type RunRow = {
  id: string;
  automation_id: string | null;
  status: string;
  trigger_source: string;
  steps_resolved: unknown;
  error: string | null;
  created_at: string;
};

export const listAutomationRuns = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<AutomationRun[]> => {
    const { data, error } = await context.supabase
      .from("automation_runs" as never)
      .select("*")
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw new Error(error.message);
    return ((data ?? []) as unknown as RunRow[]).map((r) => ({
      id: r.id,
      automationId: r.automation_id,
      status: r.status as RunStatus,
      triggerSource: r.trigger_source,
      stepsResolved: ((r.steps_resolved ?? []) as AutomationStep[]) || [],
      error: r.error,
      createdAt: r.created_at,
    }));
  });
