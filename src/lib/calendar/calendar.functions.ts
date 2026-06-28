// Slice 12 — Step 4 (Calendar Intelligence). Server functions.
//
// Auth-gated via requireSupabaseAuth. RLS scopes every read/write to the
// signed-in user. No service-role usage on this surface.
//
// Surfaces:
//  - listCalendarFeeds       → list connected ICS feeds
//  - upsertCalendarFeed      → connect or rename a feed
//  - deleteCalendarFeed      → disconnect a feed
//  - testCalendarFeed        → fetch+parse a candidate URL before saving
//  - getCalendarAgenda       → today/upcoming/tomorrow agenda for a period

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  buildAgenda,
  bedtimeShiftForEarlyMeeting,
  deriveLeaveEarlierHint,
  type AgendaDTO,
  type AgendaItem,
  type CalendarPeriod,
  type LeaveEarlierHint,
} from "@/lib/calendar/intel";
import { parseIcs } from "@/lib/calendar/ics";

const CAL_SKILL = "calendar_read";

export interface CalendarFeedDTO {
  id: string;
  label: string;
  icsUrl: string;
  color: string | null;
  active: boolean;
  lastSyncAt: string | null;
  lastError: string | null;
}

export type CalendarAgendaDTO =
  | {
      ok: true;
      generatedAtISO: string;
      period: CalendarPeriod;
      agenda: AgendaDTO;
      bedtimeShiftMin: number;
      leaveEarlier: LeaveEarlierHint | null;
    }
  | {
      ok: false;
      reason: "skill_disabled" | "no_feed" | "fetch_failed" | "empty";
    };

interface SkillRow { status: string }
interface FeedRow {
  id: string;
  label: string;
  ics_url: string;
  color: string | null;
  active: boolean;
  last_sync_at: string | null;
  last_error: string | null;
}

async function isCalendarEnabled(
  supabase: { from: (t: string) => unknown },
  userId: string,
): Promise<boolean> {
  const q = (supabase.from("companion_skills") as {
    select: (s: string) => {
      eq: (c: string, v: string) => {
        eq: (c: string, v: string) => {
          maybeSingle: () => Promise<{ data: SkillRow | null }>;
        };
      };
    };
  })
    .select("status")
    .eq("user_id", userId)
    .eq("skill", CAL_SKILL);
  const { data } = await q.maybeSingle();
  if (!data) return true; // built-in default; a feed-less account will short-circuit later
  return data.status !== "disabled" && data.status !== "disconnected";
}

function rowToFeed(r: FeedRow): CalendarFeedDTO {
  return {
    id: r.id,
    label: r.label,
    icsUrl: r.ics_url,
    color: r.color,
    active: r.active,
    lastSyncAt: r.last_sync_at,
    lastError: r.last_error,
  };
}

// ─── List ────────────────────────────────────────────────────────────────────
export const listCalendarFeeds = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<CalendarFeedDTO[]> => {
    const { supabase, userId } = context;
    const { data, error } = await supabase
      .from("calendar_feeds")
      .select("id, label, ics_url, color, active, last_sync_at, last_error")
      .eq("user_id", userId)
      .order("created_at", { ascending: true });
    if (error) throw error;
    return (data ?? []).map((r) => rowToFeed(r as FeedRow));
  });

// ─── Upsert ──────────────────────────────────────────────────────────────────
const upsertSchema = z.object({
  id: z.string().uuid().optional(),
  label: z.string().trim().min(1).max(60),
  icsUrl: z.string().trim().min(8).max(2000),
  color: z.string().trim().max(20).nullable().optional(),
  active: z.boolean().optional(),
});
export const upsertCalendarFeed = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (data: {
      id?: string;
      label: string;
      icsUrl: string;
      color?: string | null;
      active?: boolean;
    }) => upsertSchema.parse(data),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const row = {
      user_id: userId,
      label: data.label,
      ics_url: data.icsUrl,
      color: data.color ?? null,
      active: data.active ?? true,
    } satisfies Record<string, unknown>;

    if (data.id) {
      const { error } = await supabase
        .from("calendar_feeds")
        .update(row)
        .eq("id", data.id)
        .eq("user_id", userId);
      if (error) throw error;
    } else {
      const { error } = await supabase.from("calendar_feeds").insert(row);
      if (error) throw error;
    }

    await supabase
      .from("companion_skills")
      .upsert(
        {
          user_id: userId,
          skill: CAL_SKILL,
          status: "connected",
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id,skill" },
      );
    return { ok: true as const };
  });

// ─── Delete ──────────────────────────────────────────────────────────────────
const deleteSchema = z.object({ id: z.string().uuid() });
export const deleteCalendarFeed = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { id: string }) => deleteSchema.parse(data))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { error } = await supabase
      .from("calendar_feeds")
      .delete()
      .eq("id", data.id)
      .eq("user_id", userId);
    if (error) throw error;
    return { ok: true as const };
  });

// ─── Test (used by the connect form before saving) ───────────────────────────
const testSchema = z.object({ icsUrl: z.string().trim().min(8).max(2000) });
export const testCalendarFeed = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { icsUrl: string }) => testSchema.parse(data))
  .handler(async ({ data }) => {
    const { fetchIcsFeed } = await import("@/lib/calendar.server");
    const fetched = await fetchIcsFeed(data.icsUrl);
    if (!fetched.ok || !fetched.body) {
      return { ok: false as const, error: fetched.error ?? "Could not load feed" };
    }
    const now = new Date();
    const windowEnd = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
    const events = parseIcs(fetched.body, now, windowEnd, 10);
    return { ok: true as const, sampleCount: events.length };
  });

// ─── Agenda ──────────────────────────────────────────────────────────────────
const agendaSchema = z.object({
  period: z.enum(["morning", "afternoon", "evening"]),
});
export const getCalendarAgenda = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { period: CalendarPeriod }) => agendaSchema.parse(data))
  .handler(async ({ data, context }): Promise<CalendarAgendaDTO> => {
    const { supabase, userId } = context;
    const enabled = await isCalendarEnabled(
      supabase as unknown as { from: (t: string) => unknown },
      userId,
    );
    if (!enabled) return { ok: false, reason: "skill_disabled" };

    const { data: feedRows, error } = await supabase
      .from("calendar_feeds")
      .select("id, label, ics_url, color, active, last_sync_at, last_error")
      .eq("user_id", userId)
      .eq("active", true);
    if (error) throw error;
    const feeds = (feedRows ?? []).map((r) => rowToFeed(r as FeedRow));
    if (feeds.length === 0) return { ok: false, reason: "no_feed" };

    const now = new Date();
    const windowStart = new Date(now);
    windowStart.setHours(0, 0, 0, 0);
    const windowEnd = new Date(windowStart);
    windowEnd.setDate(windowEnd.getDate() + 2); // today + tomorrow

    const { fetchIcsFeed } = await import("@/lib/calendar.server");

    const enriched: (AgendaItem & { _raw: true })[] = [];
    let anySuccess = false;
    for (const feed of feeds) {
      const res = await fetchIcsFeed(feed.icsUrl);
      if (!res.ok || !res.body) {
        await supabase
          .from("calendar_feeds")
          .update({ last_error: res.error ?? "Fetch failed" })
          .eq("id", feed.id)
          .eq("user_id", userId);
        continue;
      }
      anySuccess = true;
      const evs = parseIcs(res.body, windowStart, windowEnd, 100);
      for (const e of evs) {
        enriched.push({
          uid: e.uid,
          title: e.summary,
          location: e.location,
          startISO: e.startISO,
          endISO: e.endISO,
          allDay: e.allDay,
          recurring: e.recurring,
          source: feed.label,
          color: feed.color,
          _raw: true,
        });
      }
      await supabase
        .from("calendar_feeds")
        .update({ last_sync_at: new Date().toISOString(), last_error: null })
        .eq("id", feed.id)
        .eq("user_id", userId);
    }

    if (!anySuccess) return { ok: false, reason: "fetch_failed" };

    const agenda = buildAgenda(
      enriched.map((e) => ({
        uid: e.uid,
        summary: e.title,
        location: e.location,
        startISO: e.startISO,
        endISO: e.endISO,
        allDay: e.allDay,
        recurring: e.recurring,
        source: e.source,
        color: e.color,
      })),
      data.period,
      now,
    );

    if (agenda.items.length === 0 && !agenda.earlyMeeting && !agenda.nextItem) {
      return { ok: false, reason: "empty" };
    }

    // Pull traffic numbers (best-effort) to compute the combined hint.
    let trafficCurrent: number | null = null;
    let trafficBaseline: number | null = null;
    try {
      const { data: dRows } = await supabase
        .from("traffic_destinations")
        .select("baseline_min, kind")
        .eq("user_id", userId);
      // We only have stored baselines on traffic_destinations and a live
      // route call would double the work this handler does; for now the
      // hint surfaces only after the morning traffic card has populated
      // currentMin (TrafficCard owns that call). The morning brief renders
      // both cards so users see them together.
      const work = (dRows ?? []).find((r) => (r as { kind: string }).kind === "work") as
        | { baseline_min: number | null }
        | undefined;
      trafficBaseline = work?.baseline_min ?? null;
    } catch {
      /* noop — leave-earlier hint just won't show */
    }

    const leaveEarlier = deriveLeaveEarlierHint({
      agenda,
      trafficCurrentMin: trafficCurrent,
      trafficBaselineMin: trafficBaseline,
    });

    return {
      ok: true,
      generatedAtISO: new Date().toISOString(),
      period: data.period,
      agenda,
      bedtimeShiftMin: bedtimeShiftForEarlyMeeting(agenda.earlyMeeting),
      leaveEarlier,
    };
  });
