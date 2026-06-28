/**
 * Phase 6 — Per-category learning consents.
 *
 * All consents default to OFF. Memory itself must also be ON
 * (`user_prefs.memory_enabled`) before anything is ever learned.
 */
import { supabase } from "@/integrations/supabase/client";

export type LearningConsentKey =
  | "bedtime"
  | "wake"
  | "sounds"
  | "quiet_mode"
  | "traffic"
  | "calendar"
  | "weather";

export type LearningConsents = Record<LearningConsentKey, boolean>;

export const LEARNING_CONSENT_KEYS: LearningConsentKey[] = [
  "bedtime",
  "wake",
  "sounds",
  "quiet_mode",
  "traffic",
  "calendar",
  "weather",
];

export const LEARNING_CONSENT_META: Record<
  LearningConsentKey,
  { label: string; description: string }
> = {
  bedtime: {
    label: "Bedtime patterns",
    description: "Learn what time you usually wind down for sleep.",
  },
  wake: {
    label: "Wake-up patterns",
    description: "Learn the time you usually wake up.",
  },
  sounds: {
    label: "Sleep sounds",
    description: "Learn which mixes and timers you reach for at night.",
  },
  quiet_mode: {
    label: "Quiet mode habits",
    description: "Learn when you typically silence notifications.",
  },
  traffic: {
    label: "Commute & traffic",
    description: "Learn your usual departure times to recurring places.",
  },
  calendar: {
    label: "Calendar routines",
    description: "Learn recurring events (standups, school runs, gym).",
  },
  weather: {
    label: "Weather sensitivity",
    description: "Learn how weather changes your plans.",
  },
};

export const EMPTY_CONSENTS: LearningConsents = {
  bedtime: false,
  wake: false,
  sounds: false,
  quiet_mode: false,
  traffic: false,
  calendar: false,
  weather: false,
};

async function uid(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.user.id ?? null;
}

function coerce(raw: unknown): LearningConsents {
  const out: LearningConsents = { ...EMPTY_CONSENTS };
  if (!raw || typeof raw !== "object") return out;
  const obj = raw as Record<string, unknown>;
  for (const k of LEARNING_CONSENT_KEYS) {
    out[k] = obj[k] === true;
  }
  return out;
}

export async function getLearningConsents(): Promise<LearningConsents> {
  const user = await uid();
  if (!user) return { ...EMPTY_CONSENTS };
  const { data } = await supabase
    .from("user_prefs")
    .select("learning_consents")
    .eq("user_id", user)
    .maybeSingle();
  return coerce((data as { learning_consents?: unknown } | null)?.learning_consents);
}

export async function setLearningConsent(
  key: LearningConsentKey,
  value: boolean,
): Promise<LearningConsents> {
  const user = await uid();
  if (!user) throw new Error("Sign in required");
  const current = await getLearningConsents();
  const next: LearningConsents = { ...current, [key]: value };
  const { error } = await supabase
    .from("user_prefs")
    .upsert(
      { user_id: user, learning_consents: next as unknown as Record<string, boolean> },
      { onConflict: "user_id" },
    );
  if (error) throw error;
  return next;
}

export async function setAllLearningConsents(value: boolean): Promise<LearningConsents> {
  const user = await uid();
  if (!user) throw new Error("Sign in required");
  const next: LearningConsents = LEARNING_CONSENT_KEYS.reduce(
    (acc, k) => ({ ...acc, [k]: value }),
    { ...EMPTY_CONSENTS },
  );
  const { error } = await supabase
    .from("user_prefs")
    .upsert(
      { user_id: user, learning_consents: next as unknown as Record<string, boolean> },
      { onConflict: "user_id" },
    );
  if (error) throw error;
  return next;
}
