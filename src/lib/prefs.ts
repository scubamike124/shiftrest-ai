import { supabase } from "@/integrations/supabase/client";

export type AssistantMode = "coach" | "companion" | "minimal";

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
  /** Rotation length in weeks (1–6). 1 = legacy weekly schedule. */
  cycleWeeks: number;
  /** Anchor (YYYY-MM-DD) for week 0 of the rotation. Null → derives from this week's Monday. */
  cycleAnchor: string | null;
  /** Display name the AI uses for itself. */
  assistantName: string;
  /** Coach (default), Companion (warmer, asks follow-ups), Minimal (terse). */
  assistantMode: AssistantMode;
  /** Opt-in for long-term memory. Default OFF — privacy-first. */
  memoryEnabled: boolean;
  /** Predictive insights: patterns, tomorrow preview, daily review. Default ON. */
  predictiveEnabled: boolean;
  /** Tomorrow preview card on the dashboard. Default ON. */
  tomorrowPreviewEnabled: boolean;
  /** Daily review card after wake. Default ON. */
  dailyReviewEnabled: boolean;
  /** Feed feedback back into ranked learned preferences. Default ON. */
  feedbackLearningEnabled: boolean;
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
  cycleWeeks: 1,
  cycleAnchor: null,
  assistantName: "RestPilot",
  assistantMode: "coach",
  memoryEnabled: false,
  predictiveEnabled: true,
  tomorrowPreviewEnabled: true,
  dailyReviewEnabled: true,
  feedbackLearningEnabled: true,
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
  cycle_weeks: number | null;
  cycle_anchor: string | null;
  assistant_name: string | null;
  assistant_mode: string | null;
  memory_enabled: boolean | null;
  predictive_enabled?: boolean | null;
  tomorrow_preview_enabled?: boolean | null;
  daily_review_enabled?: boolean | null;
  feedback_learning_enabled?: boolean | null;
};

function rowToPrefs(r: Row): Prefs {
  const cw = r.cycle_weeks ?? 1;
  const mode = (r.assistant_mode ?? "coach") as AssistantMode;
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
    cycleWeeks: Math.max(1, Math.min(6, cw)),
    cycleAnchor: r.cycle_anchor ?? null,
    assistantName: r.assistant_name?.trim() || "RestPilot",
    assistantMode: mode === "companion" || mode === "minimal" ? mode : "coach",
    memoryEnabled: Boolean(r.memory_enabled),
    predictiveEnabled: r.predictive_enabled ?? true,
    tomorrowPreviewEnabled: r.tomorrow_preview_enabled ?? true,
    dailyReviewEnabled: r.daily_review_enabled ?? true,
    feedbackLearningEnabled: r.feedback_learning_enabled ?? true,
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
  if (p.cycleWeeks !== undefined)
    out.cycle_weeks = Math.max(1, Math.min(6, Math.round(p.cycleWeeks)));
  if (p.cycleAnchor !== undefined) out.cycle_anchor = p.cycleAnchor;
  if (p.assistantName !== undefined)
    out.assistant_name = (p.assistantName.trim() || "RestPilot").slice(0, 40);
  if (p.assistantMode !== undefined) out.assistant_mode = p.assistantMode;
  if (p.memoryEnabled !== undefined) out.memory_enabled = p.memoryEnabled;
  if (p.predictiveEnabled !== undefined) out.predictive_enabled = p.predictiveEnabled;
  if (p.tomorrowPreviewEnabled !== undefined) out.tomorrow_preview_enabled = p.tomorrowPreviewEnabled;
  if (p.dailyReviewEnabled !== undefined) out.daily_review_enabled = p.dailyReviewEnabled;
  if (p.feedbackLearningEnabled !== undefined) out.feedback_learning_enabled = p.feedbackLearningEnabled;
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
      "wind_down_min, sleep_hours, notifications, low_light, lat, lon, location_label, partner_name, onboarded_at, cycle_weeks, cycle_anchor, assistant_name, assistant_mode, memory_enabled, predictive_enabled, tomorrow_preview_enabled, daily_review_enabled, feedback_learning_enabled",
    )
    .eq("user_id", uid)
    .maybeSingle();
  if (error || !data) return DEFAULT_PREFS;
  return rowToPrefs(data as Row);
}

/** Thrown by savePrefs/markOnboarded when there's no signed-in user. */
export class AuthRequiredError extends Error {
  constructor(message = "Sign in required to save your preferences.") {
    super(message);
    this.name = "AuthRequiredError";
  }
}

/** Upsert a partial prefs change for the signed-in user. Throws AuthRequiredError when logged out. */
export async function savePrefs(partial: Partial<Prefs>): Promise<void> {
  const uid = await currentUserId();
  if (!uid) throw new AuthRequiredError();
  const row = prefsToRowPartial(partial);
  const { error } = await supabase
    .from("user_prefs")
    .upsert({ user_id: uid, ...row }, { onConflict: "user_id" });
  if (error) {
    console.error("savePrefs failed", error);
    throw error;
  }
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
