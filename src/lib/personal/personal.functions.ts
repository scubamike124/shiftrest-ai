// Phase 4 — Personal Intelligence server functions. Auth-gated; RLS as the user.
// All reads/writes scoped to the signed-in user. No outbound email/calendar writes.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  buildDailyPlan,
  detectPriority,
  type PersonalItem,
  type DailyPlanOutput,
} from "./intel";

type Row = {
  id: string;
  kind: string;
  title: string;
  notes: string | null;
  source: string | null;
  due_at: string | null;
  remind_at: string | null;
  priority: number;
  status: string;
  followup_of: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
};

function rowToItem(r: Row): PersonalItem {
  const kind = (["task", "reminder", "email_note", "followup"] as const).includes(r.kind as never)
    ? (r.kind as PersonalItem["kind"])
    : "task";
  const status = (["open", "snoozed", "done", "dismissed"] as const).includes(r.status as never)
    ? (r.status as PersonalItem["status"])
    : "open";
  const p = Math.min(4, Math.max(1, Math.round(r.priority || 2))) as 1 | 2 | 3 | 4;
  return {
    id: r.id,
    kind,
    title: r.title,
    notes: r.notes,
    source: r.source,
    dueAt: r.due_at,
    remindAt: r.remind_at,
    priority: p,
    status,
    followupOf: r.followup_of,
    metadata: r.metadata ?? {},
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export const listPersonalItems = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<PersonalItem[]> => {
    const { supabase, userId } = context;
    const { data, error } = await supabase
      .from("personal_items")
      .select("*")
      .eq("user_id", userId)
      .order("status", { ascending: true })
      .order("priority", { ascending: true })
      .order("due_at", { ascending: true, nullsFirst: false })
      .limit(200);
    if (error) throw new Error(error.message);
    return ((data ?? []) as Row[]).map(rowToItem);
  });

const upsertSchema = z.object({
  id: z.string().uuid().optional(),
  kind: z.enum(["task", "reminder", "email_note", "followup"]).default("task"),
  title: z.string().trim().min(1).max(280),
  notes: z.string().trim().max(4000).nullable().optional(),
  source: z.string().trim().max(120).nullable().optional(),
  dueAt: z.string().datetime().nullable().optional(),
  remindAt: z.string().datetime().nullable().optional(),
  priority: z.number().int().min(1).max(4).optional(),
  followupOf: z.string().uuid().nullable().optional(),
});

export const upsertPersonalItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => upsertSchema.parse(d))
  .handler(async ({ data, context }): Promise<PersonalItem> => {
    const { supabase, userId } = context;
    const priority =
      data.priority ?? detectPriority(data.title, data.notes ?? null, data.dueAt ?? null);
    const payload = {
      user_id: userId,
      kind: data.kind,
      title: data.title,
      notes: data.notes ?? null,
      source: data.source ?? null,
      due_at: data.dueAt ?? null,
      remind_at: data.remindAt ?? null,
      priority,
      followup_of: data.followupOf ?? null,
    };
    const query = data.id
      ? supabase.from("personal_items").update(payload).eq("id", data.id).eq("user_id", userId).select("*").maybeSingle()
      : supabase.from("personal_items").insert(payload).select("*").maybeSingle();
    const { data: row, error } = await query;
    if (error) throw new Error(error.message);
    if (!row) throw new Error("Could not save item.");
    return rowToItem(row as Row);
  });

const statusSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(["open", "snoozed", "done", "dismissed"]),
});

export const setPersonalItemStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => statusSchema.parse(d))
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const { supabase, userId } = context;
    const { error } = await supabase
      .from("personal_items")
      .update({ status: data.status })
      .eq("id", data.id)
      .eq("user_id", userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deletePersonalItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const { supabase, userId } = context;
    const { error } = await supabase
      .from("personal_items")
      .delete()
      .eq("id", data.id)
      .eq("user_id", userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

const planSchema = z.object({
  period: z.enum(["morning", "afternoon", "evening"]),
});

export interface DailyPlanDTO extends DailyPlanOutput {
  period: "morning" | "afternoon" | "evening";
  totalOpen: number;
}

/** Cross-skill aware plan. Pulls calendar + weather + traffic gently; never throws on a missing skill. */
export const getDailyPlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => planSchema.parse(d))
  .handler(async ({ data, context }): Promise<DailyPlanDTO> => {
    const { supabase, userId } = context;
    const { data: rows } = await supabase
      .from("personal_items")
      .select("*")
      .eq("user_id", userId)
      .in("status", ["open", "snoozed"])
      .limit(200);
    const items = ((rows ?? []) as Row[]).map(rowToItem);

    // Cross-skill: pull a light agenda window from calendar_feeds metadata cache if present.
    // Fail-soft — if calendar isn't connected, just skip.
    let agenda: Array<{ summary: string; startISO: string; allDay?: boolean }> = [];
    let earliestMeetingHHMM: string | null = null;
    try {
      const { getCalendarAgenda } = await import("@/lib/calendar/calendar.functions");
      const agendaDTO = await getCalendarAgenda({
        data: { period: data.period },
        context,
      } as never);
      if (Array.isArray(agendaDTO?.events)) {
        agenda = agendaDTO.events.slice(0, 5).map((e: { summary: string; startISO: string; allDay?: boolean }) => ({
          summary: e.summary,
          startISO: e.startISO,
          allDay: e.allDay,
        }));
        const firstTimed = agenda.find((e) => !e.allDay);
        if (firstTimed) {
          const d = new Date(firstTimed.startISO);
          if (!Number.isNaN(d.getTime())) {
            earliestMeetingHHMM = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
          }
        }
      }
    } catch {
      /* calendar not connected — skip */
    }

    // Cross-skill: traffic delta from first destination, when available.
    let trafficDeltaMin: number | null = null;
    try {
      const { data: tRows } = await supabase
        .from("traffic_destinations")
        .select("metadata")
        .eq("user_id", userId)
        .limit(1);
      const meta = (tRows?.[0] as { metadata?: { deltaMin?: number } } | undefined)?.metadata;
      if (meta && typeof meta.deltaMin === "number") trafficDeltaMin = meta.deltaMin;
    } catch {
      /* traffic not connected */
    }

    // Weather hint from user_prefs cache (cheap; never throw).
    let weatherHint: string | null = null;
    try {
      const { data: pref } = await supabase
        .from("user_prefs")
        .select("location_label")
        .eq("user_id", userId)
        .maybeSingle();
      // Avoid coupling to weather server fn during SSR; rely on the hint being injected elsewhere if needed.
      if (pref?.location_label) weatherHint = null;
    } catch {
      /* ignore */
    }

    const plan = buildDailyPlan({
      now: Date.now(),
      items,
      agenda,
      earliestMeetingHHMM,
      trafficDeltaMin,
      weatherHint,
    });

    return {
      ...plan,
      period: data.period,
      totalOpen: items.filter((i) => i.status === "open").length,
    };
  });
