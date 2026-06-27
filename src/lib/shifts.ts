import { supabase } from "@/integrations/supabase/client";
import { AuthRequiredError } from "@/lib/prefs";


export type Shift = {
  id: string;
  /** 0 = Mon ... 6 = Sun */
  day: number;
  /** minutes from 00:00 */
  start: number;
  /** minutes from 00:00; may be > start when overnight (we wrap) */
  end: number;
  employerId?: string | null;
  title?: string | null;
  notes?: string | null;
};

export const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const LEGACY_KEY = "shiftrest.shifts.v1";
const MIGRATED_KEY = "shiftrest.shifts.migrated.v1";

type Row = {
  id: string;
  day: number;
  start_min: number;
  end_min: number;
  employer_id: string | null;
  title: string | null;
  notes: string | null;
};

const SELECT = "id, day, start_min, end_min, employer_id, title, notes";

function rowToShift(r: Row): Shift {
  return {
    id: r.id,
    day: r.day,
    start: r.start_min,
    end: r.end_min,
    employerId: r.employer_id,
    title: r.title,
    notes: r.notes,
  };
}

async function currentUserId(): Promise<string | null> {
  const { data } = await supabase.auth.getUser();
  return data.user?.id ?? null;
}

export async function fetchShifts(): Promise<Shift[]> {
  const userId = await currentUserId();
  if (!userId) return [];
  const { data, error } = await supabase
    .from("shifts")
    .select(SELECT)
    .order("day", { ascending: true })
    .order("start_min", { ascending: true });
  if (error) {
    console.error("fetchShifts", error);
    return [];
  }
  return (data ?? []).map((r) => rowToShift(r as Row));
}

export type ShiftInput = {
  day: number;
  start: number;
  end: number;
  employerId?: string | null;
  title?: string | null;
  notes?: string | null;
};

export async function addShift(input: ShiftInput): Promise<Shift | null> {
  const userId = await currentUserId();
  if (!userId) throw new AuthRequiredError("Sign in to save your shifts.");

  const { data, error } = await supabase
    .from("shifts")
    .insert({
      user_id: userId,
      day: input.day,
      start_min: input.start,
      end_min: input.end,
      employer_id: input.employerId ?? null,
      title: input.title?.trim() || null,
      notes: input.notes?.trim() || null,
    })
    .select(SELECT)
    .single();
  if (error || !data) {
    console.error("addShift", error);
    return null;
  }
  return rowToShift(data as Row);
}

export async function updateShift(
  id: string,
  patch: Partial<ShiftInput>,
): Promise<void> {
  const row: {
    day?: number;
    start_min?: number;
    end_min?: number;
    employer_id?: string | null;
    title?: string | null;
    notes?: string | null;
  } = {};
  if (patch.day !== undefined) row.day = patch.day;
  if (patch.start !== undefined) row.start_min = patch.start;
  if (patch.end !== undefined) row.end_min = patch.end;
  if (patch.employerId !== undefined) row.employer_id = patch.employerId;
  if (patch.title !== undefined) row.title = patch.title?.trim() || null;
  if (patch.notes !== undefined) row.notes = patch.notes?.trim() || null;
  const { error } = await supabase.from("shifts").update(row).eq("id", id);
  if (error) console.error("updateShift", error);
}

export async function deleteShift(id: string): Promise<void> {
  const { error } = await supabase.from("shifts").delete().eq("id", id);
  if (error) console.error("deleteShift", error);
}

/** Used by Playbooks: wipe and replace the user's entire schedule. */
export async function replaceAllShifts(next: ShiftInput[]): Promise<void> {
  const userId = await currentUserId();
  if (!userId) return;
  const { error: delErr } = await supabase.from("shifts").delete().eq("user_id", userId);
  if (delErr) {
    console.error("replaceAllShifts:delete", delErr);
    return;
  }
  if (next.length === 0) return;
  const rows = next.map((s) => ({
    user_id: userId,
    day: s.day,
    start_min: s.start,
    end_min: s.end,
    employer_id: s.employerId ?? null,
    title: s.title?.trim() || null,
    notes: s.notes?.trim() || null,
  }));
  const { error: insErr } = await supabase.from("shifts").insert(rows);
  if (insErr) console.error("replaceAllShifts:insert", insErr);
}

/** One-time migration of legacy localStorage shifts into Supabase. Idempotent. */
export async function migrateLocalShiftsIfNeeded(): Promise<void> {
  if (typeof window === "undefined") return;
  const userId = await currentUserId();
  if (!userId) return;
  if (localStorage.getItem(MIGRATED_KEY)) return;

  const { count } = await supabase
    .from("shifts")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId);
  if ((count ?? 0) > 0) {
    localStorage.setItem(MIGRATED_KEY, "1");
    localStorage.removeItem(LEGACY_KEY);
    return;
  }

  const raw = localStorage.getItem(LEGACY_KEY);
  if (!raw) {
    localStorage.setItem(MIGRATED_KEY, "1");
    return;
  }

  try {
    const legacy: Shift[] = JSON.parse(raw);
    if (Array.isArray(legacy) && legacy.length > 0) {
      const rows = legacy
        .filter((s) => Number.isFinite(s?.day) && Number.isFinite(s?.start) && Number.isFinite(s?.end))
        .map((s) => ({
          user_id: userId,
          day: s.day,
          start_min: s.start,
          end_min: s.end,
        }));
      if (rows.length > 0) {
        const { error } = await supabase.from("shifts").insert(rows);
        if (error) {
          console.error("migrateLocalShiftsIfNeeded:insert", error);
          return;
        }
      }
    }
  } catch (e) {
    console.error("migrateLocalShiftsIfNeeded:parse", e);
  }
  localStorage.setItem(MIGRATED_KEY, "1");
  localStorage.removeItem(LEGACY_KEY);
}

export function fmt(min: number) {
  const m = ((min % 1440) + 1440) % 1440;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  const period = h >= 12 ? "PM" : "AM";
  const h12 = ((h + 11) % 12) + 1;
  return `${h12}:${mm.toString().padStart(2, "0")} ${period}`;
}

export function parseTime(value: string): number {
  const [h, m] = value.split(":").map(Number);
  return h * 60 + m;
}

export function toTimeInput(min: number): string {
  const m = ((min % 1440) + 1440) % 1440;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${h.toString().padStart(2, "0")}:${mm.toString().padStart(2, "0")}`;
}

/** Returns shift end as absolute minutes (may exceed 1440 if overnight). */
export function endAbsolute(shift: Shift): number {
  return shift.end <= shift.start ? shift.end + 1440 : shift.end;
}

export const DISCLAIMER =
  "Disclaimer: RestPilot AI and its operators do not provide medical advice. The shift schedules, winding-down windows, and sleep recommendations generated by this application are for educational and optimization purposes only. Always consult a healthcare professional before making major changes to your sleep patterns or health routines.";
