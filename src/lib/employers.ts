import { supabase } from "@/integrations/supabase/client";

export type Employer = {
  id: string;
  name: string;
  color: string;
  isDefault: boolean;
  sortOrder: number;
  // Future-proof fields (already in DB, exposed when product surfaces them)
  location?: string | null;
  department?: string | null;
  supervisor?: string | null;
  payRate?: number | null;
  payCurrency?: string | null;
  commuteMin?: number | null;
  reminderOffsetMin?: number | null;
  recoveryNotes?: string | null;
};

/** Curated palette for new employers. */
export const EMPLOYER_COLORS = [
  "#6366f1", // indigo
  "#22c55e", // green (Amazon-style)
  "#f97316", // orange (Fire Dept)
  "#a855f7", // purple (Urgent Care)
  "#0ea5e9", // sky blue (Hospital)
  "#ef4444", // red (Police)
  "#eab308", // amber (Airline)
  "#ec4899", // pink (Bartending)
  "#14b8a6", // teal
  "#64748b", // slate
];

type Row = {
  id: string;
  name: string;
  color: string;
  is_default: boolean;
  sort_order: number;
  location: string | null;
  department: string | null;
  supervisor: string | null;
  pay_rate: number | null;
  pay_currency: string | null;
  commute_min: number | null;
  reminder_offset_min: number | null;
  recovery_notes: string | null;
};

function rowToEmployer(r: Row): Employer {
  return {
    id: r.id,
    name: r.name,
    color: r.color,
    isDefault: r.is_default,
    sortOrder: r.sort_order,
    location: r.location,
    department: r.department,
    supervisor: r.supervisor,
    payRate: r.pay_rate,
    payCurrency: r.pay_currency,
    commuteMin: r.commute_min,
    reminderOffsetMin: r.reminder_offset_min,
    recoveryNotes: r.recovery_notes,
  };
}

const SELECT =
  "id, name, color, is_default, sort_order, location, department, supervisor, pay_rate, pay_currency, commute_min, reminder_offset_min, recovery_notes";

async function uid() {
  const { data } = await supabase.auth.getUser();
  return data.user?.id ?? null;
}

export async function fetchEmployers(): Promise<Employer[]> {
  const userId = await uid();
  if (!userId) return [];
  const { data, error } = await supabase
    .from("employers")
    .select(SELECT)
    .is("archived_at", null)
    .order("is_default", { ascending: false })
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });
  if (error) {
    console.error("fetchEmployers", error);
    return [];
  }
  return (data ?? []).map((r) => rowToEmployer(r as Row));
}

export async function addEmployer(input: {
  name: string;
  color?: string;
  isDefault?: boolean;
}): Promise<Employer | null> {
  const userId = await uid();
  if (!userId) return null;
  // If marking default, unset any other default first.
  if (input.isDefault) {
    await supabase
      .from("employers")
      .update({ is_default: false })
      .eq("user_id", userId)
      .eq("is_default", true);
  }
  const color =
    input.color ??
    EMPLOYER_COLORS[Math.floor(Math.random() * EMPLOYER_COLORS.length)];
  const { data, error } = await supabase
    .from("employers")
    .insert({
      user_id: userId,
      name: input.name.trim() || "Untitled",
      color,
      is_default: !!input.isDefault,
    })
    .select(SELECT)
    .single();
  if (error || !data) {
    console.error("addEmployer", error);
    return null;
  }
  return rowToEmployer(data as Row);
}

export async function updateEmployer(
  id: string,
  patch: Partial<{
    name: string;
    color: string;
    isDefault: boolean;
    location: string | null;
    department: string | null;
    supervisor: string | null;
    payRate: number | null;
    payCurrency: string | null;
    commuteMin: number | null;
    reminderOffsetMin: number | null;
    recoveryNotes: string | null;
  }>,
): Promise<void> {
  const userId = await uid();
  if (!userId) return;
  if (patch.isDefault) {
    await supabase
      .from("employers")
      .update({ is_default: false })
      .eq("user_id", userId)
      .eq("is_default", true);
  }
  const row: {
    name?: string;
    color?: string;
    is_default?: boolean;
    location?: string | null;
    department?: string | null;
    supervisor?: string | null;
    pay_rate?: number | null;
    pay_currency?: string | null;
    commute_min?: number | null;
    reminder_offset_min?: number | null;
    recovery_notes?: string | null;
  } = {};
  if (patch.name !== undefined) row.name = patch.name.trim() || "Untitled";
  if (patch.color !== undefined) row.color = patch.color;
  if (patch.isDefault !== undefined) row.is_default = patch.isDefault;
  if (patch.location !== undefined) row.location = patch.location;
  if (patch.department !== undefined) row.department = patch.department;
  if (patch.supervisor !== undefined) row.supervisor = patch.supervisor;
  if (patch.payRate !== undefined) row.pay_rate = patch.payRate;
  if (patch.payCurrency !== undefined) row.pay_currency = patch.payCurrency;
  if (patch.commuteMin !== undefined) row.commute_min = patch.commuteMin;
  if (patch.reminderOffsetMin !== undefined)
    row.reminder_offset_min = patch.reminderOffsetMin;
  if (patch.recoveryNotes !== undefined) row.recovery_notes = patch.recoveryNotes;
  const { error } = await supabase.from("employers").update(row).eq("id", id);
  if (error) console.error("updateEmployer", error);
}

export async function deleteEmployer(id: string): Promise<void> {
  // Shifts pointing here get employer_id set to NULL via FK ON DELETE SET NULL.
  const { error } = await supabase.from("employers").delete().eq("id", id);
  if (error) console.error("deleteEmployer", error);
}

/** Ensure the signed-in user has at least one employer; promotes one to default if missing. */
export async function ensureDefaultEmployer(): Promise<Employer | null> {
  const userId = await uid();
  if (!userId) return null;
  const existing = await fetchEmployers();
  if (existing.length === 0) {
    return addEmployer({ name: "My Job", isDefault: true, color: "#6366f1" });
  }
  if (!existing.some((e) => e.isDefault)) {
    await updateEmployer(existing[0].id, { isDefault: true });
    return { ...existing[0], isDefault: true };
  }
  return existing.find((e) => e.isDefault) ?? existing[0];
}

export function employerById(list: Employer[], id?: string | null) {
  if (!id) return undefined;
  return list.find((e) => e.id === id);
}
