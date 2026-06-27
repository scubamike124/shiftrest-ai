// User-facing events: calendar items, commute plans, personal reminders.
// These feed both the AI daily-plan intent and the notification scheduler.
//
// Mirrors the shape and patterns of src/lib/shifts.ts for consistency.

import { supabase } from "@/integrations/supabase/client";
import { AuthRequiredError } from "@/lib/prefs";

export type EventKind = "calendar" | "commute" | "personal";
export type EventSource = "manual" | "google" | "ics";

export type UserEvent = {
  id: string;
  kind: EventKind;
  title: string;
  startsAt: string; // ISO
  endsAt: string | null;
  location: string | null;
  source: EventSource;
  reminderMin: number;
  travelBufferMin: number;
  notes: string | null;
};

type Row = {
  id: string;
  kind: EventKind;
  title: string;
  starts_at: string;
  ends_at: string | null;
  location: string | null;
  source: EventSource;
  reminder_min: number;
  travel_buffer_min: number;
  notes: string | null;
};

const SELECT =
  "id, kind, title, starts_at, ends_at, location, source, reminder_min, travel_buffer_min, notes";

function rowToEvent(r: Row): UserEvent {
  return {
    id: r.id,
    kind: r.kind,
    title: r.title,
    startsAt: r.starts_at,
    endsAt: r.ends_at,
    location: r.location,
    source: r.source,
    reminderMin: r.reminder_min,
    travelBufferMin: r.travel_buffer_min,
    notes: r.notes,
  };
}

async function uid(): Promise<string> {
  const { data } = await supabase.auth.getUser();
  if (!data.user) throw new AuthRequiredError();
  return data.user.id;
}

export async function fetchEvents(opts?: {
  fromIso?: string;
  untilIso?: string;
}): Promise<UserEvent[]> {
  const { data: session } = await supabase.auth.getSession();
  if (!session.session) return [];
  let q = supabase.from("user_events").select(SELECT);
  if (opts?.fromIso) q = q.gte("starts_at", opts.fromIso);
  if (opts?.untilIso) q = q.lte("starts_at", opts.untilIso);
  const { data, error } = await q.order("starts_at", { ascending: true });
  if (error) {
    console.error("fetchEvents", error);
    return [];
  }
  return (data ?? []).map((r) => rowToEvent(r as Row));
}

export type EventInput = {
  kind: EventKind;
  title: string;
  startsAt: string;
  endsAt?: string | null;
  location?: string | null;
  source?: EventSource;
  reminderMin?: number;
  travelBufferMin?: number;
  notes?: string | null;
};

export async function createEvent(input: EventInput): Promise<UserEvent> {
  const userId = await uid();
  const { data, error } = await supabase
    .from("user_events")
    .insert({
      user_id: userId,
      kind: input.kind,
      title: input.title.trim().slice(0, 120),
      starts_at: input.startsAt,
      ends_at: input.endsAt ?? null,
      location: input.location?.trim().slice(0, 200) || null,
      source: input.source ?? "manual",
      reminder_min: Math.max(0, Math.min(720, input.reminderMin ?? 15)),
      travel_buffer_min: Math.max(0, Math.min(180, input.travelBufferMin ?? 20)),
      notes: input.notes?.trim().slice(0, 500) || null,
    })
    .select(SELECT)
    .single();
  if (error || !data) throw error ?? new Error("Failed to create event");
  return rowToEvent(data as Row);
}

export async function updateEvent(
  id: string,
  patch: Partial<EventInput>,
): Promise<void> {
  await uid();
  const row: Record<string, unknown> = {};
  if (patch.kind !== undefined) row.kind = patch.kind;
  if (patch.title !== undefined) row.title = patch.title.trim().slice(0, 120);
  if (patch.startsAt !== undefined) row.starts_at = patch.startsAt;
  if (patch.endsAt !== undefined) row.ends_at = patch.endsAt;
  if (patch.location !== undefined)
    row.location = patch.location?.trim().slice(0, 200) || null;
  if (patch.reminderMin !== undefined)
    row.reminder_min = Math.max(0, Math.min(720, patch.reminderMin));
  if (patch.travelBufferMin !== undefined)
    row.travel_buffer_min = Math.max(0, Math.min(180, patch.travelBufferMin));
  if (patch.notes !== undefined)
    row.notes = patch.notes?.trim().slice(0, 500) || null;
  const { error } = await supabase.from("user_events").update(row).eq("id", id);
  if (error) throw error;
}

export async function deleteEvent(id: string): Promise<void> {
  await uid();
  const { error } = await supabase.from("user_events").delete().eq("id", id);
  if (error) throw error;
}

/** Minimal ICS parser — VEVENT blocks only. Tolerant; skips unparseable items. */
export function parseIcs(ics: string): EventInput[] {
  const events: EventInput[] = [];
  const blocks = ics.split(/BEGIN:VEVENT/i).slice(1);
  for (const block of blocks) {
    const body = block.split(/END:VEVENT/i)[0];
    const get = (key: string): string | null => {
      const m = body.match(new RegExp(`^${key}[^:\\n]*:(.+)$`, "im"));
      return m ? m[1].trim() : null;
    };
    const title = get("SUMMARY") ?? "Event";
    const dtstart = get("DTSTART");
    const dtend = get("DTEND");
    const location = get("LOCATION");
    if (!dtstart) continue;
    const startsAt = parseIcsDate(dtstart);
    if (!startsAt) continue;
    events.push({
      kind: "calendar",
      title: title.replace(/\\,/g, ",").slice(0, 120),
      startsAt,
      endsAt: dtend ? parseIcsDate(dtend) : null,
      location: location?.replace(/\\,/g, ","),
      source: "ics",
      reminderMin: 15,
    });
  }
  return events;
}

function parseIcsDate(raw: string): string | null {
  // Forms: 20250115T140000Z | 20250115T140000 | 20250115
  const v = raw.trim();
  const m =
    v.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/) ||
    v.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (!m) return null;
  const [, y, mo, d, h, mi, s, z] = [
    m[0],
    m[1],
    m[2],
    m[3],
    m[4] ?? "00",
    m[5] ?? "00",
    m[6] ?? "00",
    m[7] ?? "",
  ];
  const iso = `${y}-${mo}-${d}T${h}:${mi}:${s}${z === "Z" ? "Z" : ""}`;
  const dt = new Date(iso);
  return isNaN(dt.getTime()) ? null : dt.toISOString();
}
