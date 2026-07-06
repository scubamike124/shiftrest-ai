import { supabase } from "@/integrations/supabase/client";

export type AssistantMode =
  | "coach"
  | "companion"
  | "minimal"
  | "friend"
  | "professional"
  | "warm"
  | "encouraging"
  | "motivational"
  | "supportive";

const ALLOWED_ASSISTANT_MODES: ReadonlySet<AssistantMode> = new Set<AssistantMode>([
  "coach",
  "companion",
  "minimal",
  "friend",
  "professional",
  "warm",
  "encouraging",
  "motivational",
  "supportive",
]);

export type Prefs = {
  windDownMin: number;
  sleepHours: number;
  notifications: boolean;
  lowLight: boolean;
  lat: number;
  lon: number;
  locationLabel: string;
  partnerName: string;
  /** Name the AI uses to address the user. Independent of email / OAuth display name. */
  preferredName: string;
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
  /** When true, the AI will not propose new memories from observed patterns. Default OFF. */
  memoryLearningPaused: boolean;
  /** Predictive insights: patterns, tomorrow preview, daily review. Default ON. */
  predictiveEnabled: boolean;
  /** Tomorrow preview card on the dashboard. Default ON. */
  tomorrowPreviewEnabled: boolean;
  /** Daily review card after wake. Default ON. */
  dailyReviewEnabled: boolean;
  /** Feed feedback back into ranked learned preferences. Default ON. */
  feedbackLearningEnabled: boolean;
  /** IANA time zone the user calls "home" — anchors body-clock math. */
  homeTz: string | null;
  /** Latest detected/manual IANA time zone the user is in. */
  currentTz: string | null;
  /** Auto-detect tz from the device on app load. Default ON. */
  tzAuto: boolean;
  /** Offline cache enabled. Default ON. */
  offlineEnabled: boolean;
  /** Travel mode (trips, jet-lag plan) enabled. Default ON. */
  travelModeEnabled: boolean;
  /** Opt-in calendar travel detection (future). Default OFF. */
  calendarTravelDetect: boolean;
  // ─── Voice personalization ──────────────────────────────────────────
  voiceId: string;                       // openai voice id (sage, nova, etc.)
  voiceLanguage: string;                 // BCP-47 (en-US, es-MX, ja-JP …)
  voiceAccent: string | null;            // optional accent override
  voicePersonality: string;              // calm | friendly | professional | …
  voiceSpeed: number;                    // 0.7 – 1.4
  voiceInstructions: string | null;      // optional raw style override
  // ─── Slice 6: Morning Brief ────────────────────────────────────────
  /** Order + hidden set for the Morning Brief cards. */
  briefLayout: { order: string[]; hidden: string[] };
  /** Slice 7 — Afternoon Check-In layout. */
  afternoonLayout: { order: string[]; hidden: string[] };
  /** Slice 7 — Evening Brief layout. */
  eveningLayout: { order: string[]; hidden: string[] };
  /** Slice 7 — per-period brief enable toggles. */
  briefEnabled: { morning: boolean; afternoon: boolean; evening: boolean };
  /** Optional home address — used later for live traffic. */
  homeAddress: string | null;
  /** Optional work address — used later for live traffic. */
  workAddress: string | null;
  /** User-supplied typical one-way commute minutes (Wave A departure estimate). */
  commuteMinutesBaseline: number | null;
};

export const DEFAULT_BRIEF_LAYOUT = {
  order: ["sleep", "alarm", "weather", "longclock", "departure", "tip", "motivation"],
  hidden: ["departure"] as string[],
};

export const DEFAULT_AFTERNOON_LAYOUT = {
  order: ["remaining", "nextTraffic", "weatherShift", "workingLate", "hydration", "movement", "battery"],
  hidden: ["nextTraffic"] as string[],
};

export const DEFAULT_EVENING_LAYOUT = {
  order: ["tomorrowFirst", "tomorrowWeather", "clothing", "smartAlarm", "bedtime", "prep", "travel", "summary", "windDown"],
  hidden: [] as string[],
};

export const DEFAULT_BRIEF_ENABLED = { morning: true, afternoon: true, evening: true };

export const DEFAULT_PREFS: Prefs = {
  windDownMin: 120,
  sleepHours: 8,
  notifications: true,
  lowLight: true,
  lat: 40.7128,
  lon: -74.006,
  locationLabel: "",
  partnerName: "",
  preferredName: "",
  onboarded: false,
  cycleWeeks: 1,
  cycleAnchor: null,
  assistantName: "RestPilot",
  assistantMode: "coach",
  memoryEnabled: false,
  memoryLearningPaused: false,
  predictiveEnabled: true,
  tomorrowPreviewEnabled: true,
  dailyReviewEnabled: true,
  feedbackLearningEnabled: true,
  homeTz: null,
  currentTz: null,
  tzAuto: true,
  offlineEnabled: true,
  travelModeEnabled: true,
  calendarTravelDetect: false,
  voiceId: "sage",
  voiceLanguage: "en-US",
  voiceAccent: null,
  voicePersonality: "calm",
  voiceSpeed: 1.0,
  voiceInstructions: null,
  briefLayout: DEFAULT_BRIEF_LAYOUT,
  afternoonLayout: DEFAULT_AFTERNOON_LAYOUT,
  eveningLayout: DEFAULT_EVENING_LAYOUT,
  briefEnabled: DEFAULT_BRIEF_ENABLED,
  homeAddress: null,
  workAddress: null,
  commuteMinutesBaseline: null,
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
  preferred_name?: string | null;
  onboarded_at: string | null;
  cycle_weeks: number | null;
  cycle_anchor: string | null;
  assistant_name: string | null;
  assistant_mode: string | null;
  memory_enabled: boolean | null;
  memory_learning_paused?: boolean | null;
  predictive_enabled?: boolean | null;
  tomorrow_preview_enabled?: boolean | null;
  daily_review_enabled?: boolean | null;
  feedback_learning_enabled?: boolean | null;
  home_tz?: string | null;
  current_tz?: string | null;
  tz_auto?: boolean | null;
  offline_enabled?: boolean | null;
  travel_mode_enabled?: boolean | null;
  calendar_travel_detect?: boolean | null;
  voice_id?: string | null;
  voice_language?: string | null;
  voice_accent?: string | null;
  voice_personality?: string | null;
  voice_speed?: number | string | null;
  voice_instructions?: string | null;
  brief_layout?:
    | { order?: string[]; hidden?: string[] }
    | {
        morning?: { order?: string[]; hidden?: string[] };
        afternoon?: { order?: string[]; hidden?: string[] };
        evening?: { order?: string[]; hidden?: string[] };
      }
    | null;
  brief_enabled?: { morning?: boolean; afternoon?: boolean; evening?: boolean } | null;
  home_address?: string | null;
  work_address?: string | null;
  commute_minutes_baseline?: number | null;
};

type LayoutPart = { order?: string[]; hidden?: string[] };
function pickLayout(part: LayoutPart | undefined, fallback: { order: string[]; hidden: string[] }) {
  if (part && Array.isArray(part.order)) {
    return { order: part.order, hidden: Array.isArray(part.hidden) ? part.hidden : [] };
  }
  return fallback;
}

function rowToPrefs(r: Row): Prefs {
  const cw = r.cycle_weeks ?? 1;
  const mode = (r.assistant_mode ?? "coach") as AssistantMode;
  const bl = r.brief_layout as
    | (LayoutPart & { morning?: LayoutPart; afternoon?: LayoutPart; evening?: LayoutPart })
    | null
    | undefined;
  // Back-compat: old shape was flat { order, hidden } (morning only).
  const nested = bl && (bl.morning || bl.afternoon || bl.evening);
  const morning = nested
    ? pickLayout(bl?.morning, DEFAULT_BRIEF_LAYOUT)
    : pickLayout(bl ?? undefined, DEFAULT_BRIEF_LAYOUT);
  const afternoon = pickLayout(bl?.afternoon, DEFAULT_AFTERNOON_LAYOUT);
  const evening = pickLayout(bl?.evening, DEFAULT_EVENING_LAYOUT);
  const be = r.brief_enabled ?? {};
  const briefEnabled = {
    morning: be.morning ?? true,
    afternoon: be.afternoon ?? true,
    evening: be.evening ?? true,
  };
  return {
    windDownMin: r.wind_down_min,
    sleepHours: Number(r.sleep_hours),
    notifications: r.notifications,
    lowLight: r.low_light,
    lat: r.lat,
    lon: r.lon,
    locationLabel: r.location_label,
    partnerName: r.partner_name,
    preferredName: (r.preferred_name ?? "").trim(),
    onboarded: r.onboarded_at !== null,
    cycleWeeks: Math.max(1, Math.min(6, cw)),
    cycleAnchor: r.cycle_anchor ?? null,
    assistantName: r.assistant_name?.trim() || "RestPilot",
    assistantMode: ALLOWED_ASSISTANT_MODES.has(mode) ? mode : "coach",
    memoryEnabled: Boolean(r.memory_enabled),
    memoryLearningPaused: Boolean(r.memory_learning_paused),
    predictiveEnabled: r.predictive_enabled ?? true,
    tomorrowPreviewEnabled: r.tomorrow_preview_enabled ?? true,
    dailyReviewEnabled: r.daily_review_enabled ?? true,
    feedbackLearningEnabled: r.feedback_learning_enabled ?? true,
    homeTz: r.home_tz ?? null,
    currentTz: r.current_tz ?? null,
    tzAuto: r.tz_auto ?? true,
    offlineEnabled: r.offline_enabled ?? true,
    travelModeEnabled: r.travel_mode_enabled ?? true,
    calendarTravelDetect: r.calendar_travel_detect ?? false,
    voiceId: r.voice_id || "sage",
    voiceLanguage: r.voice_language || "en-US",
    voiceAccent: r.voice_accent ?? null,
    voicePersonality: r.voice_personality || "calm",
    voiceSpeed: r.voice_speed != null ? Math.min(1.4, Math.max(0.7, Number(r.voice_speed))) : 1.0,
    voiceInstructions: r.voice_instructions ?? null,
    briefLayout: morning,
    afternoonLayout: afternoon,
    eveningLayout: evening,
    briefEnabled,
    homeAddress: r.home_address ?? null,
    workAddress: r.work_address ?? null,
    commuteMinutesBaseline: r.commute_minutes_baseline ?? null,
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
  if (p.preferredName !== undefined) out.preferred_name = p.preferredName.trim().slice(0, 60) || null;
  if (p.cycleWeeks !== undefined)
    out.cycle_weeks = Math.max(1, Math.min(6, Math.round(p.cycleWeeks)));
  if (p.cycleAnchor !== undefined) out.cycle_anchor = p.cycleAnchor;
  if (p.assistantName !== undefined)
    out.assistant_name = (p.assistantName.trim() || "RestPilot").slice(0, 40);
  if (p.assistantMode !== undefined) out.assistant_mode = p.assistantMode;
  if (p.memoryEnabled !== undefined) out.memory_enabled = p.memoryEnabled;
  if (p.memoryLearningPaused !== undefined) out.memory_learning_paused = p.memoryLearningPaused;
  if (p.predictiveEnabled !== undefined) out.predictive_enabled = p.predictiveEnabled;
  if (p.tomorrowPreviewEnabled !== undefined) out.tomorrow_preview_enabled = p.tomorrowPreviewEnabled;
  if (p.dailyReviewEnabled !== undefined) out.daily_review_enabled = p.dailyReviewEnabled;
  if (p.feedbackLearningEnabled !== undefined) out.feedback_learning_enabled = p.feedbackLearningEnabled;
  if (p.voiceId !== undefined) out.voice_id = p.voiceId;
  if (p.voiceLanguage !== undefined) out.voice_language = p.voiceLanguage;
  if (p.voiceAccent !== undefined) out.voice_accent = p.voiceAccent;
  if (p.voicePersonality !== undefined) out.voice_personality = p.voicePersonality;
  if (p.voiceSpeed !== undefined) out.voice_speed = Math.min(1.4, Math.max(0.7, p.voiceSpeed));
  if (p.voiceInstructions !== undefined) out.voice_instructions = p.voiceInstructions;
  if (
    p.briefLayout !== undefined ||
    p.afternoonLayout !== undefined ||
    p.eveningLayout !== undefined
  ) {
    out.brief_layout = {
      morning: p.briefLayout ?? DEFAULT_BRIEF_LAYOUT,
      afternoon: p.afternoonLayout ?? DEFAULT_AFTERNOON_LAYOUT,
      evening: p.eveningLayout ?? DEFAULT_EVENING_LAYOUT,
    };
  }
  if (p.briefEnabled !== undefined) out.brief_enabled = p.briefEnabled;
  if (p.homeAddress !== undefined) out.home_address = p.homeAddress;
  if (p.workAddress !== undefined) out.work_address = p.workAddress;
  if (p.commuteMinutesBaseline !== undefined) out.commute_minutes_baseline = p.commuteMinutesBaseline;
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
      "wind_down_min, sleep_hours, notifications, low_light, lat, lon, location_label, partner_name, preferred_name, onboarded_at, cycle_weeks, cycle_anchor, assistant_name, assistant_mode, memory_enabled, memory_learning_paused, predictive_enabled, tomorrow_preview_enabled, daily_review_enabled, feedback_learning_enabled, voice_id, voice_language, voice_accent, voice_personality, voice_speed, voice_instructions, brief_layout, brief_enabled, home_address, work_address, commute_minutes_baseline",
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
  const { data: sess } = await supabase.auth.getSession();
  const uid = sess.session?.user.id ?? null;
  if (!uid) throw new AuthRequiredError();

  // Guard: never let Preferred Name equal the account's email prefix
  // (e.g. "scubamike124"). Strip silently so greetings fall back to
  // name-less rather than showing a username-lookalike.
  if (partial.preferredName !== undefined) {
    const email = sess.session?.user.email ?? "";
    const emailPrefix = email.split("@")[0]?.trim().toLowerCase() ?? "";
    const candidate = partial.preferredName.trim().toLowerCase();
    if (emailPrefix && candidate && candidate === emailPrefix) {
      partial = { ...partial, preferredName: "" };
    }
  }

  const row = prefsToRowPartial(partial);
  const isModeSave = partial.assistantMode !== undefined || "assistant_mode" in row;
  if (isModeSave) {
    console.log("[assistantMode-debug] savePrefs partial:", partial);
    console.log("[assistantMode-debug] savePrefs row -> upsert:", row);
  }
  const { data, error } = await supabase
    .from("user_prefs")
    .upsert({ user_id: uid, ...row }, { onConflict: "user_id" })
    .select("assistant_mode")
    .single();
  if (isModeSave) {
    console.log("[assistantMode-debug] upsert response data:", data);
    console.log("[assistantMode-debug] upsert response error:", error && {
      code: (error as { code?: string }).code,
      message: error.message,
      details: (error as { details?: string }).details,
      hint: (error as { hint?: string }).hint,
    });
  }
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
  if (error) {
    console.error("markOnboarded failed", error);
    throw error;
  }
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
