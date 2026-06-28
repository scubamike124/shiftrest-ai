// Phase 5 — Smart device CRUD server functions.
//
// All operations are scoped to the signed-in user via requireSupabaseAuth +
// RLS. Capabilities and metadata are sanitized to plain JSON before storage.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  type DeviceCapabilities,
  type DeviceKind,
  type DeviceVendor,
  type SmartDevice,
  SENSITIVE_KINDS,
  defaultCapabilitiesForKind,
} from "./types";

const DEVICE_KINDS = [
  "light",
  "plug",
  "thermostat",
  "speaker",
  "coffee_maker",
  "fan",
  "tv",
  "lock",
  "garage",
  "blinds",
  "humidifier",
  "bedroom",
  "other",
] as const;

const DEVICE_VENDORS = [
  "manual",
  "alexa",
  "google_home",
  "homekit",
  "smartthings",
  "home_assistant",
  "matter",
  "other",
] as const;

const upsertSchema = z.object({
  id: z.string().uuid().optional(),
  label: z.string().min(1).max(80),
  kind: z.enum(DEVICE_KINDS),
  room: z.string().max(60).nullable().optional(),
  vendor: z.enum(DEVICE_VENDORS).default("manual"),
  capabilities: z.record(z.string(), z.boolean()).optional(),
  sensitive: z.boolean().optional(),
  enabled: z.boolean().optional(),
  metadata: z.record(z.string(), z.any()).optional(),
});

type DeviceRow = {
  id: string;
  label: string;
  kind: string;
  room: string | null;
  vendor: string;
  capabilities: unknown;
  sensitive: boolean;
  enabled: boolean;
  metadata: unknown;
  created_at: string;
  updated_at: string;
};

import type { JsonObject } from "../json";

function toDevice(row: DeviceRow): SmartDevice {
  return {
    id: row.id,
    label: row.label,
    kind: row.kind as DeviceKind,
    room: row.room,
    vendor: row.vendor as DeviceVendor,
    capabilities: (row.capabilities ?? {}) as DeviceCapabilities,
    sensitive: row.sensitive,
    enabled: row.enabled,
    metadata: (row.metadata ?? {}) as JsonObject,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export const listSmartDevices = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<SmartDevice[]> => {
    const { data, error } = await context.supabase
      .from("smart_devices" as never)
      .select("*")
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    return ((data ?? []) as unknown as DeviceRow[]).map(toDevice);
  });

export const upsertSmartDevice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => upsertSchema.parse(input))
  .handler(async ({ data, context }): Promise<SmartDevice> => {
    const kind = data.kind;
    const sensitive = data.sensitive ?? SENSITIVE_KINDS.has(kind);
    const capabilities = data.capabilities ?? defaultCapabilitiesForKind(kind);
    const row = {
      id: data.id,
      user_id: context.userId,
      label: data.label.trim(),
      kind,
      room: data.room?.trim() || null,
      vendor: data.vendor,
      capabilities,
      sensitive,
      enabled: data.enabled ?? true,
      metadata: data.metadata ?? {},
    };
    const { data: out, error } = await context.supabase
      .from("smart_devices" as never)
      .upsert(row as never)
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return toDevice(out as unknown as DeviceRow);
  });

export const deleteSmartDevice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("smart_devices" as never)
      .delete()
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });
