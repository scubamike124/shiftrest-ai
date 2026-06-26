import { supabase } from "@/integrations/supabase/client";

export type Prefs = {
  windDownMin: number;
  sleepHours: number;
  notifications: boolean;
  lowLight: boolean;
  lat: number;
  lon: number;
  locationLabel: string;
  partnerName: string;
  onboarded: boolean;
};

export const DEFAULT_PREFS: Prefs = {
  windDownMin: 120,
  sleepHours: 8,
  notifications: true,
  lowLight: true,
  lat: 40.7128,
  lon: -74.006,
  locationLabel: "",
  partnerName: "",
  onboarded: false,
};

// Legacy localStorage keys (read once for migration, then removed).
export const LEGACY_PREFS_KEY = "shiftrest.prefs.v1";
export const LEGACY_ONBOARDED_KEY = "shiftrest.onboarded.v1";
const MIGRATED_KEY = "shiftrest.prefs.migrated.v1";

// Public alias retained for back-compat with old imports.
export const PREFS_KEY = LEGACY_PREFS_KEY;

type Row = {
  wind_down_min: number;
  sleep_hours: number;
  notifications: boolean;
  low_light: boolean;
  lat: number;
  lon: number;
  location_label: string;
  partner_name: string;
  onboarded_at: string | null;
};

function rowToPrefs(r: Row): Prefs {
  return {
    windDownMin: r.wind_down_min,
    sleepHours: Number(r.sleep_hours),
    notifications: r.notifications,
    lowLight: r.low_light,
    lat: r.lat,
    lon: r.lon,
    locationLabel: r.location_label,
    partnerName: r.partner_name,
    onboarded: r.onboarded_at !== null,
  };
}

function prefsToRowPartial(p: Partial<Prefs>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (p.windDownMin !== undefined) out.wind_down_min = p.windDownMin;
  if (p.sleepHours !== undefined) out.sleep_hours = p.sleepHours;
  if (p.notifications !== undefined) out.notifications = p.notifications;
  if (p.lowLight !== undefined) out.low_light = p.lowLight;
  if (p.lat !== undefined) out.lat = p.lat;
  if (p.lon !== undefined) out.lon = p.lon;
  if (p.locationLabel !== undefined) out.location_label = p.locationLabel;
  if (p.partnerName !== undefined) out.partner_name = p.partnerName;
  return out;
}

async function currentUserId(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.user.id ?? null;
}

/** Fetch prefs for the signed-in user. Returns DEFAULT_PREFS if logged out or no row. */
export async function fetchPrefs(): Promise<Prefs> {
  const uid = await currentUserId();
  if (!uid) {
    // Logged out: fall back to local onboarding flag so the modal doesn't loop.
    if (typeof window !== "undefined" && localStorage.getItem(LEGACY_ONBOARDED_KEY)) {
      return { ...DEFAULT_PREFS, onboarded: true };
    }
    return DEFAULT_PREFS;
  }
  const { data, error } = await supabase
    .from("user_prefs")
    .select(
      "wind_down_min, sleep_hours, notifications, low_light, lat, lon, location_label, partner_name, onboarded_at",
    )
    .eq("user_id", uid)
    .maybeSingle();
  if (error || !data) return DEFAULT_PREFS;
  return rowToPrefs(data as Row);
}

/** Upsert a partial prefs change for the signed-in user. No-op when logged out. */
export async function savePrefs(partial: Partial<Prefs>): Promise<void> {
  const uid = await currentUserId();
  if (!uid) return;
  const row = prefsToRowPartial(partial);
  const { error } = await supabase
    .from("user_prefs")
    .upsert({ user_id: uid, ...row }, { onConflict: "user_id" });
  if (error) console.error("savePrefs failed", error);
}

/** Mark onboarding complete for the signed-in user. Falls back to localStorage flag when logged out. */
export async function markOnboarded(): Promise<void> {
  const uid = await currentUserId();
  if (!uid) {
    if (typeof window !== "undefined") localStorage.setItem(LEGACY_ONBOARDED_KEY, "1");
    return;
  }
  const { error } = await supabase
    .from("user_prefs")
    .upsert(
      { user_id: uid, onboarded_at: new Date().toISOString() },
      { onConflict: "user_id" },
    );
  if (error) console.error("markOnboarded failed", error);
}

/**
 * One-time migration of legacy localStorage prefs / onboarding flag into Supabase.
 * - Guarded by the MIGRATED_KEY flag so it never re-runs.
 * - Never overwrites an existing user_prefs row (cloud wins).
 */
export async function migrateLocalPrefsIfNeeded(): Promise<void> {
  if (typeof window === "undefined") return;
  if (localStorage.getItem(MIGRATED_KEY)) return;
  const uid = await currentUserId();
  if (!uid) return;

  const { data: existing } = await supabase
    .from("user_prefs")
    .select("user_id")
    .eq("user_id", uid)
    .maybeSingle();

  if (existing) {
    // Cloud already has prefs — do not overwrite. Just clear legacy + flag the guard.
    localStorage.setItem(MIGRATED_KEY, "1");
    localStorage.removeItem(LEGACY_PREFS_KEY);
    localStorage.removeItem(LEGACY_ONBOARDED_KEY);
    return;
  }

  let legacy: Partial<Prefs> = {};
  try {
    const raw = localStorage.getItem(LEGACY_PREFS_KEY);
    if (raw) legacy = JSON.parse(raw);
  } catch {}
  const wasOnboarded = !!localStorage.getItem(LEGACY_ONBOARDED_KEY);

  const row: Record<string, unknown> = {
    user_id: uid,
    ...prefsToRowPartial(legacy),
  };
  if (wasOnboarded) row.onboarded_at = new Date().toISOString();

  const { error } = await supabase
    .from("user_prefs")
    .upsert(row as never, { onConflict: "user_id" });

  if (error) {
    console.error("migrateLocalPrefsIfNeeded failed", error);
    return;
  }

  localStorage.setItem(MIGRATED_KEY, "1");
  localStorage.removeItem(LEGACY_PREFS_KEY);
  localStorage.removeItem(LEGACY_ONBOARDED_KEY);
}

/** Clear migration guard — used when wiping all local data. */
export function clearPrefsMigrationFlag(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(MIGRATED_KEY);
}
